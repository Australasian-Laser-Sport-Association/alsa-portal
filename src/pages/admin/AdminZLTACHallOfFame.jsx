import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { apiFetch } from '../../lib/apiFetch.js'

const inputClass = 'w-full bg-[#191919] border border-line rounded-lg px-3 py-2 text-sm text-white placeholder-[#e5e5e5]/30 focus:outline-none focus:border-brand/50 transition-colors'
const labelClass = 'block text-xs font-medium text-[#e5e5e5]/60 uppercase tracking-wider mb-1.5'

const CURRENT_YEAR = new Date().getFullYear()
const MIN_YEAR = 1999
const MAX_YEAR = CURRENT_YEAR + 1
const HISTORY_CONTENT_API = '/api/admin/event?resource=history-content'

function emptyForm() {
  return {
    real_name: '',
    alias: '',
    induction_year: CURRENT_YEAR,
    contribution: '',
    photo_url: '',
    display_order: 0,
    is_visible: true,
  }
}

function preview(text, n = 80) {
  if (!text) return ''
  const t = text.trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

export default function AdminZLTACHallOfFame() {
  useOutletContext()
  const [rows, setRows] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [selected, setSelected] = useState(null) // 'new' | uuid | null
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [toast, setToast] = useState(null)
  const [errors, setErrors] = useState({})

  async function loadList() {
    setLoadingList(true)
    try {
      const { records = [] } = await apiFetch(`${HISTORY_CONTENT_API}&entity=hall-of-fame`)
      setRows(records)
    } catch (error) {
      showToast(error?.message || 'Could not load Hall of Fame inductees. Please try again.', 'error')
    } finally {
      setLoadingList(false)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadList() }, [])

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  function setField(key, val) {
    setForm(f => ({ ...f, [key]: val }))
    if (errors[key]) setErrors(e => ({ ...e, [key]: undefined }))
  }

  async function selectRow(id) {
    setSelected(id)
    setConfirmDelete(false)
    setErrors({})
    try {
      const { record: data } = await apiFetch(
        `${HISTORY_CONTENT_API}&entity=hall-of-fame&id=${encodeURIComponent(id)}`,
      )
      if (!data) throw new Error('Hall of Fame inductee was not found.')
      setForm({
        real_name: data.real_name ?? '',
        alias: data.alias ?? '',
        induction_year: data.induction_year ?? CURRENT_YEAR,
        contribution: data.contribution ?? '',
        photo_url: data.photo_url ?? '',
        display_order: data.display_order ?? 0,
        is_visible: data.is_visible ?? true,
      })
    } catch (error) {
      setSelected(null)
      setForm(emptyForm())
      showToast(error?.message || 'Could not load the inductee. Please try again.', 'error')
    }
  }

  function startNew() {
    setSelected('new')
    setConfirmDelete(false)
    setErrors({})
    setForm(emptyForm())
  }

  function cancelEdit() {
    setSelected(null)
    setConfirmDelete(false)
    setErrors({})
  }

  function validate() {
    const e = {}
    if (!form.real_name?.trim()) e.real_name = 'Real name is required.'
    const yr = parseInt(form.induction_year)
    if (!Number.isInteger(yr)) {
      e.induction_year = 'Induction year is required.'
    } else if (yr < MIN_YEAR || yr > MAX_YEAR) {
      e.induction_year = `Year must be between ${MIN_YEAR} and ${MAX_YEAR}.`
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function save() {
    if (!validate()) return
    setSaving(true)
    const payload = {
      real_name: form.real_name.trim(),
      alias: form.alias?.trim() || null,
      induction_year: parseInt(form.induction_year),
      contribution: form.contribution?.trim() || null,
      photo_url: form.photo_url?.trim() || null,
      display_order: parseInt(form.display_order) || 0,
      is_visible: !!form.is_visible,
    }

    try {
      const result = await apiFetch(HISTORY_CONTENT_API, {
        method: selected === 'new' ? 'POST' : 'PATCH',
        body: JSON.stringify({
          entity: 'hall-of-fame',
          ...(selected === 'new' ? {} : { id: selected }),
          data: payload,
        }),
      })
      const savedId = result?.record?.id ?? (selected === 'new' ? null : selected)
      if (!savedId) {
        throw new Error('The inductee was saved but could not be reloaded. Please refresh the page.')
      }
      showToast('Saved.')
      await loadList()
      if (selected === 'new') setSelected(savedId)
    } catch (error) {
      showToast(error?.message || 'Could not save the inductee. Please try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function deleteRow() {
    if (selected === 'new' || !selected) return
    setDeleting(true)
    try {
      await apiFetch(HISTORY_CONTENT_API, {
        method: 'DELETE',
        body: JSON.stringify({ entity: 'hall-of-fame', id: selected }),
      })
      setConfirmDelete(false)
      showToast('Inductee deleted.')
      setSelected(null)
      setForm(emptyForm())
      loadList()
    } catch (error) {
      showToast(error?.message || 'Could not delete the inductee. Please try again.', 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col md:flex-row gap-6" style={{ minHeight: 'calc(100vh - 10rem)' }}>
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-xl border ${
          toast.type === 'error'
            ? 'bg-red-500/10 border-red-500/30 text-red-400'
            : 'bg-brand/10 border-brand/30 text-brand'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Left: list */}
      <div className="w-full md:w-80 flex-shrink-0 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-black text-white">Hall of Fame</h1>
          <button
            onClick={startNew}
            className="text-xs bg-brand/10 hover:bg-brand/20 text-brand border border-brand/20 px-3 py-1.5 rounded-lg font-medium transition-colors"
          >
            + Add inductee
          </button>
        </div>
        <p className="text-xs text-[#e5e5e5]/60">
          {rows.length} {rows.length === 1 ? 'inductee' : 'inductees'} ·{' '}
          {rows.filter(r => !r.is_visible).length} hidden
        </p>

        <div className="flex flex-col gap-2 max-h-[60vh] md:max-h-none overflow-y-auto pr-1">
          {loadingList && (
            <div className="flex justify-center py-8">
              <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!loadingList && rows.length === 0 && (
            <p className="text-[#e5e5e5]/60 text-sm text-center py-10">No inductees yet.</p>
          )}
          {rows.map(r => (
            <button
              key={r.id}
              onClick={() => selectRow(r.id)}
              className={`text-left px-3 py-2.5 rounded-xl border transition-all ${
                selected === r.id
                  ? 'bg-brand/10 border-brand/30'
                  : 'bg-surface border-line hover:border-brand/20'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="font-bold text-white text-sm truncate">{r.real_name}</span>
                {!r.is_visible && (
                  <span className="text-[10px] bg-[#191919] border border-line text-[#e5e5e5]/60 px-1.5 py-0.5 rounded font-medium uppercase tracking-wide flex-shrink-0">
                    Hidden
                  </span>
                )}
              </div>
              <p className="text-xs text-amber-400/80 truncate">
                {r.alias || <span className="text-[#e5e5e5]/60 italic">no alias</span>} · Inducted {r.induction_year}
              </p>
              {r.contribution && (
                <p className="text-[11px] text-[#e5e5e5]/60 mt-1 line-clamp-2">{preview(r.contribution)}</p>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Right: edit pane */}
      {selected ? (
        <div className="flex-1 bg-surface border border-line rounded-2xl flex flex-col overflow-hidden">
          <div className="px-6 py-4 border-b border-line flex items-center justify-between gap-3 flex-shrink-0">
            <div className="min-w-0">
              <p className="text-xs text-[#e5e5e5]/60 uppercase tracking-wider">
                {selected === 'new' ? 'New inductee' : 'Editing'}
              </p>
              <p className="text-white font-bold text-sm truncate">
                {form.real_name || (selected === 'new' ? '(unnamed)' : '—')}
              </p>
            </div>
            <button
              onClick={cancelEdit}
              className="text-xs text-[#e5e5e5]/60 hover:text-white transition-colors"
            >
              ✕ Close
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            <div className="space-y-5 max-w-xl">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Real name *</label>
                  <input
                    className={inputClass}
                    value={form.real_name}
                    onChange={e => setField('real_name', e.target.value)}
                    placeholder="Doug Burbidge"
                  />
                  {errors.real_name && <p className="text-xs text-red-400 mt-1">{errors.real_name}</p>}
                </div>
                <div>
                  <label className={labelClass}>Alias / callsign</label>
                  <input
                    className={inputClass}
                    value={form.alias}
                    onChange={e => setField('alias', e.target.value)}
                    placeholder="Ronin441"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Induction year *</label>
                  <input
                    type="number"
                    className={inputClass}
                    value={form.induction_year}
                    onChange={e => setField('induction_year', e.target.value)}
                    min={MIN_YEAR}
                    max={MAX_YEAR}
                  />
                  {errors.induction_year && <p className="text-xs text-red-400 mt-1">{errors.induction_year}</p>}
                </div>
                <div>
                  <label className={labelClass}>Sort order</label>
                  <input
                    type="number"
                    className={inputClass}
                    value={form.display_order}
                    onChange={e => setField('display_order', e.target.value)}
                  />
                  <p className="text-xs text-[#e5e5e5]/60 mt-1">Lower numbers sort first (within the same year).</p>
                </div>
              </div>

              <div>
                <label className={labelClass}>Contribution</label>
                <textarea
                  className={`${inputClass} resize-y`}
                  rows={5}
                  value={form.contribution}
                  onChange={e => setField('contribution', e.target.value)}
                  placeholder="What did this person contribute? Shown on the public Hall of Fame card."
                />
                <p className="text-xs text-[#e5e5e5]/60 mt-1">Leave blank to render &ldquo;Citation to be added&rdquo; on the public page.</p>
              </div>

              <div>
                <label className={labelClass}>Photo URL</label>
                <input
                  className={inputClass}
                  value={form.photo_url}
                  onChange={e => setField('photo_url', e.target.value)}
                  placeholder="https://… (optional)"
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!form.is_visible}
                    onChange={e => setField('is_visible', e.target.checked)}
                    className="w-4 h-4 accent-brand"
                  />
                  <span className="text-sm text-white">Show on public Hall of Fame</span>
                </label>
              </div>
            </div>
          </div>

          <div className="px-6 py-4 border-t border-line flex items-center justify-between flex-shrink-0 gap-3">
            <div>
              {selected !== 'new' && !confirmDelete && (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="text-xs text-red-400/70 hover:text-red-400 transition-colors"
                >
                  Delete inductee
                </button>
              )}
              {selected !== 'new' && confirmDelete && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-400">Delete permanently?</span>
                  <button
                    onClick={deleteRow}
                    disabled={deleting}
                    className="text-xs bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/30 px-2.5 py-1 rounded font-medium disabled:opacity-50"
                  >
                    {deleting ? 'Deleting…' : 'Yes, delete'}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="text-xs text-[#e5e5e5]/60 hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={save}
              disabled={saving}
              className="bg-brand hover:bg-brand-hover disabled:opacity-40 text-black font-bold px-6 py-2.5 rounded-xl text-sm transition-all"
            >
              {saving ? 'Saving…' : selected === 'new' ? 'Create inductee' : 'Save changes'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 bg-surface border border-line rounded-2xl flex items-center justify-center min-h-[300px]">
          <div className="text-center px-6">
            <div className="w-14 h-14 bg-[#191919] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">★</span>
            </div>
            <p className="text-[#e5e5e5]/60 text-sm leading-relaxed">
              Select an inductee from the list<br />
              or click <span className="text-brand/60">+ Add inductee</span> to create one.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
