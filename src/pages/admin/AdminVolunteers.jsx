import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { apiFetch } from '../../lib/apiFetch.js'
import { formatDate } from '../../lib/dateFormat'

const TABS = ['Roles', 'Event Settings', 'Signups']

const DEFAULT_CAVEAT = 'Note: Not all volunteers will be utilised. Selection is based on the operational capacity of the ZLTAC event.'

const EMPTY_ROLE = {
  code: '', name: '', short_description: '',
  target_count: '', min_count: '',
  requires_experience: false, experience_notes: '',
  is_default: false, sort_order: 0, is_active: true,
}

// ── Shared bits (mirrors AdminEvent / AdminRegistrations) ────────────────────
function Toggle({ value, onChange, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 disabled:opacity-40 ${value ? 'bg-brand' : 'bg-line'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${value ? 'translate-x-5' : ''}`} />
    </button>
  )
}

function Pill({ color, children }) {
  const styles = {
    green: 'bg-green-500/15 text-green-400 border-green-500/30',
    red:   'bg-red-500/15 text-red-400 border-red-500/30',
    amber: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    brand: 'bg-brand/10 text-brand border-brand/20',
    grey:  'bg-[#374056] text-[#e5e5e5]/40 border-line',
  }
  return (
    <span className={`inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border whitespace-nowrap ${styles[color]}`}>
      {children}
    </span>
  )
}

const INPUT_CLS = 'w-full bg-base border border-line rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand transition-colors placeholder-[#e5e5e5]/25 disabled:opacity-40'
const LABEL_CLS = 'block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5'

// Raw fetch that exposes status + parsed body, so callers can branch on 409
// (delete-in-use, duplicate code) and read extra fields. apiFetch throws away
// both, so it's used only for plain GETs here.
async function rawApi(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...(options.headers ?? {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, body }
}

function eventLabel(ev) {
  return ev.name?.trim() ? ev.name : `ZLTAC ${ev.year}`
}

// ── Tab 1: Roles ─────────────────────────────────────────────────────────────
function RolesTab() {
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_ROLE)
  const [saving, setSaving] = useState(false)
  const [fieldErr, setFieldErr] = useState({}) // { code: '...' }
  const [msg, setMsg] = useState(null)
  const [sortEdits, setSortEdits] = useState({})
  const [deleteModal, setDeleteModal] = useState(null) // { role, refCount, busy, error, soft }

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const { roles } = await apiFetch('/api/admin/volunteers?resource=roles')
      setRoles(roles ?? [])
      setSortEdits({})
    } catch (err) {
      setMsg({ type: 'error', text: err.message })
    }
    setLoading(false)
  }

  function startAdd() {
    setForm(EMPTY_ROLE); setEditingId(null); setFieldErr({}); setMsg(null); setFormOpen(true)
  }
  function startEdit(r) {
    setForm({
      code: r.code ?? '', name: r.name ?? '', short_description: r.short_description ?? '',
      target_count: r.target_count ?? '', min_count: r.min_count ?? '',
      requires_experience: !!r.requires_experience, experience_notes: r.experience_notes ?? '',
      is_default: !!r.is_default, sort_order: r.sort_order ?? 0, is_active: !!r.is_active,
    })
    setEditingId(r.id); setFieldErr({}); setMsg(null); setFormOpen(true)
  }

  function validateClient() {
    const errs = {}
    const code = (form.code ?? '').trim().toUpperCase()
    if (!code) errs.code = 'Code is required.'
    else if (!/^[A-Z0-9]{1,5}$/.test(code)) errs.code = 'Code must be 1–5 uppercase letters or numbers.'
    if (!form.name.trim()) errs.name = 'Name is required.'
    if (!form.short_description.trim()) errs.short_description = 'Short description is required.'
    return errs
  }

  async function handleSave() {
    const errs = validateClient()
    if (Object.keys(errs).length) { setFieldErr(errs); return }
    setSaving(true); setMsg(null); setFieldErr({})
    const payload = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      short_description: form.short_description.trim(),
      target_count: form.target_count,
      min_count: form.min_count,
      requires_experience: form.requires_experience,
      experience_notes: form.requires_experience ? (form.experience_notes ?? '') : null,
      is_default: form.is_default,
      sort_order: form.sort_order,
      is_active: form.is_active,
    }
    const { ok, body } = editingId
      ? await rawApi(`/api/admin/volunteers?resource=roles&id=${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) })
      : await rawApi('/api/admin/volunteers?resource=roles', { method: 'POST', body: JSON.stringify(payload) })
    setSaving(false)
    if (!ok) {
      if (body?.field) setFieldErr({ [body.field]: body.error })
      else setMsg({ type: 'error', text: body?.error || 'Save failed.' })
      return
    }
    setFormOpen(false)
    await load()
    setMsg({ type: 'ok', text: editingId ? 'Role updated.' : 'Role added.' })
  }

  async function patchRole(id, fields) {
    const { ok, body } = await rawApi(`/api/admin/volunteers?resource=roles&id=${id}`, { method: 'PATCH', body: JSON.stringify(fields) })
    if (!ok) { setMsg({ type: 'error', text: body?.error || 'Update failed.' }); return false }
    return true
  }

  async function toggleActive(r) {
    if (await patchRole(r.id, { is_active: !r.is_active })) load()
  }
  async function toggleDefault(r) {
    // Setting default clears it elsewhere server-side; reload to reflect.
    if (await patchRole(r.id, { is_default: !r.is_default })) load()
  }
  async function commitSort(r) {
    const raw = sortEdits[r.id]
    if (raw === undefined || raw === String(r.sort_order)) return
    if (await patchRole(r.id, { sort_order: raw })) load()
    else setSortEdits(s => { const n = { ...s }; delete n[r.id]; return n })
  }

  // Delete: try hard delete; a 409 means it's referenced → offer soft delete.
  async function tryDelete() {
    setDeleteModal(m => ({ ...m, busy: true, error: null }))
    const { ok, status, body } = await rawApi(`/api/admin/volunteers?resource=roles&id=${deleteModal.role.id}`, { method: 'DELETE' })
    if (ok) {
      setDeleteModal(null); await load(); setMsg({ type: 'ok', text: 'Role deleted.' }); return
    }
    if (status === 409) {
      setDeleteModal(m => ({ ...m, busy: false, soft: true, refCount: body?.referenceCount ?? null, error: body?.error }))
      return
    }
    setDeleteModal(m => ({ ...m, busy: false, error: body?.error || 'Delete failed.' }))
  }
  async function softDelete() {
    setDeleteModal(m => ({ ...m, busy: true, error: null }))
    if (await patchRole(deleteModal.role.id, { is_active: false })) {
      setDeleteModal(null); await load(); setMsg({ type: 'ok', text: 'Role deactivated.' })
    } else {
      setDeleteModal(m => ({ ...m, busy: false, error: 'Could not deactivate.' }))
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <p className="text-[#e5e5e5]/40 text-sm">{roles.length} role{roles.length !== 1 ? 's' : ''} in the library</p>
        <div className="flex items-center gap-3">
          {msg && <span className={`text-sm ${msg.type === 'ok' ? 'text-brand' : 'text-red-400'}`}>{msg.text}</span>}
          <button onClick={startAdd}
            className="bg-brand hover:bg-brand-hover text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-all">
            + Add Role
          </button>
        </div>
      </div>

      {/* Add / edit form */}
      {formOpen && (
        <div className="bg-surface border border-brand/20 rounded-xl p-5 mb-6 max-w-2xl">
          <h2 className="text-sm font-bold text-white mb-4">{editingId ? 'Edit Role' : 'Add Role'}</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={LABEL_CLS}>Code</label>
                <input type="text" maxLength={5} value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  className={INPUT_CLS} placeholder="AEC" />
                {fieldErr.code && <p className="text-red-400 text-xs mt-1">{fieldErr.code}</p>}
              </div>
              <div className="sm:col-span-2">
                <label className={LABEL_CLS}>Name</label>
                <input type="text" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className={INPUT_CLS} placeholder="Assistant Event Coordinator" />
                {fieldErr.name && <p className="text-red-400 text-xs mt-1">{fieldErr.name}</p>}
              </div>
            </div>

            <div>
              <label className={LABEL_CLS}>Short description</label>
              <textarea rows={2} value={form.short_description}
                onChange={e => setForm(f => ({ ...f, short_description: e.target.value }))}
                className={`${INPUT_CLS} resize-none`} placeholder="One-line summary players see when choosing roles" />
              {fieldErr.short_description && <p className="text-red-400 text-xs mt-1">{fieldErr.short_description}</p>}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className={LABEL_CLS}>Target count</label>
                <input type="number" min="0" value={form.target_count}
                  onChange={e => setForm(f => ({ ...f, target_count: e.target.value }))}
                  className={INPUT_CLS} placeholder="—" />
              </div>
              <div>
                <label className={LABEL_CLS}>Min count</label>
                <input type="number" min="0" value={form.min_count}
                  onChange={e => setForm(f => ({ ...f, min_count: e.target.value }))}
                  className={INPUT_CLS} placeholder="—" />
              </div>
              <div>
                <label className={LABEL_CLS}>Sort order</label>
                <input type="number" min="0" value={form.sort_order}
                  onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))}
                  className={INPUT_CLS} />
              </div>
            </div>

            <div className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer bg-base border border-line rounded-xl p-4">
                <Toggle value={form.requires_experience} onChange={v => setForm(f => ({ ...f, requires_experience: v }))} />
                <div>
                  <p className="text-sm font-semibold text-white">Requires experience</p>
                  <p className="text-xs text-[#e5e5e5]/40 mt-0.5">Surfaces the experience notes to players for this role</p>
                </div>
              </label>
              {form.requires_experience && (
                <div>
                  <label className={LABEL_CLS}>Experience notes</label>
                  <textarea rows={2} value={form.experience_notes ?? ''}
                    onChange={e => setForm(f => ({ ...f, experience_notes: e.target.value }))}
                    className={`${INPUT_CLS} resize-none`} placeholder="e.g. Min 3 yrs as a Referee at ZLTAC, or 2 written recommendations" />
                </div>
              )}
              <label className="flex items-start gap-3 cursor-pointer bg-base border border-line rounded-xl p-4">
                <Toggle value={form.is_default} onChange={v => setForm(f => ({ ...f, is_default: v }))} />
                <div>
                  <p className="text-sm font-semibold text-white">Default role</p>
                  <p className="text-xs text-[#e5e5e5]/40 mt-0.5">Pre-selected for new volunteers. Only one role can be the default — setting this clears it elsewhere.</p>
                </div>
              </label>
              <label className="flex items-start gap-3 cursor-pointer bg-base border border-line rounded-xl p-4">
                <Toggle value={form.is_active} onChange={v => setForm(f => ({ ...f, is_active: v }))} />
                <div>
                  <p className="text-sm font-semibold text-white">Active</p>
                  <p className="text-xs text-[#e5e5e5]/40 mt-0.5">Inactive roles are hidden from the volunteer sign-up form</p>
                </div>
              </label>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button onClick={handleSave} disabled={saving}
                className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-5 py-2 rounded-xl text-sm transition-all">
                {saving ? 'Saving…' : editingId ? 'Update Role' : 'Add Role'}
              </button>
              <button onClick={() => { setFormOpen(false); setMsg(null) }}
                className="border border-line text-[#e5e5e5]/60 hover:text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Roles table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="bg-surface border border-line rounded-xl overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="border-b border-line">
                {['Sort', 'Code', 'Name', 'Active', 'Default', 'Exp', 'Target / Min', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs text-[#e5e5e5]/40 font-bold uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {roles.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-[#e5e5e5]/30 text-sm">No roles yet</td></tr>
              ) : roles.map(r => (
                <tr key={r.id} className={`border-b border-line last:border-0 hover:bg-line/30 transition-colors ${r.is_active ? '' : 'opacity-50'}`}>
                  <td className="px-4 py-3">
                    <input
                      type="number" min="0"
                      value={sortEdits[r.id] ?? String(r.sort_order)}
                      onChange={e => setSortEdits(s => ({ ...s, [r.id]: e.target.value }))}
                      onBlur={() => commitSort(r)}
                      className="w-16 bg-base border border-line rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-brand"
                    />
                  </td>
                  <td className="px-4 py-3"><span className="text-brand font-bold text-xs">{r.code}</span></td>
                  <td className="px-4 py-3 text-white font-semibold whitespace-nowrap">{r.name}</td>
                  <td className="px-4 py-3"><Toggle value={r.is_active} onChange={() => toggleActive(r)} /></td>
                  <td className="px-4 py-3"><Toggle value={r.is_default} onChange={() => toggleDefault(r)} /></td>
                  <td className="px-4 py-3">{r.requires_experience ? <Pill color="amber">Yes</Pill> : <span className="text-[#e5e5e5]/25 text-xs">—</span>}</td>
                  <td className="px-4 py-3 text-[#e5e5e5]/60 text-xs whitespace-nowrap">{r.target_count ?? '—'} / {r.min_count ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <button onClick={() => startEdit(r)} className="text-xs text-[#e5e5e5]/50 hover:text-brand transition-colors font-semibold">Edit</button>
                      <button onClick={() => setDeleteModal({ role: r, refCount: null, busy: false, error: null, soft: false })}
                        className="text-xs text-[#e5e5e5]/50 hover:text-red-400 transition-colors font-semibold">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete / soft-delete modal */}
      {deleteModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4">
          <div className="bg-surface border border-line rounded-2xl p-6 max-w-sm w-full">
            {deleteModal.soft ? (
              <>
                <p className="text-white font-bold mb-2">Can't delete {deleteModal.role.name}</p>
                <p className="text-[#e5e5e5]/50 text-sm mb-5">
                  {deleteModal.error || 'This role is in use by existing signups.'}{' '}
                  Deactivate it instead to hide it from the sign-up form while keeping the existing records intact.
                </p>
                {deleteModal.error && deleteModal.refCount === null && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 mb-4"><p className="text-red-400 text-xs">{deleteModal.error}</p></div>
                )}
                <div className="flex gap-3">
                  <button onClick={softDelete} disabled={deleteModal.busy}
                    className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold px-5 py-2 rounded-xl text-sm transition-colors">
                    {deleteModal.busy ? 'Working…' : 'Deactivate role'}
                  </button>
                  <button onClick={() => setDeleteModal(null)}
                    className="border border-line text-[#e5e5e5]/60 hover:text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors">Cancel</button>
                </div>
              </>
            ) : (
              <>
                <p className="text-white font-bold mb-2">Delete {deleteModal.role.name}?</p>
                <p className="text-[#e5e5e5]/50 text-sm mb-5">
                  This permanently removes the <span className="text-white font-mono">{deleteModal.role.code}</span> role. If it's referenced by any signup you'll be offered to deactivate it instead.
                </p>
                {deleteModal.error && (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 mb-4"><p className="text-red-400 text-xs">{deleteModal.error}</p></div>
                )}
                <div className="flex gap-3">
                  <button onClick={tryDelete} disabled={deleteModal.busy}
                    className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-bold px-5 py-2 rounded-xl text-sm transition-colors">
                    {deleteModal.busy ? 'Deleting…' : 'Delete role'}
                  </button>
                  <button onClick={() => setDeleteModal(null)}
                    className="border border-line text-[#e5e5e5]/60 hover:text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors">Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab 2: Event Settings ────────────────────────────────────────────────────
function SettingsTab() {
  const [events, setEvents] = useState([])
  const [eventId, setEventId] = useState('')
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    supabase.from('zltac_events').select('id, year, name, status').order('year', { ascending: false })
      .then(({ data }) => {
        const list = data ?? []
        setEvents(list)
        const open = list.find(e => e.status === 'open')
        setEventId(open?.id ?? list[0]?.id ?? '')
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (!eventId) { setForm(null); return }
    loadSettings(eventId)
  }, [eventId])

  async function loadSettings(id) {
    setForm(null); setMsg(null)
    const { ok, status, body } = await rawApi(`/api/admin/volunteers?resource=settings&eventId=${id}`)
    if (ok) {
      const s = body.settings
      setForm({
        required_per_team: !!s.required_per_team,
        count_per_team: s.count_per_team ?? '',
        enforcement: s.enforcement ?? 'soft',
        caveat_message: s.caveat_message ?? DEFAULT_CAVEAT,
      })
    } else if (status === 404) {
      setForm({ required_per_team: false, count_per_team: '', enforcement: 'soft', caveat_message: DEFAULT_CAVEAT })
    } else {
      setMsg({ type: 'error', text: body?.error || 'Failed to load settings.' })
    }
  }

  async function handleSave() {
    setSaving(true); setMsg(null)
    const { ok, body } = await rawApi(`/api/admin/volunteers?resource=settings&eventId=${eventId}`, {
      method: 'PUT', body: JSON.stringify(form),
    })
    setSaving(false)
    if (!ok) { setMsg({ type: 'error', text: body?.error || 'Save failed.' }); return }
    setMsg({ type: 'ok', text: 'Saved.' })
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" /></div>
  }
  if (events.length === 0) {
    return <div className="text-center py-16 text-[#e5e5e5]/40 text-sm">No events found. Create one in the Current Event panel first.</div>
  }

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <label className={LABEL_CLS}>Event</label>
        <select value={eventId} onChange={e => setEventId(e.target.value)}
          className="w-full bg-base border border-line rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand">
          {events.map(ev => (
            <option key={ev.id} value={ev.id}>{eventLabel(ev)}{ev.status ? ` — ${ev.status}` : ''}</option>
          ))}
        </select>
      </div>

      {!form ? (
        <div className="flex items-center justify-center py-10"><div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <>
          <label className="flex items-start gap-3 cursor-pointer bg-surface border border-line rounded-xl p-4">
            <Toggle value={form.required_per_team} onChange={v => setForm(f => ({ ...f, required_per_team: v }))} />
            <div>
              <p className="text-sm font-semibold text-white">Require volunteers per team</p>
              <p className="text-xs text-[#e5e5e5]/40 mt-0.5">Each team is expected to put forward volunteers for this event</p>
            </div>
          </label>

          {form.required_per_team && (
            <div>
              <label className={LABEL_CLS}>Volunteers required per team</label>
              <input type="number" min="0" value={form.count_per_team}
                onChange={e => setForm(f => ({ ...f, count_per_team: e.target.value }))}
                className={INPUT_CLS} placeholder="e.g. 2" />
            </div>
          )}

          <div>
            <label className={LABEL_CLS}>Enforcement</label>
            <div className="space-y-2">
              {[
                { value: 'soft', title: 'Soft', desc: 'Under-quota teams see a warning at registration, but registration still completes.' },
                { value: 'hard', title: 'Hard', desc: 'Blocks team registration completion until the volunteer quota is met.' },
              ].map(opt => (
                <label key={opt.value}
                  className={`flex items-start gap-3 cursor-pointer rounded-xl p-4 border transition-colors ${form.enforcement === opt.value ? 'border-brand/40 bg-brand/5' : 'border-line bg-surface hover:border-[#374056]'}`}>
                  <input type="radio" name="enforcement" checked={form.enforcement === opt.value}
                    onChange={() => setForm(f => ({ ...f, enforcement: opt.value }))}
                    className="accent-brand w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-white">{opt.title}</p>
                    <p className="text-xs text-[#e5e5e5]/40 mt-0.5">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
            <p className="text-[10px] text-[#e5e5e5]/30 mt-2 leading-snug">
              Enforcement only takes effect in a later phase — for now it records the committee's intended policy.
            </p>
          </div>

          <div>
            <label className={LABEL_CLS}>Caveat message</label>
            <textarea rows={3} value={form.caveat_message}
              onChange={e => setForm(f => ({ ...f, caveat_message: e.target.value }))}
              className={`${INPUT_CLS} resize-y`} />
            <p className="text-[10px] text-[#e5e5e5]/30 mt-1 leading-snug">Shown to players in the volunteer section. Leave blank to restore the default.</p>
          </div>

          <div className="flex items-center gap-3 pt-2 border-t border-line">
            <button onClick={handleSave} disabled={saving}
              className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-6 py-2.5 rounded-xl text-sm transition-all">
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
            {msg && <span className={`text-sm ${msg.type === 'ok' ? 'text-brand' : 'text-red-400'}`}>{msg.text}</span>}
          </div>
        </>
      )}
    </div>
  )
}

// ── Tab 3: Signups ───────────────────────────────────────────────────────────
function SignupsTab() {
  const [events, setEvents] = useState([])
  const [roles, setRoles] = useState([])
  const [filterEvent, setFilterEvent] = useState('all')
  const [filterRoleIds, setFilterRoleIds] = useState([])
  const [hasNotes, setHasNotes] = useState(false)
  const [signups, setSignups] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailErr, setDetailErr] = useState('')
  const [statusFilter, setStatusFilter] = useState('any')
  const [sortBy, setSortBy] = useState('created')
  const [manualOpen, setManualOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    Promise.all([
      supabase.from('zltac_events').select('id, year, name, status').order('year', { ascending: false }),
      apiFetch('/api/admin/volunteers?resource=roles'),
    ]).then(([{ data: evs }, rolesRes]) => {
      setEvents(evs ?? [])
      setRoles(rolesRes?.roles ?? [])
    }).catch(err => setError(err.message))
  }, [])

  useEffect(() => { loadSignups() }, [filterEvent, filterRoleIds, hasNotes, refreshKey])

  async function loadSignups() {
    setLoading(true); setError(null)
    const params = new URLSearchParams()
    if (filterEvent !== 'all') params.set('event_id', filterEvent)
    if (filterRoleIds.length) params.set('role_id', filterRoleIds.join(','))
    if (hasNotes) params.set('has_notes', 'true')
    try {
      const { signups } = await apiFetch(`/api/admin/volunteers?resource=signups&${params.toString()}`)
      setSignups(signups ?? [])
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  function toggleRole(id) {
    setFilterRoleIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  // Approved role names for a signup, ordered by the role's sort_order (looked
  // up from the loaded roles list, which carries sort_order — s.roles doesn't).
  const sortOrderById = Object.fromEntries(roles.map(r => [r.id, r.sort_order ?? 0]))
  function approvedRolesOf(s) {
    return (s.roles ?? [])
      .filter(r => r.status === 'approved')
      .slice()
      .sort((a, b) => (sortOrderById[a.id] ?? 0) - (sortOrderById[b.id] ?? 0))
  }

  function exportCsv() {
    if (signups.length === 0) return
    const rows = signups.map(s => ({
      player: s.full_name ?? '',
      alias: s.alias ?? '',
      team: s.team_name ?? '',
      event: s.event_name ?? '',
      roles: s.roles.map(r => r.code).join(' '),
      'Approved roles': approvedRolesOf(s).map(r => r.name).join(', '),
      notes: s.notes ?? '',
      signed_up_at: s.created_at ?? '',
    }))
    const keys = Object.keys(rows[0])
    const csv = [keys.join(','), ...rows.map(r => keys.map(k => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'volunteer-signups.csv'; a.click()
  }

  function maxDecidedAt(s) {
    const ts = (s.roles ?? []).map(r => (r.decided_at ? new Date(r.decided_at).getTime() : 0))
    return ts.length ? Math.max(...ts) : 0
  }

  // PATCH role decisions, then patch the updated signup into detail + list.
  async function applyDecisions(signupId, role_decisions) {
    if (role_decisions.length === 0) return
    setDetailErr('')
    const { ok, body } = await rawApi(`/api/admin/volunteers?resource=signups&signup_id=${signupId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role_decisions }),
    })
    if (!ok || !body?.signup) { setDetailErr(body?.error || 'Update failed.'); return }
    setDetail(body.signup)
    setSignups(prev => prev.map(s => (s.id === body.signup.id ? body.signup : s)))
  }

  function handleCreated(signup, eid) {
    setManualOpen(false)
    if (eid) setFilterEvent(eid)
    setRefreshKey(k => k + 1)
    if (signup) setDetail(signup)
  }

  function handleOpenExisting(signup, eid) {
    setManualOpen(false)
    if (eid) setFilterEvent(eid)
    setRefreshKey(k => k + 1)
    if (signup) setDetail(signup)
  }

  // Status filter + sort applied client-side over the loaded list.
  const displayed = (() => {
    let list = signups
    if (statusFilter !== 'any') list = list.filter(s => (s.roles ?? []).some(r => r.status === statusFilter))
    const sorted = [...list]
    if (sortBy === 'decision') sorted.sort((a, b) => maxDecidedAt(b) - maxDecidedAt(a))
    else sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    return sorted
  })()

  const statusColor = st => (st === 'approved' ? 'green' : st === 'declined' ? 'red' : 'grey')

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select value={filterEvent} onChange={e => setFilterEvent(e.target.value)}
          className="bg-surface border border-line rounded-lg px-3 py-2 text-xs text-[#e5e5e5]/70 focus:outline-none focus:border-brand">
          <option value="all">All events</option>
          {events.map(ev => <option key={ev.id} value={ev.id}>{eventLabel(ev)}</option>)}
        </select>
        <label className="flex items-center gap-2 text-xs text-[#e5e5e5]/60 bg-surface border border-line rounded-lg px-3 py-2 cursor-pointer">
          <input type="checkbox" checked={hasNotes} onChange={e => setHasNotes(e.target.checked)} className="accent-brand w-3.5 h-3.5" />
          Has notes
        </label>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="bg-surface border border-line rounded-lg px-3 py-2 text-xs text-[#e5e5e5]/70 focus:outline-none focus:border-brand">
          <option value="any">Any status</option>
          <option value="pending">Has pending</option>
          <option value="approved">Has approved</option>
          <option value="declined">Has declined</option>
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}
          className="bg-surface border border-line rounded-lg px-3 py-2 text-xs text-[#e5e5e5]/70 focus:outline-none focus:border-brand">
          <option value="created">Created (newest)</option>
          <option value="decision">Latest decision (newest)</option>
        </select>
        <button onClick={exportCsv} disabled={signups.length === 0}
          className="text-xs bg-line hover:bg-[#374056] disabled:opacity-40 text-[#e5e5e5]/60 hover:text-white font-semibold px-4 py-2 rounded-lg transition-colors">
          Export CSV
        </button>
        <button onClick={() => setManualOpen(true)}
          className="text-xs bg-brand hover:bg-brand-hover text-black font-bold px-4 py-2 rounded-lg transition-colors">
          + Add manual signup
        </button>
        <span className="text-[#e5e5e5]/30 text-xs ml-auto self-center">{displayed.length} of {signups.length} signup{signups.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Role chips (multi-select) */}
      {roles.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-5">
          {roles.map(r => {
            const on = filterRoleIds.includes(r.id)
            return (
              <button key={r.id} onClick={() => toggleRole(r.id)}
                className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${on ? 'bg-brand text-black' : 'bg-line text-[#e5e5e5]/50 hover:text-white'}`}>
                {r.code}
              </button>
            )
          })}
          {filterRoleIds.length > 0 && (
            <button onClick={() => setFilterRoleIds([])} className="text-xs text-[#e5e5e5]/40 hover:text-white px-2 py-1.5 transition-colors">Clear</button>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm"><strong>Error:</strong> {error}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="bg-surface border border-line rounded-xl overflow-x-auto">
          {displayed.length === 0 ? (
            <p className="text-center py-12 text-[#e5e5e5]/30 text-sm">No signups match these filters</p>
          ) : (
            <table className="w-full text-sm min-w-[920px]">
              <thead>
                <tr className="border-b border-line">
                  {['Player', 'Alias', 'Team', 'Event', 'Roles offered', 'Approved', 'Notes', 'Signed up'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs text-[#e5e5e5]/40 font-bold uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayed.map(s => (
                  <tr key={s.id} onClick={() => { setDetail(s); setDetailErr('') }}
                    className="border-b border-line last:border-0 hover:bg-line/30 transition-colors cursor-pointer">
                    <td className="px-4 py-3 whitespace-nowrap">
                      {s.full_name ? <span className="font-semibold text-white">{s.full_name}</span> : <span className="text-[#e5e5e5]/30 italic text-xs">Unknown</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {s.alias ? <span className="text-brand text-xs font-medium">{s.alias}</span> : <span className="text-[#e5e5e5]/30 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-[#e5e5e5]/60 text-xs">{s.team_name ?? <span className="text-[#e5e5e5]/25">No team</span>}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-[#e5e5e5]/60 text-xs">{s.event_name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {s.roles.length === 0 ? <span className="text-[#e5e5e5]/25 text-xs">—</span>
                          : s.roles.map(r => <Pill key={r.id} color={statusColor(r.status)}>{r.code}</Pill>)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const ap = approvedRolesOf(s)
                        return ap.length === 0
                          ? <span className="text-[#e5e5e5]/25 text-xs">—</span>
                          : <div className="flex flex-wrap gap-1">{ap.map(r => <Pill key={r.id} color="green">{r.name}</Pill>)}</div>
                      })()}
                    </td>
                    <td className="px-4 py-3 max-w-[220px]">
                      {s.notes?.trim() ? <span className="text-[#e5e5e5]/60 text-xs line-clamp-1">{s.notes}</span> : <span className="text-[#e5e5e5]/25 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-[#e5e5e5]/40 text-xs">{formatDate(s.created_at, 'short') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Detail panel */}
      {detail && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-end" onClick={() => setDetail(null)}>
          <div className="w-full max-w-md bg-surface border-l border-line h-full overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-black text-white">Volunteer Signup</h2>
              <button onClick={() => setDetail(null)} className="text-[#e5e5e5]/40 hover:text-white text-xl leading-none">✕</button>
            </div>

            <div className="mb-5">
              <p className="text-white font-bold">{detail.full_name || 'Unknown'}</p>
              {detail.alias && <p className="text-brand text-sm">"{detail.alias}"</p>}
              <p className="text-[#e5e5e5]/40 text-xs mt-0.5">{detail.event_name ?? '—'}{detail.team_name ? ` · ${detail.team_name}` : ''}</p>
            </div>

            <div className="grid grid-cols-1 gap-2 mb-5">
              <div className="bg-base border border-line rounded-lg px-3 py-2.5">
                <p className="text-[10px] text-[#e5e5e5]/40 font-bold uppercase tracking-wider mb-0.5">Contact email</p>
                {detail.email
                  ? <a href={`mailto:${detail.email}`} className="text-sm text-brand hover:underline break-all">{detail.email}</a>
                  : <p className="text-sm text-[#e5e5e5]/40">—</p>}
              </div>
              <div className="bg-base border border-line rounded-lg px-3 py-2.5">
                <p className="text-[10px] text-[#e5e5e5]/40 font-bold uppercase tracking-wider mb-0.5">Phone</p>
                <p className="text-sm text-white">{detail.phone ?? '—'}</p>
              </div>
            </div>

            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] text-[#e5e5e5]/40 font-bold uppercase tracking-wider">Roles offered</p>
                {detail.roles.some(r => r.status === 'pending') && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => applyDecisions(detail.id, detail.roles.filter(r => r.status === 'pending').map(r => ({ role_id: r.id, status: 'approved' })))}
                      className="text-[10px] font-bold text-green-400 hover:text-green-300 transition-colors">
                      Approve all pending
                    </button>
                    <span className="text-[#e5e5e5]/20">·</span>
                    <button
                      onClick={() => applyDecisions(detail.id, detail.roles.filter(r => r.status === 'pending').map(r => ({ role_id: r.id, status: 'declined' })))}
                      className="text-[10px] font-bold text-red-400 hover:text-red-300 transition-colors">
                      Decline all pending
                    </button>
                  </div>
                )}
              </div>

              {detail.roles.length === 0 ? (
                <p className="text-sm text-[#e5e5e5]/30">No roles offered</p>
              ) : (
                <div className="space-y-2">
                  {detail.roles.map(r => (
                    <div key={r.id} className="bg-base border border-line rounded-lg px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <p className="text-sm text-white font-semibold min-w-0">
                          {r.name} <span className="text-[#e5e5e5]/30 font-mono text-[10px]">{r.code}</span>
                        </p>
                        <Pill color={statusColor(r.status)}>{r.status}</Pill>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {[
                          { label: 'Approve', status: 'approved', cls: 'bg-green-500/15 border-green-500/30 text-green-300 hover:bg-green-500/25' },
                          { label: 'Decline', status: 'declined', cls: 'bg-red-500/15 border-red-500/30 text-red-300 hover:bg-red-500/25' },
                          { label: 'Reset to Pending', status: 'pending', cls: 'bg-line border-line text-[#e5e5e5]/60 hover:text-white' },
                        ].map(b => (
                          <button key={b.status}
                            onClick={() => applyDecisions(detail.id, [{ role_id: r.id, status: b.status }])}
                            disabled={r.status === b.status}
                            className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors disabled:opacity-30 disabled:cursor-default ${b.cls}`}>
                            {b.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add a role the player didn't apply for (assigned as approved). */}
              {(() => {
                const onSignup = new Set(detail.roles.map(r => r.id))
                const addable = roles.filter(r => r.is_active && !onSignup.has(r.id))
                if (addable.length === 0) return null
                return (
                  <select
                    value=""
                    onChange={e => { if (e.target.value) applyDecisions(detail.id, [{ role_id: e.target.value, status: 'approved' }]) }}
                    className="mt-3 w-full bg-base border border-line rounded-lg px-3 py-2 text-xs text-[#e5e5e5]/70 focus:outline-none focus:border-brand">
                    <option value="">+ Add role (assigns as approved)…</option>
                    {addable.map(r => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}
                  </select>
                )
              })()}

              {detailErr && <p className="text-red-400 text-xs mt-2">{detailErr}</p>}
            </div>

            <div className="mb-5">
              <p className="text-[10px] text-[#e5e5e5]/40 font-bold uppercase tracking-wider mb-2">Notes</p>
              {detail.notes?.trim()
                ? <p className="text-sm text-[#e5e5e5]/80 whitespace-pre-wrap bg-base border border-line rounded-lg p-3">{detail.notes}</p>
                : <p className="text-sm text-[#e5e5e5]/30">No notes</p>}
            </div>

            <p className="text-xs text-[#e5e5e5]/30">Signed up {formatDate(detail.created_at) || '—'}</p>
          </div>
        </div>
      )}

      {/* Manual signup modal */}
      {manualOpen && (
        <ManualSignupModal
          events={events}
          roles={roles}
          onClose={() => setManualOpen(false)}
          onCreated={handleCreated}
          onOpenExisting={handleOpenExisting}
        />
      )}
    </div>
  )
}

// ── Manual signup modal ──────────────────────────────────────────────────────
function ManualSignupModal({ events, roles, onClose, onCreated, onOpenExisting }) {
  const activeRoles = roles.filter(r => r.is_active)
  const [eventId, setEventId] = useState(events[0]?.id ?? '')
  const [candidates, setCandidates] = useState([])
  const [loadingPlayers, setLoadingPlayers] = useState(false)
  const [eventSignups, setEventSignups] = useState([])
  const [registrationId, setRegistrationId] = useState('')
  const [selectedRoleIds, setSelectedRoleIds] = useState([])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(null) // { signup }

  // AEC (default role) pre-checked, matching the player-facing default.
  useEffect(() => {
    const def = activeRoles.find(r => r.is_default)
    if (def) setSelectedRoleIds([def.id])
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (eventId) loadPlayers(eventId) }, [eventId])

  async function loadPlayers(eid) {
    setLoadingPlayers(true); setError(''); setRegistrationId('')
    const ev = events.find(e => e.id === eid)
    if (!ev) { setLoadingPlayers(false); return }
    try {
      const [regRes, sgRes] = await Promise.all([
        apiFetch(`/api/admin/event?resource=registrations&year=${ev.year}`),
        apiFetch(`/api/admin/volunteers?resource=signups&event_id=${eid}`),
      ])
      const profMap = Object.fromEntries((regRes.profiles ?? []).map(p => [p.id, p]))
      const signed = new Set((sgRes.signups ?? []).map(s => s.user_id))
      setEventSignups(sgRes.signups ?? [])
      const cands = (regRes.registrations ?? [])
        .filter(r => !signed.has(r.user_id))
        .map(r => {
          const p = profMap[r.user_id] ?? {}
          return {
            registration_id: r.id,
            name: [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unknown',
            alias: p.alias ?? null,
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
      setCandidates(cands)
    } catch (err) {
      setError(err.message)
    }
    setLoadingPlayers(false)
  }

  function toggleRole(id) {
    setSelectedRoleIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function save() {
    if (!registrationId) { setError('Pick a player.'); return }
    if (selectedRoleIds.length === 0) { setError('Pick at least one role.'); return }
    setSaving(true); setError('')
    const { ok, status, body } = await rawApi('/api/admin/volunteers?resource=signups', {
      method: 'POST',
      body: JSON.stringify({ registration_id: registrationId, role_ids: selectedRoleIds, notes }),
    })
    setSaving(false)
    if (ok) { onCreated(body.signup, eventId); return }
    if (status === 409) {
      setConflict({ signup: eventSignups.find(s => s.id === body.existing_signup_id) ?? null })
      return
    }
    setError(body?.error || 'Could not create signup.')
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4" onClick={onClose}>
      <div className="bg-surface border border-line rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-black text-white">Add manual signup</h2>
          <button onClick={onClose} className="text-[#e5e5e5]/40 hover:text-white text-xl leading-none">✕</button>
        </div>

        {conflict ? (
          <div>
            <p className="text-[#e5e5e5]/70 text-sm mb-5">
              This player already has a signup. Open it from the list to add roles.
            </p>
            <div className="flex gap-3">
              {conflict.signup && (
                <button onClick={() => onOpenExisting(conflict.signup, eventId)}
                  className="bg-brand hover:bg-brand-hover text-black font-bold px-5 py-2 rounded-xl text-sm transition-all">
                  Open signup
                </button>
              )}
              <button onClick={onClose}
                className="border border-line text-[#e5e5e5]/60 hover:text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors">
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className={LABEL_CLS}>Event</label>
              <select value={eventId} onChange={e => setEventId(e.target.value)}
                className="w-full bg-base border border-line rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand">
                {events.map(ev => <option key={ev.id} value={ev.id}>{eventLabel(ev)}{ev.status ? ` — ${ev.status}` : ''}</option>)}
              </select>
            </div>

            <div>
              <label className={LABEL_CLS}>Player</label>
              {loadingPlayers ? (
                <p className="text-[#e5e5e5]/40 text-xs">Loading players…</p>
              ) : candidates.length === 0 ? (
                <p className="text-[#e5e5e5]/40 text-xs">No registered players without a signup for this event.</p>
              ) : (
                <select value={registrationId} onChange={e => setRegistrationId(e.target.value)}
                  className="w-full bg-base border border-line rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand">
                  <option value="">Select a player…</option>
                  {candidates.map(c => (
                    <option key={c.registration_id} value={c.registration_id}>
                      {c.name}{c.alias ? ` "${c.alias}"` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className={LABEL_CLS}>Roles</label>
              <div className="space-y-1.5">
                {activeRoles.map(r => (
                  <label key={r.id} className="flex items-center gap-2.5 bg-base border border-line rounded-lg px-3 py-2 cursor-pointer">
                    <input type="checkbox" checked={selectedRoleIds.includes(r.id)} onChange={() => toggleRole(r.id)} className="accent-brand w-3.5 h-3.5" />
                    <span className="text-sm text-white">{r.name} <span className="text-[#e5e5e5]/30 font-mono text-[10px]">{r.code}</span></span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className={LABEL_CLS}>Notes <span className="text-[#e5e5e5]/25 normal-case font-normal">(optional)</span></label>
              <textarea rows={2} value={notes} maxLength={1000} onChange={e => setNotes(e.target.value)}
                className={`${INPUT_CLS} resize-y`} />
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <div className="flex items-center gap-3 pt-1">
              <button onClick={save} disabled={saving}
                className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-all">
                {saving ? 'Creating…' : 'Create signup (approved)'}
              </button>
              <button onClick={onClose}
                className="border border-line text-[#e5e5e5]/60 hover:text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Page shell ───────────────────────────────────────────────────────────────
export default function AdminVolunteers() {
  const [activeTab, setActiveTab] = useState(0)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-black text-white">Volunteers</h1>
        <p className="text-[#e5e5e5]/40 text-sm mt-1">Manage volunteer roles, per-event settings, and signups</p>
      </div>

      <div className="flex gap-0 border-b border-line mb-6">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setActiveTab(i)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px whitespace-nowrap ${
              activeTab === i ? 'border-brand text-brand' : 'border-transparent text-[#e5e5e5]/40 hover:text-white'
            }`}>
            {t}
          </button>
        ))}
      </div>

      {activeTab === 0 && <RolesTab />}
      {activeTab === 1 && <SettingsTab />}
      {activeTab === 2 && <SignupsTab />}
    </div>
  )
}
