import { useState, useEffect, useRef } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const TABS = ['Event Details', 'Results', 'Notes']

function emptyEvent() {
  return {
    year: new Date().getFullYear() - 1,
    name: '',
    location_city: '',
    location_state: '',
    location_venue: '',
    start_date: '',
    end_date: '',
    description: '',
    logo_url: '',
    champion_team: '',
    champion_state: '',
    runner_up_team: '',
    runner_up_state: '',
    third_place_team: '',
    third_place_state: '',
    mvp_name: '',
    mvp_alias: '',
    side_event_results: [],
    full_results_text: '',
    photo_urls: [],
    internal_notes: '',
  }
}

function emptySideEvent() {
  return { name: '', first_name: '', first_alias: '', second_name: '', second_alias: '', third_name: '', third_alias: '' }
}

const inputClass = 'w-full bg-[#191919] border border-line rounded-lg px-3 py-2 text-sm text-white placeholder-[#e5e5e5]/30 focus:outline-none focus:border-brand/50 transition-colors'
const labelClass = 'block text-xs font-medium text-[#e5e5e5]/50 uppercase tracking-wider mb-1.5'

export default function AdminEventHistory() {
  useOutletContext()
  const [events, setEvents] = useState([])
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState(emptyEvent())
  const [activeTab, setActiveTab] = useState(0)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const [photoUploading, setPhotoUploading] = useState(false)
  const logoRef = useRef()
  const photoRef = useRef()
  const photoUrlRef = useRef()

  useEffect(() => { loadEvents() }, [])

  async function loadEvents() {
    const { data } = await supabase
      .from('zltac_event_history')
      .select('id, year, name, location_city, location_state')
      .order('year', { ascending: false })
    setEvents(data ?? [])
  }

  async function selectEvent(ev) {
    setSelected(ev.id)
    const { data } = await supabase.from('zltac_event_history').select('*').eq('id', ev.id).single()
    if (data) {
      setForm({
        ...emptyEvent(),
        ...data,
        start_date: data.start_date ?? '',
        end_date: data.end_date ?? '',
        side_event_results: data.side_event_results ?? [],
        photo_urls: data.photo_urls ?? [],
      })
    }
    setActiveTab(0)
  }

  function startNew() {
    setSelected('new')
    setForm(emptyEvent())
    setActiveTab(0)
  }

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  function setField(key, val) {
    setForm(f => ({ ...f, [key]: val }))
  }

  async function save() {
    if (!form.year || !form.name) return
    setSaving(true)
    const payload = {
      year: parseInt(form.year),
      name: form.name,
      location_city: form.location_city || null,
      location_state: form.location_state || null,
      location_venue: form.location_venue || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      description: form.description || null,
      logo_url: form.logo_url || null,
      champion_team: form.champion_team || null,
      champion_state: form.champion_state || null,
      runner_up_team: form.runner_up_team || null,
      runner_up_state: form.runner_up_state || null,
      third_place_team: form.third_place_team || null,
      third_place_state: form.third_place_state || null,
      mvp_name: form.mvp_name || null,
      mvp_alias: form.mvp_alias || null,
      side_event_results: form.side_event_results?.length > 0 ? form.side_event_results : null,
      full_results_text: form.full_results_text || null,
      photo_urls: form.photo_urls?.length > 0 ? form.photo_urls : null,
      internal_notes: form.internal_notes || null,
      updated_at: new Date().toISOString(),
    }

    let error, newId
    if (selected === 'new') {
      const res = await supabase.from('zltac_event_history').insert(payload).select('id').single()
      error = res.error
      newId = res.data?.id
    } else {
      const res = await supabase.from('zltac_event_history').update(payload).eq('id', selected)
      error = res.error
    }

    setSaving(false)
    if (error) {
      showToast(error.message, 'error')
    } else {
      if (newId) setSelected(newId)
      showToast('Saved successfully')
      loadEvents()
    }
  }

  async function uploadLogo(file) {
    setLogoUploading(true)
    const ext = file.name.split('.').pop()
    const path = `history/${form.year}-logo-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('event-logos').upload(path, file, { upsert: true })
    if (!error) {
      const { data: { publicUrl } } = supabase.storage.from('event-logos').getPublicUrl(path)
      setField('logo_url', publicUrl)
    }
    setLogoUploading(false)
  }

  async function uploadPhoto(file) {
    setPhotoUploading(true)
    const ext = file.name.split('.').pop()
    const path = `history/${form.year}-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('event-photos').upload(path, file, { upsert: true })
    if (!error) {
      const { data: { publicUrl } } = supabase.storage.from('event-photos').getPublicUrl(path)
      setField('photo_urls', [...(form.photo_urls ?? []), publicUrl])
    }
    setPhotoUploading(false)
  }

  function addPhotoUrl() {
    const val = photoUrlRef.current?.value?.trim()
    if (!val) return
    setField('photo_urls', [...(form.photo_urls ?? []), val])
    photoUrlRef.current.value = ''
  }

  function updateSideEvent(idx, key, val) {
    setField('side_event_results', form.side_event_results.map((se, i) => i === idx ? { ...se, [key]: val } : se))
  }

  function addSideEvent() {
    setField('side_event_results', [...(form.side_event_results ?? []), emptySideEvent()])
  }

  function removeSideEvent(idx) {
    setField('side_event_results', form.side_event_results.filter((_, i) => i !== idx))
  }

  function removePhoto(idx) {
    setField('photo_urls', form.photo_urls.filter((_, i) => i !== idx))
  }

  return (
    <div className="flex gap-6" style={{ minHeight: 'calc(100vh - 10rem)' }}>
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-xl border ${
          toast.type === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-brand/10 border-brand/30 text-brand'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Left: event list */}
      <div className="w-72 flex-shrink-0 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-black text-white">Event History</h1>
          <button
            onClick={startNew}
            className="text-xs bg-brand/10 hover:bg-brand/20 text-brand border border-brand/20 px-3 py-1.5 rounded-lg font-medium transition-colors"
          >
            + Add past event
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {events.length === 0 && (
            <p className="text-[#e5e5e5]/30 text-sm text-center py-10">No history records yet.</p>
          )}
          {events.map(ev => (
            <button
              key={ev.id}
              onClick={() => selectEvent(ev)}
              className={`text-left px-4 py-3 rounded-xl border transition-all ${
                selected === ev.id
                  ? 'bg-brand/10 border-brand/30'
                  : 'bg-surface border-line hover:border-brand/20'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="font-black text-brand text-sm">{ev.year}</span>
                <span className="text-[10px] bg-[#191919] border border-line text-[#e5e5e5]/35 px-1.5 py-0.5 rounded font-medium uppercase tracking-wide">archived</span>
              </div>
              <p className={`text-sm font-semibold truncate ${selected === ev.id ? 'text-white' : 'text-[#e5e5e5]/70'}`}>
                {ev.name || `ZLTAC ${ev.year}`}
              </p>
              {(ev.location_city || ev.location_state) && (
                <p className="text-xs text-[#e5e5e5]/35 mt-0.5">
                  {[ev.location_city, ev.location_state].filter(Boolean).join(', ')}
                </p>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Right: edit panel */}
      {selected ? (
        <div className="flex-1 bg-surface border border-line rounded-2xl flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-line px-6 flex-shrink-0">
            {TABS.map((tab, i) => (
              <button
                key={tab}
                onClick={() => setActiveTab(i)}
                className={`px-4 py-4 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  activeTab === i ? 'border-brand text-brand' : 'border-transparent text-[#e5e5e5]/40 hover:text-white'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-6">

            {/* TAB 1 — Event Details */}
            {activeTab === 0 && (
              <div className="space-y-5 max-w-2xl">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Event Name</label>
                    <input className={inputClass} value={form.name} onChange={e => setField('name', e.target.value)} placeholder="ZLTAC 2019" />
                  </div>
                  <div>
                    <label className={labelClass}>Year</label>
                    <input className={inputClass} type="number" value={form.year} onChange={e => setField('year', e.target.value)} placeholder="2019" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>City</label>
                    <input className={inputClass} value={form.location_city} onChange={e => setField('location_city', e.target.value)} placeholder="Melbourne" />
                  </div>
                  <div>
                    <label className={labelClass}>State / Country</label>
                    <input className={inputClass} value={form.location_state} onChange={e => setField('location_state', e.target.value)} placeholder="VIC" />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Venue Name</label>
                  <input className={inputClass} value={form.location_venue} onChange={e => setField('location_venue', e.target.value)} placeholder="Venue name" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Start Date</label>
                    <input className={inputClass} type="date" value={form.start_date} onChange={e => setField('start_date', e.target.value)} />
                  </div>
                  <div>
                    <label className={labelClass}>End Date</label>
                    <input className={inputClass} type="date" value={form.end_date} onChange={e => setField('end_date', e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Short Description</label>
                  <textarea
                    className={`${inputClass} resize-none`}
                    rows={3}
                    value={form.description}
                    onChange={e => setField('description', e.target.value)}
                    placeholder="A brief summary of this event..."
                  />
                </div>
                <div>
                  <label className={labelClass}>Event Logo / Photo</label>
                  {form.logo_url && (
                    <div className="mb-3">
                      <img src={form.logo_url} alt="logo" className="h-20 rounded-lg object-contain bg-[#191919] p-2 border border-line" />
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files[0] && uploadLogo(e.target.files[0])} />
                    <button
                      onClick={() => logoRef.current?.click()}
                      disabled={logoUploading}
                      className="text-xs border border-line bg-[#191919] hover:bg-line text-[#e5e5e5]/60 hover:text-white px-3 py-2 rounded-lg transition-colors flex-shrink-0"
                    >
                      {logoUploading ? 'Uploading…' : 'Upload image'}
                    </button>
                    <input
                      className={`${inputClass} flex-1`}
                      value={form.logo_url}
                      onChange={e => setField('logo_url', e.target.value)}
                      placeholder="or paste image URL"
                    />
                  </div>
                </div>
                <div className="pt-2">
                  <div className="flex items-center gap-2 px-3 py-2 bg-[#191919] rounded-lg border border-line">
                    <svg className="w-3.5 h-3.5 text-[#e5e5e5]/30 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-xs text-[#e5e5e5]/30">All records in Event History are archived by default and visible publicly.</p>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2 — Results */}
            {activeTab === 1 && (
              <div className="space-y-8 max-w-2xl">

                {/* Team podium */}
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-brand mb-4">Team Results</p>
                  <div className="space-y-3">
                    {[
                      { label: '🥇 Champion', teamKey: 'champion_team', stateKey: 'champion_state' },
                      { label: '🥈 Runner Up', teamKey: 'runner_up_team', stateKey: 'runner_up_state' },
                      { label: '🥉 Third Place', teamKey: 'third_place_team', stateKey: 'third_place_state' },
                    ].map(({ label, teamKey, stateKey }) => (
                      <div key={teamKey} className="flex items-center gap-3">
                        <span className="text-sm text-[#e5e5e5]/50 w-28 flex-shrink-0">{label}</span>
                        <input className={`${inputClass} flex-1`} value={form[teamKey]} onChange={e => setField(teamKey, e.target.value)} placeholder="Team name" />
                        <input className={`${inputClass} w-24`} value={form[stateKey]} onChange={e => setField(stateKey, e.target.value)} placeholder="State" />
                      </div>
                    ))}
                  </div>
                </div>

                {/* MVP */}
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-brand mb-4">MVP / Player of the Tournament</p>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <label className={labelClass}>Full Name</label>
                      <input className={inputClass} value={form.mvp_name} onChange={e => setField('mvp_name', e.target.value)} placeholder="Player name" />
                    </div>
                    <div className="w-44">
                      <label className={labelClass}>Alias / Callsign</label>
                      <input className={inputClass} value={form.mvp_alias} onChange={e => setField('mvp_alias', e.target.value)} placeholder="Alias" />
                    </div>
                  </div>
                </div>

                {/* Side event results */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-xs font-bold uppercase tracking-widest text-brand">Side Event Results</p>
                    <button
                      onClick={addSideEvent}
                      className="text-xs bg-brand/10 hover:bg-brand/20 text-brand border border-brand/20 px-3 py-1.5 rounded-lg font-medium transition-colors"
                    >
                      + Add side event result
                    </button>
                  </div>
                  {(form.side_event_results ?? []).length === 0 && (
                    <p className="text-[#e5e5e5]/25 text-sm text-center py-4">No side event results added yet.</p>
                  )}
                  {(form.side_event_results ?? []).map((se, idx) => (
                    <div key={idx} className="bg-[#191919] border border-line rounded-xl p-4 mb-3">
                      <div className="flex items-center gap-3 mb-4">
                        <input
                          className={`${inputClass} flex-1 font-medium`}
                          value={se.name}
                          onChange={e => updateSideEvent(idx, 'name', e.target.value)}
                          placeholder="Side event name (e.g. Solos, Doubles)"
                        />
                        <button onClick={() => removeSideEvent(idx)} className="text-xs text-red-400/50 hover:text-red-400 transition-colors flex-shrink-0">
                          Remove
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { pos: '1st Place', nameKey: 'first_name', aliasKey: 'first_alias' },
                          { pos: '2nd Place', nameKey: 'second_name', aliasKey: 'second_alias' },
                          { pos: '3rd Place', nameKey: 'third_name', aliasKey: 'third_alias' },
                        ].map(({ pos, nameKey, aliasKey }) => (
                          <div key={nameKey}>
                            <p className="text-[10px] text-[#e5e5e5]/35 uppercase tracking-wider mb-2">{pos}</p>
                            <div className="space-y-1.5">
                              <input className={inputClass} value={se[nameKey]} onChange={e => updateSideEvent(idx, nameKey, e.target.value)} placeholder="Name" />
                              <input className={inputClass} value={se[aliasKey]} onChange={e => updateSideEvent(idx, aliasKey, e.target.value)} placeholder="Alias" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Full results text */}
                <div>
                  <label className={labelClass}>Full Results Text</label>
                  <p className="text-[#e5e5e5]/30 text-xs mb-2">
                    Paste or type the complete results, standings, notable mentions. Rendered publicly as formatted text.
                  </p>
                  <textarea
                    className={`${inputClass} resize-y font-mono text-xs leading-relaxed`}
                    rows={12}
                    value={form.full_results_text}
                    onChange={e => setField('full_results_text', e.target.value)}
                    placeholder={'# ZLTAC 2019 Full Results\n\n## Final Standings\n1. Team Alpha — 2,450 pts\n2. Team Bravo — 2,310 pts\n...'}
                  />
                </div>

                {/* Photo gallery */}
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-brand mb-4">Photo Gallery</p>
                  <div className="flex gap-3 mb-4">
                    <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files[0] && uploadPhoto(e.target.files[0])} />
                    <button
                      onClick={() => photoRef.current?.click()}
                      disabled={photoUploading}
                      className="text-xs border border-line bg-[#191919] hover:bg-line text-[#e5e5e5]/60 hover:text-white px-3 py-2 rounded-lg transition-colors flex-shrink-0"
                    >
                      {photoUploading ? 'Uploading…' : 'Upload photo'}
                    </button>
                    <input
                      ref={photoUrlRef}
                      className={`${inputClass} flex-1`}
                      placeholder="or paste image URL and press Enter"
                      onKeyDown={e => { if (e.key === 'Enter') addPhotoUrl() }}
                    />
                    <button
                      onClick={addPhotoUrl}
                      className="text-xs border border-line bg-[#191919] hover:bg-line text-[#e5e5e5]/60 hover:text-white px-3 py-2 rounded-lg transition-colors flex-shrink-0"
                    >
                      Add
                    </button>
                  </div>
                  {(form.photo_urls ?? []).length === 0 && (
                    <p className="text-[#e5e5e5]/25 text-sm text-center py-4">No photos added yet.</p>
                  )}
                  {(form.photo_urls ?? []).length > 0 && (
                    <div className="grid grid-cols-4 gap-2">
                      {form.photo_urls.map((url, i) => (
                        <div key={i} className="relative group">
                          <img src={url} alt="" className="h-20 w-full object-cover rounded-lg bg-[#191919] border border-line" />
                          <button
                            onClick={() => removePhoto(i)}
                            className="absolute top-1 right-1 bg-black/80 text-red-400 text-xs w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3 — Notes */}
            {activeTab === 2 && (
              <div className="max-w-2xl">
                <div className="flex items-center gap-2 mb-4 p-3 bg-[#191919] border border-line rounded-lg">
                  <svg className="w-4 h-4 text-[#e5e5e5]/30 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <p className="text-xs text-[#e5e5e5]/40">Internal notes — visible to committee only, never shown publicly.</p>
                </div>
                <textarea
                  className={`${inputClass} resize-y`}
                  rows={16}
                  value={form.internal_notes}
                  onChange={e => setField('internal_notes', e.target.value)}
                  placeholder="Internal committee notes, context, or references for this event..."
                />
              </div>
            )}
          </div>

          {/* Footer / Save */}
          <div className="px-6 py-4 border-t border-line flex items-center justify-between flex-shrink-0">
            <p className="text-xs text-[#e5e5e5]/30 truncate">{form.name || `ZLTAC ${form.year}`}</p>
            <button
              onClick={save}
              disabled={saving || !form.year || !form.name}
              className="bg-brand hover:bg-brand-hover disabled:opacity-40 text-black font-bold px-6 py-2.5 rounded-xl text-sm transition-all"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 bg-surface border border-line rounded-2xl flex items-center justify-center">
          <div className="text-center">
            <div className="w-14 h-14 bg-[#191919] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-[#e5e5e5]/15" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-[#e5e5e5]/30 text-sm leading-relaxed">Select an event from the list<br />or click <span className="text-brand/60">+ Add past event</span> to create one.</p>
          </div>
        </div>
      )}
    </div>
  )
}
