import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

const TABS = ['Details', 'Side Events', 'Pricing', 'Registration Settings']

const DEFAULT_SIDE_EVENTS = [
  { slug: 'lord-of-the-rings', name: 'Lord of the Rings', description: 'Epic multi-round format — only the finest warriors survive each ring to claim the ultimate title.', enabled: true, price: '25.00', max_participants: '', custom: false },
  { slug: 'solos', name: 'Solos', description: 'Head-to-head individual competition. Prove you are the best single player in Australasia.', enabled: true, price: '20.00', max_participants: '', custom: false },
  { slug: 'doubles', name: 'Doubles', description: 'Partner with a teammate and coordinate your strategy to outmanoeuvre the field.', enabled: true, price: '20.00', max_participants: '', custom: false },
  { slug: 'triples', name: 'Triples', description: 'Fast-paced three-player team format. Communication and chemistry decide the winners.', enabled: true, price: '20.00', max_participants: '', custom: false },
  { slug: 'presentation-dinner', name: 'Presentation Dinner', description: 'Join fellow competitors for the official presentation evening and awards ceremony.', enabled: true, price: '65.00', max_participants: '', custom: false },
]

const EMPTY_CUSTOM = { name: '', description: '', max_participants: '' }

function centsToDisplay(cents) { return ((cents ?? 0) / 100).toFixed(2) }
function displayToCents(val) { return Math.round((parseFloat(val) || 0) * 100) }

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

function DollarInput({ label, hint, value, onChange, disabled }) {
  return (
    <div>
      <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">{label}</label>
      {hint && <p className="text-xs text-[#e5e5e5]/30 mb-1.5">{hint}</p>}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#e5e5e5]/40 text-sm font-semibold">$</span>
        <input
          type="number" min="0" step="0.01"
          value={value} disabled={disabled}
          onChange={e => onChange(e.target.value)}
          className="w-full bg-base border border-line rounded-lg pl-7 pr-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand transition-colors disabled:opacity-40"
        />
      </div>
    </div>
  )
}

function StatusBanner({ status, onChangeStatus, saving, archived }) {
  const map = {
    draft:    { bg: 'bg-[#2D2D2D]', text: 'text-[#e5e5e5]/50', msg: 'Event is in draft — not visible to the public' },
    open:     { bg: 'bg-brand/10', text: 'text-brand', msg: 'Registration is open' },
    closed:   { bg: 'bg-yellow-500/10', text: 'text-yellow-400', msg: 'Registration is closed' },
    archived: { bg: 'bg-[#2D2D2D]', text: 'text-[#e5e5e5]/30', msg: 'Event archived — read only' },
  }
  const s = map[status] ?? map.draft

  return (
    <div className={`${s.bg} border border-line rounded-xl px-5 py-4 flex items-center justify-between gap-4 mb-6`}>
      <div className="flex items-center gap-3">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${status === 'open' ? 'bg-brand animate-pulse' : status === 'closed' ? 'bg-yellow-400' : 'bg-[#e5e5e5]/20'}`} />
        <span className={`text-sm font-semibold ${s.text}`}>{s.msg}</span>
      </div>
      {!archived && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {status === 'draft' && (
            <button onClick={() => onChangeStatus('open')} disabled={saving}
              className="text-xs bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-4 py-2 rounded-lg transition-all">
              Open Registration
            </button>
          )}
          {status === 'open' && (
            <button onClick={() => onChangeStatus('closed')} disabled={saving}
              className="text-xs bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-400 font-bold px-4 py-2 rounded-lg transition-all">
              Close Registration
            </button>
          )}
          {status === 'closed' && (<>
            <button onClick={() => onChangeStatus('open')} disabled={saving}
              className="text-xs bg-brand/10 hover:bg-brand/20 text-brand font-bold px-4 py-2 rounded-lg transition-all">
              Reopen
            </button>
            <button onClick={() => onChangeStatus('archived')} disabled={saving}
              className="text-xs bg-[#374056] hover:bg-[#444] text-[#e5e5e5]/50 hover:text-white font-bold px-4 py-2 rounded-lg transition-colors">
              Archive Event
            </button>
          </>)}
        </div>
      )}
    </div>
  )
}

export default function AdminEvent() {
  const [event, setEvent] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState(0)
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [msg, setMsg] = useState(null)

  // Form state
  const [form, setForm] = useState({})
  const [sideEvents, setSideEvents] = useState(DEFAULT_SIDE_EVENTS)
  const [pricing, setPricing] = useState({ player_fee: '0.00', team_fee: '0.00', dinner_guest_fee: '65.00', processing_fee_pct: '2.50' })
  const [settings, setSettings] = useState({ reg_open_date: '', reg_close_date: '', max_teams: '', max_players: '', max_players_per_team: '', require_coc: true, require_ref_test: true, require_payment: true, allow_side_events_only: false, enable_waitlist: false })

  // Logo
  const [logoFile, setLogoFile] = useState(null)
  const [logoPreview, setLogoPreview] = useState(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const logoRef = useRef()

  // Custom side event
  const [showAddCustom, setShowAddCustom] = useState(false)
  const [customForm, setCustomForm] = useState(EMPTY_CUSTOM)

  useEffect(() => { loadCurrentEvent() }, [])

  async function loadCurrentEvent() {
    setLoading(true)
    const { data } = await supabase
      .from('zltac_events')
      .select('*')
      .neq('status', 'archived')
      .order('year', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) populateForm(data)
    setEvent(data)
    setLoading(false)
  }

  function populateForm(ev) {
    setForm({
      name: ev.name ?? '',
      year: ev.year ?? new Date().getFullYear() + 1,
      status: ev.status ?? 'draft',
      start_date: ev.start_date ?? '',
      end_date: ev.end_date ?? '',
      location: ev.location ?? '',
      venue: ev.venue ?? '',
      description: ev.description ?? '',
      logo_url: ev.logo_url ?? '',
    })
    const rawSides = ev.side_events
    setSideEvents(rawSides
      ? rawSides.map(se => ({ ...se, price: centsToDisplay(se.price), max_participants: se.max_participants ?? '' }))
      : DEFAULT_SIDE_EVENTS
    )
    setPricing({
      player_fee: centsToDisplay(ev.main_fee),
      team_fee: centsToDisplay(ev.team_fee),
      dinner_guest_fee: centsToDisplay(ev.dinner_guest_price),
      processing_fee_pct: ev.processing_fee_pct != null ? String(ev.processing_fee_pct) : '2.50',
    })
    setSettings({
      reg_open_date: ev.reg_open_date ? ev.reg_open_date.slice(0, 16) : '',
      reg_close_date: ev.reg_close_date ? ev.reg_close_date.slice(0, 16) : '',
      max_teams: ev.max_teams ?? '',
      max_players: ev.max_players ?? '',
      max_players_per_team: ev.max_players_per_team ?? '',
      require_coc: ev.require_coc ?? true,
      require_ref_test: ev.require_ref_test ?? true,
      require_payment: ev.require_payment ?? true,
      allow_side_events_only: ev.allow_side_events_only ?? false,
      enable_waitlist: ev.enable_waitlist ?? false,
    })
    setLogoFile(null)
    setLogoPreview(ev.logo_url ?? null)
  }

  function handleTabClick(i) {
    setActiveTab(i)
  }

  function handleLogoSelect(e) {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { setMsg({ type: 'error', text: 'Logo must be under 2MB.' }); return }
    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
    setMsg(null)
  }

  async function uploadLogo() {
    if (!logoFile) return form.logo_url ?? ''
    setUploadingLogo(true)
    const ext = logoFile.name.split('.').pop()
    const { data, error } = await supabase.storage.from('event-logos').upload(`${Date.now()}.${ext}`, logoFile, { upsert: true })
    setUploadingLogo(false)
    if (error) { setMsg({ type: 'error', text: `Logo upload failed: ${error.message}` }); return form.logo_url ?? '' }
    return supabase.storage.from('event-logos').getPublicUrl(data.path).data.publicUrl
  }

  async function handleSave() {
    setSaving(true)
    setMsg(null)
    const logo_url = await uploadLogo()
    if (msg?.type === 'error') { setSaving(false); return }

    const payload = {
      name: form.name,
      year: parseInt(form.year),
      status: form.status,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      location: form.location || null,
      venue: form.venue || null,
      description: form.description || null,
      logo_url: logo_url || null,
      main_fee: displayToCents(pricing.player_fee),
      team_fee: displayToCents(pricing.team_fee),
      dinner_guest_price: displayToCents(pricing.dinner_guest_fee),
      processing_fee_pct: parseFloat(pricing.processing_fee_pct) || 0,
      side_events: sideEvents.map(se => ({
        ...se,
        price: displayToCents(se.price),
        max_participants: se.max_participants ? parseInt(se.max_participants) : null,
      })),
      reg_open_date: settings.reg_open_date || null,
      reg_close_date: settings.reg_close_date || null,
      max_teams: settings.max_teams ? parseInt(settings.max_teams) : null,
      max_players: settings.max_players ? parseInt(settings.max_players) : null,
      max_players_per_team: settings.max_players_per_team ? parseInt(settings.max_players_per_team) : null,
      require_coc: settings.require_coc,
      require_ref_test: settings.require_ref_test,
      require_payment: settings.require_payment,
      allow_side_events_only: settings.allow_side_events_only,
      enable_waitlist: settings.enable_waitlist,
      updated_at: new Date().toISOString(),
    }

    let err
    if (!event) {
      ;({ error: err } = await supabase.from('zltac_events').insert(payload))
    } else {
      ;({ error: err } = await supabase.from('zltac_events').update(payload).eq('id', event.id))
    }
    setSaving(false)
    if (err) setMsg({ type: 'error', text: err.message })
    else { setMsg({ type: 'ok', text: 'Saved.' }); loadCurrentEvent() }
  }

  async function handleChangeStatus(newStatus) {
    if (!event) return
    setSaving(true)
    const { error } = await supabase.from('zltac_events').update({ status: newStatus }).eq('id', event.id)
    setSaving(false)
    if (!error) { setEvent(e => ({ ...e, status: newStatus })); setForm(f => ({ ...f, status: newStatus })) }
  }

  async function handleArchiveAndCreate() {
    if (!event) return
    if (!window.confirm(`Archive ${event.name} ${event.year} and create a new event for ${event.year + 1}?`)) return
    setArchiving(true)
    await supabase.from('zltac_events').update({ status: 'archived' }).eq('id', event.id)
    await supabase.from('zltac_events').insert({
      name: event.name,
      year: event.year + 1,
      status: 'draft',
      main_fee: event.main_fee,
      team_fee: event.team_fee,
      dinner_guest_price: event.dinner_guest_price,
      processing_fee_pct: event.processing_fee_pct,
      side_events: event.side_events,
      require_coc: event.require_coc,
      require_ref_test: event.require_ref_test,
    })
    setArchiving(false)
    setActiveTab(0)
    loadCurrentEvent()
  }

  function addCustomSideEvent() {
    if (!customForm.name.trim()) return
    const slug = `custom-${customForm.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}-${Date.now()}`
    setSideEvents(ev => [...ev, { slug, name: customForm.name, description: customForm.description, enabled: true, price: '0.00', max_participants: customForm.max_participants, custom: true }])
    setCustomForm(EMPTY_CUSTOM)
    setShowAddCustom(false)
  }

  const isArchived = event?.status === 'archived'
  const enabledSides = sideEvents.filter(se => se.enabled)

  // ── NO EVENT YET ──────────────────────────────────────────────────────────
  if (!loading && !event) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="text-5xl mb-4">🎯</div>
        <h1 className="text-2xl font-black text-white mb-2">No Active Event</h1>
        <p className="text-[#e5e5e5]/40 text-sm mb-6 max-w-xs">No current or upcoming event found. Create one to get started.</p>
        <button
          onClick={async () => {
            const year = new Date().getFullYear() + 1
            const { data } = await supabase.from('zltac_events').insert({ name: `ZLTAC ${year}`, year, status: 'draft', main_fee: 0, team_fee: 0, dinner_guest_price: 6500 }).select().single()
            if (data) { setEvent(data); populateForm(data) }
          }}
          className="bg-brand hover:bg-brand-hover text-black font-bold px-6 py-3 rounded-xl text-sm transition-all"
        >
          + Create New Event
        </button>
      </div>
    )
  }

  if (loading) {
    return <div className="flex items-center justify-center py-16"><div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-black text-white">{form.name} {form.year}</h1>
          <p className="text-[#e5e5e5]/40 text-sm mt-1">Current event configuration</p>
        </div>
        {!isArchived && (
          <button
            onClick={handleArchiveAndCreate}
            disabled={archiving}
            className="text-xs border border-line hover:border-[#374056] text-[#e5e5e5]/40 hover:text-white font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-40 flex-shrink-0"
          >
            {archiving ? 'Archiving…' : 'Archive & Create New Event'}
          </button>
        )}
      </div>

      {/* Status banner */}
      <StatusBanner status={form.status} onChangeStatus={handleChangeStatus} saving={saving} archived={isArchived} />

      {/* Tabs */}
      <div className="flex gap-0 border-b border-line mb-6 overflow-x-auto">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => handleTabClick(i)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors -mb-px whitespace-nowrap ${
              activeTab === i ? 'border-brand text-brand' : 'border-transparent text-[#e5e5e5]/40 hover:text-white'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── TAB 0: Details ───────────────────────────────────────────────── */}
      {activeTab === 0 && (
        <div className="space-y-5 max-w-xl">
          {[
            { label: 'Event Name', key: 'name', type: 'text' },
            { label: 'Year', key: 'year', type: 'number' },
            { label: 'Location (City, State)', key: 'location', type: 'text' },
            { label: 'Venue', key: 'venue', type: 'text' },
          ].map(({ label, key, type }) => (
            <div key={key}>
              <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">{label}</label>
              <input type={type} value={form[key] ?? ''} disabled={isArchived}
                onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                className="w-full bg-base border border-line rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand transition-colors disabled:opacity-40"
              />
            </div>
          ))}

          <div className="grid grid-cols-2 gap-3">
            {[{ label: 'Start Date', key: 'start_date' }, { label: 'End Date', key: 'end_date' }].map(({ label, key }) => (
              <div key={key}>
                <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">{label}</label>
                <input type="date" value={form[key] ?? ''} disabled={isArchived}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  className="w-full bg-base border border-line rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand disabled:opacity-40"
                />
              </div>
            ))}
          </div>

          <div>
            <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">Status</label>
            <select value={form.status ?? 'draft'} disabled={isArchived}
              onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              className="w-full bg-base border border-line rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand disabled:opacity-40"
            >
              {['draft', 'open', 'closed', 'archived'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">Description</label>
            <textarea rows={4} value={form.description ?? ''} disabled={isArchived}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full bg-base border border-line rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand transition-colors resize-none disabled:opacity-40"
            />
          </div>

          {/* Logo upload */}
          <div>
            <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">Event Logo</label>
            <p className="text-xs text-[#e5e5e5]/30 mb-2">PNG or JPG, max 2MB.</p>
            <input ref={logoRef} type="file" accept="image/png,image/jpeg" onChange={handleLogoSelect} className="hidden" />
            {logoPreview ? (
              <div className="flex items-center gap-4">
                <img src={logoPreview} alt="Logo" className="h-16 w-16 object-contain rounded-lg border border-line bg-base p-1" />
                {!isArchived && (
                  <div className="flex flex-col gap-2">
                    <button type="button" onClick={() => logoRef.current.click()}
                      className="text-xs bg-line hover:bg-[#374056] text-[#e5e5e5]/70 hover:text-white font-semibold px-3 py-1.5 rounded-lg transition-colors">
                      Change
                    </button>
                    <button type="button" onClick={() => { setLogoFile(null); setLogoPreview(null); setForm(f => ({ ...f, logo_url: '' })) }}
                      className="text-xs text-red-400/50 hover:text-red-400 transition-colors">
                      Remove
                    </button>
                  </div>
                )}
              </div>
            ) : !isArchived ? (
              <button type="button" onClick={() => logoRef.current.click()}
                className="w-full border border-dashed border-line hover:border-brand rounded-xl py-6 text-center transition-colors group">
                <svg className="w-6 h-6 mx-auto mb-2 text-[#e5e5e5]/20 group-hover:text-brand transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="text-xs text-[#e5e5e5]/30 group-hover:text-brand transition-colors">Click to upload logo</span>
              </button>
            ) : <p className="text-xs text-[#e5e5e5]/30">No logo uploaded</p>}
          </div>
        </div>
      )}

      {/* ── TAB 1: Side Events ───────────────────────────────────────────── */}
      {activeTab === 1 && (
        <div className="space-y-3 max-w-2xl">
          {sideEvents.map((se, i) => (
            <div key={se.slug} className={`rounded-xl border p-4 transition-colors ${se.enabled ? 'bg-surface border-line' : 'bg-base border-line opacity-60'}`}>
              <div className="flex items-start gap-3">
                <Toggle value={se.enabled} disabled={isArchived} onChange={v => setSideEvents(ev => ev.map((e, j) => j === i ? { ...e, enabled: v } : e))} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-semibold text-white text-sm">{se.name}</p>
                    {se.custom && !isArchived && (
                      <button onClick={() => setSideEvents(ev => ev.filter((_, j) => j !== i))}
                        className="text-xs text-red-400/50 hover:text-red-400 transition-colors ml-2">Remove</button>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div>
                      <label className="block text-xs text-[#e5e5e5]/30 mb-1">Description</label>
                      <input type="text" value={se.description ?? ''} disabled={isArchived}
                        onChange={e => setSideEvents(ev => ev.map((s, j) => j === i ? { ...s, description: e.target.value } : s))}
                        className="w-full bg-base border border-line rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-brand disabled:opacity-40"
                      />
                    </div>
                    <div className="w-40">
                      <label className="block text-xs text-[#e5e5e5]/30 mb-1">Max Participants</label>
                      <input type="number" value={se.max_participants ?? ''} placeholder="Unlimited" disabled={isArchived}
                        onChange={e => setSideEvents(ev => ev.map((s, j) => j === i ? { ...s, max_participants: e.target.value } : s))}
                        className="w-full bg-base border border-line rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-brand placeholder-[#e5e5e5]/20 disabled:opacity-40"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {!isArchived && (
            showAddCustom ? (
              <div className="bg-base border border-brand/20 rounded-xl p-4 space-y-3">
                <p className="text-xs font-bold text-white uppercase tracking-wider">New Side Event</p>
                {[{ label: 'Event Name', key: 'name', type: 'text' }, { label: 'Description', key: 'description', type: 'text' }, { label: 'Max Participants', key: 'max_participants', type: 'number' }].map(({ label, key, type }) => (
                  <div key={key}>
                    <label className="block text-xs text-[#e5e5e5]/40 mb-1">{label}</label>
                    <input type={type} value={customForm[key]} placeholder={key === 'max_participants' ? 'Unlimited' : ''}
                      onChange={e => setCustomForm(f => ({ ...f, [key]: e.target.value }))}
                      className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand placeholder-[#e5e5e5]/20"
                    />
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <button onClick={addCustomSideEvent} disabled={!customForm.name.trim()}
                    className="text-sm bg-brand hover:bg-brand-hover disabled:opacity-40 text-black font-bold px-4 py-2 rounded-xl transition-all">Add</button>
                  <button onClick={() => { setShowAddCustom(false); setCustomForm(EMPTY_CUSTOM) }}
                    className="text-sm border border-line text-[#e5e5e5]/50 hover:text-white px-4 py-2 rounded-xl transition-colors">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowAddCustom(true)}
                className="w-full border border-dashed border-line hover:border-brand text-[#e5e5e5]/40 hover:text-brand text-sm font-semibold py-3 rounded-xl transition-colors">
                + Add custom side event
              </button>
            )
          )}
        </div>
      )}

      {/* ── TAB 2: Pricing ───────────────────────────────────────────────── */}
      {activeTab === 2 && (
        <div className="grid md:grid-cols-2 gap-6 max-w-3xl">
          <div className="space-y-4">
            <DollarInput label="Player Registration Fee (AUD)" hint="Per player entry fee" value={pricing.player_fee} disabled={isArchived} onChange={v => setPricing(p => ({ ...p, player_fee: v }))} />
            <DollarInput label="Team Registration Fee (AUD)" hint="Per team entry fee (if separate from player fee)" value={pricing.team_fee} disabled={isArchived} onChange={v => setPricing(p => ({ ...p, team_fee: v }))} />
            <DollarInput label="Dinner Guest Fee (AUD)" hint="Per additional dinner guest" value={pricing.dinner_guest_fee} disabled={isArchived} onChange={v => setPricing(p => ({ ...p, dinner_guest_fee: v }))} />

            <div>
              <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">Processing Fee (%)</label>
              <p className="text-xs text-[#e5e5e5]/30 mb-1.5">Added to total at checkout</p>
              <div className="relative">
                <input type="number" min="0" step="0.1" value={pricing.processing_fee_pct} disabled={isArchived}
                  onChange={e => setPricing(p => ({ ...p, processing_fee_pct: e.target.value }))}
                  className="w-full bg-base border border-line rounded-lg px-3 pr-8 py-2.5 text-sm text-white focus:outline-none focus:border-brand disabled:opacity-40"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#e5e5e5]/40 text-sm">%</span>
              </div>
            </div>

            {enabledSides.length > 0 && (
              <div>
                <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-3">Side Event Prices (AUD per participant)</label>
                <div className="space-y-3">
                  {enabledSides.map(se => {
                    const idx = sideEvents.findIndex(s => s.slug === se.slug)
                    return (
                      <div key={se.slug}>
                        <label className="block text-xs text-[#e5e5e5]/40 mb-1">{se.name}</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#e5e5e5]/40 text-sm font-semibold">$</span>
                          <input type="number" min="0" step="0.01" value={sideEvents[idx]?.price ?? '0.00'} disabled={isArchived}
                            onChange={e => setSideEvents(ev => ev.map((s, j) => j === idx ? { ...s, price: e.target.value } : s))}
                            className="w-full bg-base border border-line rounded-lg pl-7 pr-3 py-2 text-sm text-white focus:outline-none focus:border-brand disabled:opacity-40"
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
              {[
                { label: 'Player Entry', val: pricing.player_fee },
                { label: 'Team Fee', val: pricing.team_fee },
                { label: 'Dinner Guest', val: pricing.dinner_guest_fee },
              ].map(({ label, val }) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-[#e5e5e5]/60">{label}</span>
                  <span className="text-white font-semibold">${parseFloat(val || 0).toFixed(2)}</span>
                </div>
              ))}
              {enabledSides.map(se => (
                <div key={se.slug} className="flex justify-between text-sm">
                  <span className="text-[#e5e5e5]/60">{se.name}</span>
                  <span className="text-white font-semibold">${parseFloat(se.price || 0).toFixed(2)}</span>
                </div>
              ))}
              <div className="border-t border-line pt-2.5">
                <div className="flex justify-between text-sm">
                  <span className="text-[#e5e5e5]/40">Processing Fee</span>
                  <span className="text-[#e5e5e5]/40">{pricing.processing_fee_pct}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 3: Registration Settings ─────────────────────────────────── */}
      {activeTab === 3 && (
        <div className="space-y-5 max-w-xl">
          <div className="grid grid-cols-2 gap-3">
            {[{ label: 'Registration Opens', key: 'reg_open_date' }, { label: 'Registration Closes', key: 'reg_close_date' }].map(({ label, key }) => (
              <div key={key}>
                <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">{label}</label>
                <input type="datetime-local" value={settings[key] ?? ''} disabled={isArchived}
                  onChange={e => setSettings(s => ({ ...s, [key]: e.target.value || '' }))}
                  className="w-full bg-base border border-line rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand disabled:opacity-40"
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Max Teams', key: 'max_teams', hint: 'Event-wide cap on total teams' },
              { label: 'Max Players', key: 'max_players', hint: 'Event-wide cap on total players' },
            ].map(({ label, key, hint }) => (
              <div key={key}>
                <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">{label}</label>
                <p className="text-xs text-[#e5e5e5]/30 mb-1.5">{hint}</p>
                <input type="number" value={settings[key] ?? ''} placeholder="Unlimited" disabled={isArchived}
                  onChange={e => setSettings(s => ({ ...s, [key]: e.target.value || '' }))}
                  className="w-full bg-base border border-line rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand placeholder-[#e5e5e5]/20 disabled:opacity-40"
                />
              </div>
            ))}
          </div>

          <div>
            <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">Max Players per Team</label>
            <p className="text-xs text-[#e5e5e5]/30 mb-1.5">Team composition limit — applies to each team individually</p>
            <input type="number" value={settings.max_players_per_team ?? ''} placeholder="Unlimited" disabled={isArchived}
              onChange={e => setSettings(s => ({ ...s, max_players_per_team: e.target.value || '' }))}
              className="w-full bg-base border border-line rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand placeholder-[#e5e5e5]/20 disabled:opacity-40"
            />
          </div>

          <div className="space-y-3 pt-1">
            {[
              { label: 'Require Code of Conduct', sub: 'Players must sign CoC before registration is complete', key: 'require_coc' },
              { label: 'Require Referee Test', sub: 'At least one team member must pass the referee test', key: 'require_ref_test' },
              { label: 'Require Payment', sub: 'Registration is only confirmed once the event fee is paid — turn off for free or on-the-day-paid events', key: 'require_payment' },
              { label: 'Allow Side Events Only', sub: 'Players can register for side events without joining a team', key: 'allow_side_events_only' },
              { label: 'Enable Waitlist', sub: 'When max teams/players is reached, allow waitlist sign-ups', key: 'enable_waitlist' },
            ].map(({ label, sub, key }) => (
              <label key={key} className="flex items-start gap-3 cursor-pointer bg-surface border border-line rounded-xl p-4">
                <Toggle value={settings[key]} disabled={isArchived} onChange={v => setSettings(s => ({ ...s, [key]: v }))} />
                <div>
                  <p className="text-sm font-semibold text-white">{label}</p>
                  <p className="text-xs text-[#e5e5e5]/40 mt-0.5">{sub}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Save footer */}
      {!isArchived && (
        <div className="flex items-center gap-3 mt-8 pt-6 border-t border-line">
          <button onClick={handleSave} disabled={saving || uploadingLogo}
            className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-6 py-2.5 rounded-xl text-sm transition-all">
            {saving || uploadingLogo ? 'Saving…' : 'Save Changes'}
          </button>
          {msg && <span className={`text-sm ${msg.type === 'ok' ? 'text-brand' : 'text-red-400'}`}>{msg.text}</span>}
        </div>
      )}
    </div>
  )
}
