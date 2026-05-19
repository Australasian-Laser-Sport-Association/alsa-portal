import { useState, useEffect, useRef } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

// "Extras" editor for zltac_event_history — limited to the legacy fields
// that don't live on the modern ZLTAC Results page (/admin/zltac-results).
//
// Public-page podium and side events render from zltac_event_placings, not
// from the champion_* / runner_up_* / third_place_* / side_event_results
// columns edited here. Those columns are retained for historical records
// and any future hand-curated content.
//
// To edit year metadata, MVP, cancelled/upcoming flags, team_count, country,
// or the placings that drive the public page → ZLTAC Results.

const TABS = ['Artwork', 'Legacy Results', 'Notes']

function emptyEditableExtras() {
  return {
    logo_url: '',
    champion_team: '',
    runner_up_team: '',
    third_place_team: '',
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
  const [selected, setSelected] = useState(null) // row id or null
  const [selectedMeta, setSelectedMeta] = useState(null) // { year, name } — read-only header
  const [form, setForm] = useState(emptyEditableExtras())
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
    setSelectedMeta({ year: ev.year, name: ev.name, location_city: ev.location_city, location_state: ev.location_state })
    const { data } = await supabase.from('zltac_event_history').select('*').eq('id', ev.id).single()
    if (data) {
      setForm({
        ...emptyEditableExtras(),
        logo_url: data.logo_url ?? '',
        champion_team: data.champion_team ?? '',
        runner_up_team: data.runner_up_team ?? '',
        third_place_team: data.third_place_team ?? '',
        side_event_results: data.side_event_results ?? [],
        full_results_text: data.full_results_text ?? '',
        photo_urls: data.photo_urls ?? [],
        internal_notes: data.internal_notes ?? '',
      })
      setSelectedMeta(m => ({ ...m, year: data.year, name: data.name, location_city: data.location_city, location_state: data.location_state }))
    }
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
    if (!selected) return
    setSaving(true)
    const payload = {
      logo_url: form.logo_url || null,
      champion_team: form.champion_team || null,
      runner_up_team: form.runner_up_team || null,
      third_place_team: form.third_place_team || null,
      side_event_results: form.side_event_results?.length > 0 ? form.side_event_results : null,
      full_results_text: form.full_results_text || null,
      photo_urls: form.photo_urls?.length > 0 ? form.photo_urls : null,
      internal_notes: form.internal_notes || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('zltac_event_history').update(payload).eq('id', selected)
    setSaving(false)
    if (error) {
      showToast(error.message, 'error')
    } else {
      showToast('Saved successfully')
      loadEvents()
    }
  }

  async function uploadLogo(file) {
    setLogoUploading(true)
    const ext = file.name.split('.').pop()
    const path = `history/${selectedMeta?.year ?? 'unknown'}-logo-${Date.now()}.${ext}`
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
    const path = `history/${selectedMeta?.year ?? 'unknown'}-${Date.now()}.${ext}`
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
    <div className="flex flex-col md:flex-row gap-6" style={{ minHeight: 'calc(100vh - 10rem)' }}>
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-xl border ${
          toast.type === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-brand/10 border-brand/30 text-brand'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Left: event list */}
      <div className="w-full md:w-72 flex-shrink-0 flex flex-col gap-3">
        <div>
          <h1 className="text-lg font-black text-white">Event History (extras)</h1>
          <p className="text-xs text-[#e5e5e5]/40 mt-1 leading-relaxed">
            Legacy/optional fields only. Year metadata, MVP, flags, and the public-facing placings are managed on{' '}
            <Link to="/admin/zltac-results" className="text-brand/80 hover:text-brand">ZLTAC Results</Link>.
          </p>
        </div>

        <div className="flex flex-col gap-2 max-h-[60vh] md:max-h-none overflow-y-auto pr-1">
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
          {/* Read-only context header */}
          <div className="px-6 py-4 border-b border-line flex items-center justify-between gap-3 flex-shrink-0">
            <div className="min-w-0">
              <p className="text-xs text-[#e5e5e5]/40 uppercase tracking-wider">Editing extras for</p>
              <p className="text-white font-bold text-sm truncate">
                <span className="text-brand">{selectedMeta?.year}</span> · {selectedMeta?.name || `ZLTAC ${selectedMeta?.year ?? ''}`}
              </p>
            </div>
            <Link
              to="/admin/zltac-results"
              className="text-xs text-brand/80 hover:text-brand font-medium flex-shrink-0"
            >
              Edit year metadata, placings, MVP, flags on ZLTAC Results →
            </Link>
          </div>

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

            {/* TAB 1 — Artwork (logo only) */}
            {activeTab === 0 && (
              <div className="space-y-5 max-w-2xl">
                <div>
                  <label className={labelClass}>Event Logo</label>
                  {form.logo_url && (
                    <div className="mb-3">
                      <img src={form.logo_url} alt="logo" className="h-20 rounded-lg object-contain bg-[#191919] p-2 border border-line" />
                    </div>
                  )}
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                    <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={e => e.target.files[0] && uploadLogo(e.target.files[0])} />
                    <button
                      onClick={() => logoRef.current?.click()}
                      disabled={logoUploading}
                      className="text-xs border border-line bg-[#191919] hover:bg-line text-[#e5e5e5]/60 hover:text-white px-3 py-2 rounded-lg transition-colors flex-shrink-0 self-start"
                    >
                      {logoUploading ? 'Uploading…' : 'Upload image'}
                    </button>
                    <input
                      className={`${inputClass} xl:flex-1 xl:min-w-0`}
                      value={form.logo_url}
                      onChange={e => setField('logo_url', e.target.value)}
                      placeholder="or paste image URL"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2 — Legacy Results */}
            {activeTab === 1 && (
              <div className="space-y-8 max-w-2xl">

                {/* Advisory */}
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3 flex items-start gap-2">
                  <svg className="w-4 h-4 text-amber-400/70 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <p className="text-xs text-amber-400/80 leading-relaxed">
                    The public-page podium is rendered from the placings editor on{' '}
                    <Link to="/admin/zltac-results" className="underline">ZLTAC Results</Link>.
                    These legacy podium / side-event fields are kept for historical data only and are{' '}
                    <strong>not displayed publicly</strong>.
                  </p>
                </div>

                {/* Team podium */}
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-brand mb-4">Team Results (legacy)</p>
                  <div className="space-y-3">
                    {[
                      { label: '🥇 Champion', teamKey: 'champion_team' },
                      { label: '🥈 Runner Up', teamKey: 'runner_up_team' },
                      { label: '🥉 Third Place', teamKey: 'third_place_team' },
                    ].map(({ label, teamKey }) => (
                      <div key={teamKey} className="flex flex-col gap-2 xl:flex-row xl:items-center xl:gap-3">
                        <span className="text-sm text-[#e5e5e5]/50 xl:w-28 xl:flex-shrink-0">{label}</span>
                        <input
                          className={`${inputClass} xl:flex-1 xl:min-w-0`}
                          value={form[teamKey]}
                          onChange={e => setField(teamKey, e.target.value)}
                          placeholder="Team name"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Side event results (legacy JSONB) */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-xs font-bold uppercase tracking-widest text-brand">Side Event Results (legacy JSONB)</p>
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
                      <div className="flex flex-col gap-3 mb-4 xl:flex-row xl:items-center">
                        <input
                          className={`${inputClass} font-medium xl:flex-1 xl:min-w-0`}
                          value={se.name}
                          onChange={e => updateSideEvent(idx, 'name', e.target.value)}
                          placeholder="Side event name (e.g. Solos, Doubles)"
                        />
                        <button onClick={() => removeSideEvent(idx)} className="text-xs text-red-400/50 hover:text-red-400 transition-colors flex-shrink-0 self-end xl:self-auto">
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
            <p className="text-xs text-[#e5e5e5]/30 truncate">
              {selectedMeta?.name || `ZLTAC ${selectedMeta?.year ?? ''}`}
            </p>
            <button
              onClick={save}
              disabled={saving}
              className="bg-brand hover:bg-brand-hover disabled:opacity-40 text-black font-bold px-6 py-2.5 rounded-xl text-sm transition-all"
            >
              {saving ? 'Saving…' : 'Save extras'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 bg-surface border border-line rounded-2xl flex items-center justify-center min-h-[300px]">
          <div className="text-center px-6">
            <div className="w-14 h-14 bg-[#191919] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-[#e5e5e5]/15" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-[#e5e5e5]/30 text-sm leading-relaxed">
              Select an event from the list to edit its legacy/extra fields.<br />
              <span className="text-[#e5e5e5]/40 text-xs mt-2 block">
                To create a new tournament year, use{' '}
                <Link to="/admin/zltac-results" className="text-brand/70 hover:text-brand">ZLTAC Results</Link>.
              </span>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
