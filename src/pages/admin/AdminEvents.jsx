import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

const TABS = ['Event Details', 'Side Events', 'Pricing', 'Registration Settings']

const DEFAULT_SIDE_EVENTS = [
  { slug: 'lord-of-the-rings', name: 'Lord of the Rings', description: 'Epic multi-round format — only the finest warriors survive each ring to claim the ultimate title.', enabled: true, price: '25.00', max_participants: '', custom: false },
  { slug: 'solos', name: 'Solos', description: 'Head-to-head individual competition. Prove you are the best single player in Australasia.', enabled: true, price: '20.00', max_participants: '', custom: false },
  { slug: 'doubles', name: 'Doubles', description: 'Partner with a teammate and coordinate your strategy to outmanoeuvre the field.', enabled: true, price: '20.00', max_participants: '', custom: false },
  { slug: 'triples', name: 'Triples', description: 'Fast-paced three-player team format. Communication and chemistry decide the winners.', enabled: true, price: '20.00', max_participants: '', custom: false },
  { slug: 'presentation-dinner', name: 'Presentation Dinner', description: 'Join fellow competitors for the official presentation evening and awards ceremony.', enabled: true, price: '65.00', max_participants: '', custom: false },
]

const EMPTY_CUSTOM = { name: '', description: '', max_participants: '' }

function Badge({ status }) {
  const map = {
    draft: 'bg-[#374056] text-[#e5e5e5]/50',
    open: 'bg-brand/10 text-brand border border-brand/20',
    closed: 'bg-red-500/10 text-red-400 border border-red-500/20',
    archived: 'bg-[#2D2D2D] text-[#e5e5e5]/30',
  }
  return (
    <span className={`text-xs font-bold uppercase tracking-wide px-2 py-0.5 rounded ${map[status] ?? map.draft}`}>
      {status}
    </span>
  )
}

// Convert cents → display dollars string
function centsToDisplay(cents) {
  return ((cents ?? 0) / 100).toFixed(2)
}

// Convert display dollars → cents for storage
function displayToCents(val) {
  return Math.round((parseFloat(val) || 0) * 100)
}

function DollarInput({ label, value, onChange, hint }) {
  return (
    <div>
      <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">{label}</label>
      {hint && <p className="text-xs text-[#e5e5e5]/30 mb-1.5">{hint}</p>}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#e5e5e5]/40 text-sm font-semibold">$</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full bg-base border border-line rounded-lg pl-7 pr-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand transition-colors"
        />
      </div>
    </div>
  )
}

function Toggle({ value, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${value ? 'bg-brand' : 'bg-line'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value ? 'translate-x-5' : ''}`} />
    </button>
  )
}

export default function AdminEvents() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [activeTab, setActiveTab] = useState(0)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  // Form state
  const [form, setForm] = useState({})
  const [sideEvents, setSideEvents] = useState(DEFAULT_SIDE_EVENTS)
  const [pricing, setPricing] = useState({ main_fee: '0.00', processing_fee_pct: '2.50' })
  const [settings, setSettings] = useState({
    reg_open_date: '', reg_close_date: '',
    require_coc: true, require_ref_test: true, require_payment: true,
    max_teams: '', max_players: '',
  })

  // Logo upload
  const [logoFile, setLogoFile] = useState(null)
  const [logoPreview, setLogoPreview] = useState(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const logoInputRef = useRef()

  // Custom side event form
  const [showAddCustom, setShowAddCustom] = useState(false)
  const [customForm, setCustomForm] = useState(EMPTY_CUSTOM)

  useEffect(() => { loadEvents() }, [])

  async function loadEvents() {
    const { data } = await supabase.from('zltac_events').select('*').order('year', { ascending: false })
    setEvents(data ?? [])
    setLoading(false)
  }

  function resetForm() {
    setForm({ name: 'ZLTAC', year: new Date().getFullYear() + 1, location: '', status: 'draft', description: '', logo_url: '' })
    setSideEvents(DEFAULT_SIDE_EVENTS)
    setPricing({ main_fee: '0.00', processing_fee_pct: '2.50' })
    setSettings({ reg_open_date: '', reg_close_date: '', require_coc: true, require_ref_test: true, require_payment: true, max_teams: '', max_players: '' })
    setLogoFile(null)
    setLogoPreview(null)
    setShowAddCustom(false)
    setCustomForm(EMPTY_CUSTOM)
    setActiveTab(0)
    setMsg(null)
  }

  function startNew() {
    resetForm()
    setEditing('new')
  }

  function startEdit(event) {
    const rawSides = event.side_events
    const loadedSides = rawSides
      ? rawSides.map(se => ({ ...se, price: centsToDisplay(se.price), max_participants: se.max_participants ?? '' }))
      : DEFAULT_SIDE_EVENTS
    setForm({
      name: event.name ?? '',
      year: event.year ?? '',
      location: event.location ?? '',
      status: event.status ?? 'draft',
      description: event.description ?? '',
      logo_url: event.logo_url ?? '',
    })
    setSideEvents(loadedSides)
    setPricing({
      main_fee: centsToDisplay(event.main_fee),
      processing_fee_pct: event.processing_fee_pct != null ? String(event.processing_fee_pct) : '2.50',
    })
    setSettings({
      reg_open_date: event.reg_open_date ? event.reg_open_date.slice(0, 16) : '',
      reg_close_date: event.reg_close_date ? event.reg_close_date.slice(0, 16) : '',
      require_coc: event.require_coc ?? true,
      require_ref_test: event.require_ref_test ?? true,
      require_payment: event.require_payment ?? true,
      max_teams: event.max_teams ?? '',
      max_players: event.max_players ?? '',
    })
    setLogoFile(null)
    setLogoPreview(event.logo_url ?? null)
    setShowAddCustom(false)
    setCustomForm(EMPTY_CUSTOM)
    setActiveTab(0)
    setMsg(null)
    setEditing(event)
  }

  function handleLogoSelect(e) {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      setMsg({ type: 'error', text: 'Logo must be under 2MB.' })
      return
    }
    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
    setMsg(null)
  }

  async function uploadLogo() {
    if (!logoFile) return form.logo_url ?? ''
    setUploadingLogo(true)
    const ext = logoFile.name.split('.').pop()
    const path = `${Date.now()}.${ext}`
    const { data, error } = await supabase.storage.from('event-logos').upload(path, logoFile, { upsert: true })
    setUploadingLogo(false)
    if (error) {
      setMsg({ type: 'error', text: `Logo upload failed: ${error.message}` })
      return form.logo_url ?? ''
    }
    const { data: urlData } = supabase.storage.from('event-logos').getPublicUrl(data.path)
    return urlData.publicUrl
  }

  function addCustomSideEvent() {
    if (!customForm.name.trim()) return
    const slug = customForm.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    setSideEvents(ev => [...ev, {
      slug: `custom-${slug}-${Date.now()}`,
      name: customForm.name,
      description: customForm.description,
      enabled: true,
      price: '0.00',
      max_participants: customForm.max_participants,
      custom: true,
    }])
    setCustomForm(EMPTY_CUSTOM)
    setShowAddCustom(false)
  }

  function removeCustom(slug) {
    setSideEvents(ev => ev.filter(e => e.slug !== slug))
  }

  async function handleSave() {
    setSaving(true)
    setMsg(null)
    const logo_url = await uploadLogo()
    if (msg?.type === 'error') { setSaving(false); return }

    const payload = {
      name: form.name,
      year: parseInt(form.year),
      location: form.location || null,
      status: form.status,
      description: form.description || null,
      logo_url: logo_url || null,
      main_fee: displayToCents(pricing.main_fee),
      processing_fee_pct: parseFloat(pricing.processing_fee_pct) || 0,
      dinner_guest_price: displayToCents(
        sideEvents.find(se => se.slug === 'presentation-dinner')?.price ?? '0'
      ),
      side_events: sideEvents.map(se => ({
        ...se,
        price: displayToCents(se.price),
        max_participants: se.max_participants ? parseInt(se.max_participants) : null,
      })),
      reg_open_date: settings.reg_open_date || null,
      reg_close_date: settings.reg_close_date || null,
      require_coc: settings.require_coc,
      require_ref_test: settings.require_ref_test,
      require_payment: settings.require_payment,
      max_teams: settings.max_teams ? parseInt(settings.max_teams) : null,
      max_players: settings.max_players ? parseInt(settings.max_players) : null,
      updated_at: new Date().toISOString(),
    }

    let err
    if (editing === 'new') {
      ;({ error: err } = await supabase.from('zltac_events').insert(payload))
    } else {
      ;({ error: err } = await supabase.from('zltac_events').update(payload).eq('id', editing.id))
    }

    setSaving(false)
    if (err) {
      setMsg({ type: 'error', text: err.message })
    } else {
      setMsg({ type: 'ok', text: 'Saved.' })
      loadEvents()
      setTimeout(() => setEditing(null), 800)
    }
  }

  // ── EDIT VIEW ──────────────────────────────────────────────────────────────
  if (editing) {
    const enabledSides = sideEvents.filter(se => se.enabled)

    return (
      <div>
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => setEditing(null)} className="text-[#e5e5e5]/40 hover:text-white transition-colors text-sm">
            ← Events
          </button>
          <h1 className="text-xl font-black text-white">
            {editing === 'new' ? 'New Event' : `Edit — ${editing.name} ${editing.year}`}
          </h1>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 border-b border-line mb-6">
          {TABS.map((t, i) => (
            <button
              key={t}
              onClick={() => setActiveTab(i)}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px ${
                activeTab === i ? 'border-brand text-brand' : 'border-transparent text-[#e5e5e5]/40 hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* ── TAB 0: Event Details ─────────────────────────────────────── */}
        {activeTab === 0 && (
          <div className="space-y-5 max-w-xl">
            {[
              { label: 'Event Name', key: 'name', type: 'text' },
              { label: 'Year', key: 'year', type: 'number' },
              { label: 'Location', key: 'location', type: 'text' },
            ].map(({ label, key, type }) => (
              <div key={key}>
                <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">{label}</label>
                <input
                  type={type}
                  value={form[key] ?? ''}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  className="w-full bg-base border border-line rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand transition-colors"
                />
              </div>
            ))}

            <div>
              <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">Status</label>
              <select
                value={form.status ?? 'draft'}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                className="w-full bg-base border border-line rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand transition-colors"
              >
                {['draft', 'open', 'closed', 'archived'].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">Description</label>
              <textarea
                rows={4}
                value={form.description ?? ''}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full bg-base border border-line rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand transition-colors resize-none"
              />
            </div>

            {/* Logo upload */}
            <div>
              <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">Event Logo</label>
              <p className="text-xs text-[#e5e5e5]/30 mb-2">PNG or JPG, max 2MB. Shown on the event page and event list.</p>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg"
                onChange={handleLogoSelect}
                className="hidden"
              />
              {logoPreview ? (
                <div className="flex items-center gap-4">
                  <img src={logoPreview} alt="Logo preview" className="h-16 w-16 object-contain rounded-lg border border-line bg-base p-1" />
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => logoInputRef.current.click()}
                      className="text-xs bg-line hover:bg-[#374056] text-[#e5e5e5]/70 hover:text-white font-semibold px-3 py-1.5 rounded-lg transition-colors"
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      onClick={() => { setLogoFile(null); setLogoPreview(null); setForm(f => ({ ...f, logo_url: '' })) }}
                      className="text-xs text-red-400/60 hover:text-red-400 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => logoInputRef.current.click()}
                  className="w-full border border-dashed border-line hover:border-brand rounded-xl py-6 text-center transition-colors group"
                >
                  <svg className="w-6 h-6 mx-auto mb-2 text-[#e5e5e5]/20 group-hover:text-brand transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span className="text-xs text-[#e5e5e5]/30 group-hover:text-brand transition-colors">Click to upload logo</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── TAB 1: Side Events ───────────────────────────────────────── */}
        {activeTab === 1 && (
          <div className="space-y-3 max-w-2xl">
            {sideEvents.map((se, i) => (
              <div
                key={se.slug}
                className={`rounded-xl border p-4 transition-colors ${se.enabled ? 'bg-surface border-line' : 'bg-base border-line opacity-60'}`}
              >
                <div className="flex items-start gap-3">
                  <Toggle value={se.enabled} onChange={v => setSideEvents(ev => ev.map((e, j) => j === i ? { ...e, enabled: v } : e))} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-semibold text-white text-sm">{se.name}</p>
                      {se.custom && (
                        <button
                          onClick={() => removeCustom(se.slug)}
                          className="text-xs text-red-400/50 hover:text-red-400 transition-colors ml-2"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs text-[#e5e5e5]/30 mb-1">Description</label>
                        <input
                          type="text"
                          value={se.description ?? ''}
                          onChange={e => setSideEvents(ev => ev.map((s, j) => j === i ? { ...s, description: e.target.value } : s))}
                          className="w-full bg-base border border-line rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-brand"
                        />
                      </div>
                      <div className="w-40">
                        <label className="block text-xs text-[#e5e5e5]/30 mb-1">Max Participants</label>
                        <input
                          type="number"
                          value={se.max_participants ?? ''}
                          placeholder="Unlimited"
                          onChange={e => setSideEvents(ev => ev.map((s, j) => j === i ? { ...s, max_participants: e.target.value } : s))}
                          className="w-full bg-base border border-line rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-brand placeholder-[#e5e5e5]/20"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {/* Add custom side event */}
            {showAddCustom ? (
              <div className="bg-base border border-brand/20 rounded-xl p-4 space-y-3">
                <p className="text-xs font-bold text-white uppercase tracking-wider">New Side Event</p>
                {[
                  { label: 'Event Name', key: 'name', type: 'text' },
                  { label: 'Description', key: 'description', type: 'text' },
                  { label: 'Max Participants', key: 'max_participants', type: 'number' },
                ].map(({ label, key, type }) => (
                  <div key={key}>
                    <label className="block text-xs text-[#e5e5e5]/40 mb-1">{label}</label>
                    <input
                      type={type}
                      value={customForm[key]}
                      placeholder={key === 'max_participants' ? 'Unlimited' : ''}
                      onChange={e => setCustomForm(f => ({ ...f, [key]: e.target.value }))}
                      className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand placeholder-[#e5e5e5]/20"
                    />
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={addCustomSideEvent}
                    disabled={!customForm.name.trim()}
                    className="text-sm bg-brand hover:bg-brand-hover disabled:opacity-40 text-black font-bold px-4 py-2 rounded-xl transition-all"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => { setShowAddCustom(false); setCustomForm(EMPTY_CUSTOM) }}
                    className="text-sm border border-line text-[#e5e5e5]/50 hover:text-white px-4 py-2 rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAddCustom(true)}
                className="w-full border border-dashed border-line hover:border-brand text-[#e5e5e5]/40 hover:text-brand text-sm font-semibold py-3 rounded-xl transition-colors"
              >
                + Add another side event
              </button>
            )}
          </div>
        )}

        {/* ── TAB 2: Pricing ───────────────────────────────────────────── */}
        {activeTab === 2 && (
          <div className="grid md:grid-cols-2 gap-6 max-w-3xl">
            <div className="space-y-4">
              <DollarInput
                label="Player Registration Fee (AUD)"
                hint="The main event entry fee per player"
                value={pricing.main_fee}
                onChange={v => setPricing(p => ({ ...p, main_fee: v }))}
              />

              <div>
                <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">Processing Fee (%)</label>
                <p className="text-xs text-[#e5e5e5]/30 mb-1.5">Added to the total at checkout</p>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={pricing.processing_fee_pct}
                    onChange={e => setPricing(p => ({ ...p, processing_fee_pct: e.target.value }))}
                    className="w-full bg-base border border-line rounded-lg px-3 pr-8 py-2.5 text-sm text-white focus:outline-none focus:border-brand transition-colors"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#e5e5e5]/40 text-sm">%</span>
                </div>
              </div>

              {enabledSides.length > 0 && (
                <div>
                  <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-3">
                    Side Event Prices (AUD per participant)
                  </label>
                  <div className="space-y-3">
                    {enabledSides.map(se => {
                      const idx = sideEvents.findIndex(s => s.slug === se.slug)
                      return (
                        <div key={se.slug}>
                          <label className="block text-xs text-[#e5e5e5]/40 mb-1">{se.name}</label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#e5e5e5]/40 text-sm font-semibold">$</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={sideEvents[idx]?.price ?? '0.00'}
                              onChange={e => setSideEvents(ev => ev.map((s, j) => j === idx ? { ...s, price: e.target.value } : s))}
                              className="w-full bg-base border border-line rounded-lg pl-7 pr-3 py-2 text-sm text-white focus:outline-none focus:border-brand transition-colors"
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Live preview */}
            <div className="bg-base border border-line rounded-xl p-5 h-fit">
              <p className="text-xs text-[#e5e5e5]/40 font-bold uppercase tracking-wider mb-4">Price Preview</p>
              <div className="space-y-2.5">
                <div className="flex justify-between text-sm">
                  <span className="text-[#e5e5e5]/60">Main Event Entry</span>
                  <span className="text-white font-semibold">${parseFloat(pricing.main_fee || 0).toFixed(2)}</span>
                </div>
                {enabledSides.map(se => (
                  <div key={se.slug} className="flex justify-between text-sm">
                    <span className="text-[#e5e5e5]/60">{se.name}</span>
                    <span className="text-white font-semibold">${parseFloat(se.price || 0).toFixed(2)}</span>
                  </div>
                ))}
                <div className="border-t border-line pt-2.5 mt-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-[#e5e5e5]/40">Processing Fee</span>
                    <span className="text-[#e5e5e5]/40">{pricing.processing_fee_pct}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── TAB 3: Registration Settings ─────────────────────────────── */}
        {activeTab === 3 && (
          <div className="space-y-4 max-w-xl">
            {[
              { label: 'Registration Opens', key: 'reg_open_date', type: 'datetime-local' },
              { label: 'Registration Closes', key: 'reg_close_date', type: 'datetime-local' },
              { label: 'Max Teams', key: 'max_teams', type: 'number' },
              { label: 'Max Players', key: 'max_players', type: 'number' },
            ].map(({ label, key, type }) => (
              <div key={key}>
                <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">{label}</label>
                <input
                  type={type}
                  value={settings[key] ?? ''}
                  placeholder="Unlimited"
                  onChange={e => setSettings(s => ({ ...s, [key]: e.target.value || '' }))}
                  className="w-full bg-base border border-line rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand placeholder-[#e5e5e5]/20"
                />
              </div>
            ))}
            <div className="space-y-3 pt-2">
              {[
                { label: 'Require Code of Conduct', key: 'require_coc' },
                { label: 'Require Referee Test', key: 'require_ref_test' },
                { label: 'Require Payment before confirmation', key: 'require_payment' },
              ].map(({ label, key }) => (
                <label key={key} className="flex items-center gap-3 cursor-pointer">
                  <Toggle value={settings[key]} onChange={v => setSettings(s => ({ ...s, [key]: v }))} />
                  <span className="text-sm text-[#e5e5e5]/70">{label}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center gap-3 mt-8 pt-6 border-t border-line">
          <button
            onClick={handleSave}
            disabled={saving || uploadingLogo}
            className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-6 py-2.5 rounded-xl text-sm transition-all"
          >
            {saving || uploadingLogo ? 'Saving…' : 'Save Event'}
          </button>
          <button
            onClick={() => setEditing(null)}
            className="border border-line hover:border-[#374056] text-[#e5e5e5]/60 hover:text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors"
          >
            Cancel
          </button>
          {msg && (
            <span className={`text-sm ml-2 ${msg.type === 'ok' ? 'text-brand' : 'text-red-400'}`}>{msg.text}</span>
          )}
        </div>
      </div>
    )
  }

  // ── LIST VIEW ──────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-white">Events</h1>
          <p className="text-[#e5e5e5]/40 text-sm mt-1">Manage ZLTAC events and settings</p>
        </div>
        <button
          onClick={startNew}
          className="bg-brand hover:bg-brand-hover text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-all"
        >
          + New Event
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-16 text-[#e5e5e5]/30 text-sm">No events yet. Create the first one.</div>
      ) : (
        <div className="space-y-3">
          {events.map(e => (
            <div key={e.id} className="bg-surface border border-line rounded-xl p-5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                {e.logo_url
                  ? <img src={e.logo_url} alt={e.name} className="h-10 w-10 object-contain rounded-lg border border-line bg-base p-0.5 flex-shrink-0" />
                  : <div className="h-10 w-10 rounded-lg border border-line bg-base flex items-center justify-center text-xl flex-shrink-0">🎯</div>
                }
                <div>
                  <div className="flex items-center gap-3 mb-0.5">
                    <h3 className="font-bold text-white">{e.name}</h3>
                    <Badge status={e.status} />
                  </div>
                  <p className="text-xs text-[#e5e5e5]/40">{e.year}{e.location ? ` · ${e.location}` : ''}</p>
                </div>
              </div>
              <button
                onClick={() => startEdit(e)}
                className="text-xs bg-line hover:bg-[#374056] text-[#e5e5e5]/70 hover:text-white font-semibold px-4 py-2 rounded-lg transition-colors flex-shrink-0"
              >
                Edit
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
