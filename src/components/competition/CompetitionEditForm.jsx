import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.js'

// Shared competition create/edit form. Used by:
//   - the admin Create / Edit modal in AdminCompetitions.jsx
//   - the manager Edit Details tab in ManagerCompetitionDetail.jsx
//
// The form owns all field state, validation, and the submit/cancel button
// row. Outer scaffolding (modal chrome, archive action, success toast) lives
// in the parent. onSubmit receives the assembled payload object and is
// expected to perform the API call; thrown errors are surfaced inline in the
// form's error banner.

const DESCRIPTION_MAX = 10000
const LINK_LABEL_MAX = 80
const LINK_URL_MAX = 2048
const MAX_LINKS = 20
const BANNER_BUCKET = 'competition-banners'
const BANNER_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp']
const BANNER_MAX_BYTES = 5 * 1024 * 1024

// ISO timestamp to the YYYY-MM-DDTHH:MM format that <input type="datetime-local">
// expects in the user's local timezone.
function isoToLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// Mirror of the server-side deriveAbbreviation in api/superadmin/[resource].js.
// Kept in sync by hand for the live preview; the server is authoritative.
function deriveAbbreviation(name) {
  const words = (name ?? '').trim().split(/\s+/)
  const letters = []
  for (const w of words) {
    if (/^\d+$/.test(w)) continue
    const first = w[0]
    if (first && /[A-Z]/.test(first)) letters.push(first.toUpperCase())
  }
  return letters.join('').slice(0, 8)
}

function linksFromInitial(initialLinks) {
  if (!Array.isArray(initialLinks)) return []
  return initialLinks.map((l, i) => ({
    _key: `i-${i}`,
    label: typeof l?.label === 'string' ? l.label : '',
    url: typeof l?.url === 'string' ? l.url : '',
  }))
}

export default function CompetitionEditForm({
  mode,
  initial,
  canEditAbbreviation = true,
  submitLabel,
  onSubmit,
  onCancel,
}) {
  const isEdit = mode === 'edit'

  const [name, setName] = useState(initial?.name ?? '')
  const [abbreviation, setAbbreviation] = useState(initial?.abbreviation ?? '')
  const [startDate, setStartDate] = useState(initial?.start_date ?? '')
  const [endDate, setEndDate] = useState(initial?.end_date ?? '')
  const [regOpen, setRegOpen] = useState(isoToLocalInput(initial?.registration_open_at))
  const [regClose, setRegClose] = useState(isoToLocalInput(initial?.registration_close_at))
  const [price, setPrice] = useState(initial?.price_per_player != null ? String(initial.price_per_player) : '')
  const [bankName, setBankName] = useState(initial?.bank_account_name ?? '')
  const [bankBsb, setBankBsb] = useState(initial?.bank_bsb ?? '')
  const [bankAccount, setBankAccount] = useState(initial?.bank_account_number ?? '')
  const [paymentVisible, setPaymentVisible] = useState(initial?.payment_info_visible ?? false)
  const [description, setDescription] = useState(initial?.description ?? '')
  const [links, setLinks] = useState(() => linksFromInitial(initial?.links))
  const [keySeed, setKeySeed] = useState(links.length)
  const [bannerUrl, setBannerUrl] = useState(initial?.banner_url ?? null)
  const [bannerUploading, setBannerUploading] = useState(false)
  const [bannerError, setBannerError] = useState(null)
  const bannerInputRef = useRef(null)

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  function reset() {
    setName(initial?.name ?? '')
    setAbbreviation(initial?.abbreviation ?? '')
    setStartDate(initial?.start_date ?? '')
    setEndDate(initial?.end_date ?? '')
    setRegOpen(isoToLocalInput(initial?.registration_open_at))
    setRegClose(isoToLocalInput(initial?.registration_close_at))
    setPrice(initial?.price_per_player != null ? String(initial.price_per_player) : '')
    setBankName(initial?.bank_account_name ?? '')
    setBankBsb(initial?.bank_bsb ?? '')
    setBankAccount(initial?.bank_account_number ?? '')
    setPaymentVisible(initial?.payment_info_visible ?? false)
    setDescription(initial?.description ?? '')
    const reseeded = linksFromInitial(initial?.links)
    setLinks(reseeded)
    setKeySeed(reseeded.length)
    setBannerUrl(initial?.banner_url ?? null)
    setBannerError(null)
    setError(null)
  }

  function addLink() {
    if (links.length >= MAX_LINKS) return
    setLinks(prev => [...prev, { _key: `n-${keySeed}`, label: '', url: '' }])
    setKeySeed(k => k + 1)
  }

  function updateLink(i, field, value) {
    setLinks(prev => prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)))
  }

  function removeLink(i) {
    setLinks(prev => prev.filter((_, idx) => idx !== i))
  }

  // Banner upload — direct to Supabase Storage. The path encodes the
  // competition id, which the storage write policy joins against
  // competition_managers. The resulting public URL is held in form state and
  // sent on the next Save; we do NOT write to the row until the user submits.
  // Orphaned files on cancel-after-upload are an accepted trade-off (a future
  // cleanup job can sweep storage objects not referenced by any
  // competitions.banner_url).
  async function handleBannerSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setBannerError(null)
    if (!initial?.id) {
      setBannerError('Save the competition first before uploading a banner.')
      if (bannerInputRef.current) bannerInputRef.current.value = ''
      return
    }
    if (!BANNER_ACCEPTED_TYPES.includes(file.type)) {
      setBannerError('Banner must be PNG, JPEG, or WebP.')
      if (bannerInputRef.current) bannerInputRef.current.value = ''
      return
    }
    if (file.size > BANNER_MAX_BYTES) {
      setBannerError('Banner must be 5 MB or less.')
      if (bannerInputRef.current) bannerInputRef.current.value = ''
      return
    }
    setBannerUploading(true)
    try {
      const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase()
      const path = `${initial.id}/${Date.now()}.${ext}`
      const { data: up, error: upErr } = await supabase.storage
        .from(BANNER_BUCKET)
        .upload(path, file, { upsert: false, cacheControl: '3600', contentType: file.type })
      if (upErr) throw upErr
      const { data: urlData } = supabase.storage.from(BANNER_BUCKET).getPublicUrl(up.path)
      setBannerUrl(urlData.publicUrl)
    } catch (err) {
      setBannerError(err?.message || 'Banner upload failed. Please try again.')
    } finally {
      setBannerUploading(false)
      if (bannerInputRef.current) bannerInputRef.current.value = ''
    }
  }

  function clearBanner() {
    setBannerUrl(null)
    setBannerError(null)
  }

  async function submit(e) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) return setError('Name is required.')
    if (!startDate || !endDate) return setError('Start and end dates are required.')
    if (new Date(endDate) < new Date(startDate)) return setError('End date must be on or after start date.')
    if (regOpen && regClose && new Date(regClose) < new Date(regOpen)) {
      return setError('Registration close must be on or after registration open.')
    }
    if (description.length > DESCRIPTION_MAX) {
      return setError(`Description must be ${DESCRIPTION_MAX} characters or fewer.`)
    }
    for (let i = 0; i < links.length; i++) {
      const l = links[i]
      const hasLabel = l.label.trim().length > 0
      const hasUrl = l.url.trim().length > 0
      if (!hasLabel && !hasUrl) continue // Empty trailing row will be dropped
      if (!hasLabel) return setError(`Link ${i + 1}: label is required when a URL is set.`)
      if (!hasUrl) return setError(`Link ${i + 1}: URL is required when a label is set.`)
      if (l.label.length > LINK_LABEL_MAX) return setError(`Link ${i + 1}: label must be ${LINK_LABEL_MAX} characters or fewer.`)
      if (!/^https?:\/\//i.test(l.url.trim())) {
        return setError(`Link ${i + 1}: URL must start with http:// or https://`)
      }
      if (l.url.length > LINK_URL_MAX) return setError(`Link ${i + 1}: URL must be ${LINK_URL_MAX} characters or fewer.`)
    }

    const cleanedLinks = links
      .filter(l => l.label.trim().length > 0 && l.url.trim().length > 0)
      .map(l => ({ label: l.label.trim(), url: l.url.trim() }))

    setSubmitting(true)
    try {
      const payload = {
        name: name.trim(),
        abbreviation: abbreviation.trim() || null,
        start_date: startDate,
        end_date: endDate,
        registration_open_at: regOpen ? new Date(regOpen).toISOString() : null,
        registration_close_at: regClose ? new Date(regClose).toISOString() : null,
        price_per_player: price === '' ? null : Number(price),
        bank_account_name: bankName.trim() || null,
        bank_bsb: bankBsb.trim() || null,
        bank_account_number: bankAccount.trim() || null,
        payment_info_visible: paymentVisible,
        description: description.trim(),
        links: cleanedLinks,
        banner_url: bannerUrl,
      }
      await onSubmit(payload)
    } catch (err) {
      setError(err.message || `Could not ${isEdit ? 'save' : 'create'} competition.`)
    } finally {
      setSubmitting(false)
    }
  }

  function handleCancelClick() {
    reset()
    if (onCancel) onCancel()
  }

  const effectiveAbbr = abbreviation.trim() || deriveAbbreviation(name)
  const refYear = startDate ? new Date(startDate).getFullYear() : 'YYYY'
  const refPreview = effectiveAbbr.length >= 2 ? `${effectiveAbbr}${refYear}CROUCHY` : null

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
          <p className="text-red-400 text-xs">{error}</p>
        </div>
      )}

      <div>
        <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">Name</label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="ALSA Pre-Nationals 2027"
          className="w-full bg-base border border-line rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand"
        />
        {!isEdit && (
          <p className="text-white text-[11px] mt-1 opacity-60">URL slug is generated from the name automatically.</p>
        )}
      </div>

      <div>
        <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">Abbreviation</label>
        <input
          type="text"
          value={abbreviation}
          onChange={e => setAbbreviation(e.target.value.toUpperCase())}
          placeholder="VPN"
          maxLength={8}
          disabled={!canEditAbbreviation}
          title={canEditAbbreviation ? '' : 'Cannot change while registrations exist. Existing payment references would become inconsistent.'}
          className={`w-full bg-base border border-line rounded-xl px-4 py-2.5 text-sm text-white font-mono uppercase tracking-wider focus:outline-none focus:border-brand ${canEditAbbreviation ? '' : 'opacity-50 cursor-not-allowed'}`}
        />
        <p className="text-white text-[11px] mt-1 opacity-60">
          Used as payment reference prefix (e.g. VPN for Victorian Pre Nats). 2 to 8 letters and digits, uppercase only. Leave blank to auto-derive from name.
        </p>
        <p className="text-white text-[11px] mt-1 opacity-60">
          Payment references will look like:{' '}
          {refPreview
            ? <span className="font-mono text-brand">{refPreview}</span>
            : <span className="opacity-50">enter a name or abbreviation to preview</span>}
        </p>
        {isEdit && canEditAbbreviation && (
          <p className="text-yellow-400 text-[11px] mt-2 opacity-80">
            Changing this affects new registrations only. Existing payment references remain as they were.
          </p>
        )}
        {isEdit && !canEditAbbreviation && (
          <p className="text-yellow-400 text-[11px] mt-2 opacity-80">
            Locked because registrations already exist. Contact a superadmin if you need to change this.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">Start date</label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="w-full bg-base border border-line rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand"
          />
        </div>
        <div>
          <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">End date</label>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="w-full bg-base border border-line rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">Registration opens</label>
          <input
            type="datetime-local"
            value={regOpen}
            onChange={e => setRegOpen(e.target.value)}
            className="w-full bg-base border border-line rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand"
          />
        </div>
        <div>
          <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">Registration closes</label>
          <input
            type="datetime-local"
            value={regClose}
            onChange={e => setRegClose(e.target.value)}
            className="w-full bg-base border border-line rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">Price per player (AUD)</label>
        <input
          type="number"
          step="0.01"
          min="0"
          value={price}
          onChange={e => setPrice(e.target.value)}
          placeholder="e.g. 75.00"
          className="w-full bg-base border border-line rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand"
        />
      </div>

      <div className="bg-base border border-line rounded-xl p-4 space-y-3">
        <p className="text-white text-xs font-bold uppercase tracking-wider">Payment details</p>
        <p className="text-white text-[11px] opacity-60">Visible to registered players only when the toggle below is on.</p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">Account name</label>
            <input
              type="text"
              value={bankName}
              onChange={e => setBankName(e.target.value)}
              className="w-full bg-surface border border-line rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
            />
          </div>
          <div>
            <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">BSB</label>
            <input
              type="text"
              value={bankBsb}
              onChange={e => setBankBsb(e.target.value)}
              placeholder="XXX-XXX"
              className="w-full bg-surface border border-line rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">Account number</label>
          <input
            type="text"
            value={bankAccount}
            onChange={e => setBankAccount(e.target.value)}
            className="w-full bg-surface border border-line rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
          />
        </div>

        <label className="flex items-center gap-3 cursor-pointer mt-1">
          <input
            type="checkbox"
            checked={paymentVisible}
            onChange={e => setPaymentVisible(e.target.checked)}
            className="accent-[#00FF41]"
          />
          <span className="text-white text-xs">Payment info visible to registered players</span>
        </label>
      </div>

      {isEdit && (
        <div className="bg-base border border-line rounded-xl p-4 space-y-3">
          <p className="text-white text-xs font-bold uppercase tracking-wider">Header Banner</p>
          <p className="text-white text-[11px] opacity-60">
            Recommended size 4096 x 1716. Maximum 5 MB. PNG, JPEG, or WebP.
          </p>

          <input
            ref={bannerInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleBannerSelect}
            className="hidden"
          />

          {bannerError && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
              <p className="text-red-400 text-xs">{bannerError}</p>
            </div>
          )}

          {bannerUrl ? (
            <div className="space-y-3">
              <img
                src={bannerUrl}
                alt="Banner preview"
                className="w-full max-w-[240px] aspect-[4096/1716] object-cover rounded-lg border border-line"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={bannerUploading}
                  onClick={() => bannerInputRef.current?.click()}
                  className="text-xs bg-line hover:bg-[#374056] disabled:opacity-50 text-white font-semibold px-3 py-1.5 rounded-lg transition-colors"
                >
                  {bannerUploading ? 'Uploading...' : 'Replace'}
                </button>
                <button
                  type="button"
                  disabled={bannerUploading}
                  onClick={clearBanner}
                  className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
              <p className="text-white text-[11px] opacity-50">
                Changes apply when you save the form.
              </p>
            </div>
          ) : (
            <button
              type="button"
              disabled={bannerUploading}
              onClick={() => bannerInputRef.current?.click()}
              className="w-full border border-dashed border-line hover:border-brand disabled:opacity-50 rounded-xl py-6 text-center transition-colors"
            >
              <p className="text-white text-sm font-semibold">
                {bannerUploading ? 'Uploading...' : 'Upload banner'}
              </p>
              <p className="text-white text-[11px] opacity-50 mt-1">PNG, JPEG, or WebP. Up to 5 MB.</p>
            </button>
          )}
        </div>
      )}

      <div>
        <label className="block text-xs text-white font-bold uppercase tracking-wider mb-1.5">Description</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={6}
          maxLength={DESCRIPTION_MAX}
          placeholder="Long-form details about the event. Plain text with line breaks; no Markdown."
          className="w-full bg-base border border-line rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand resize-y"
        />
        <p className="text-white text-[11px] mt-1 opacity-60">
          {description.length} / {DESCRIPTION_MAX} characters
        </p>
      </div>

      <div className="bg-base border border-line rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-white text-xs font-bold uppercase tracking-wider">Schedule + Resources</p>
          <span className="text-white text-[11px] opacity-50">
            {links.length} / {MAX_LINKS}
          </span>
        </div>
        <p className="text-white text-[11px] opacity-60">
          Links shown publicly under "Schedule + Resources" on the competition page.
        </p>

        {links.length === 0 && (
          <p className="text-white text-[11px] opacity-50">No links yet.</p>
        )}

        {links.map((l, i) => (
          <div key={l._key} className="grid grid-cols-[1fr_2fr_auto] gap-2 items-start">
            <input
              type="text"
              value={l.label}
              onChange={e => updateLink(i, 'label', e.target.value)}
              maxLength={LINK_LABEL_MAX}
              placeholder="Schedule"
              className="bg-surface border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
            />
            <input
              type="url"
              value={l.url}
              onChange={e => updateLink(i, 'url', e.target.value)}
              maxLength={LINK_URL_MAX}
              placeholder="https://example.com/schedule"
              className="bg-surface border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
            />
            <button
              type="button"
              onClick={() => removeLink(i)}
              className="text-red-400 text-xs opacity-70 hover:opacity-100 px-2 py-2 transition-opacity"
              aria-label={`Remove link ${i + 1}`}
            >
              Remove
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={addLink}
          disabled={links.length >= MAX_LINKS}
          className="border border-line text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-line/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + Add link
        </button>
      </div>

      <div className="flex flex-wrap gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-5 py-2 rounded-xl text-sm transition-all"
        >
          {submitting
            ? (isEdit ? 'Saving...' : 'Creating...')
            : (submitLabel ?? (isEdit ? 'Save changes' : 'Create competition'))}
        </button>
        <button
          type="button"
          onClick={handleCancelClick}
          disabled={submitting}
          className="border border-line text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
