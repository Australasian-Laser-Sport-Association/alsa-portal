import { useState, useEffect, useMemo, useRef } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { maskStorageUrl } from '../../lib/assetUrl'

const inputClass = 'w-full bg-[#191919] border border-line rounded-lg px-3 py-2 text-sm text-white placeholder-[#e5e5e5]/30 focus:outline-none focus:border-brand/50 transition-colors'
const labelClass = 'block text-xs font-medium text-[#e5e5e5]/60 uppercase tracking-wider mb-1.5'

const DIVISIONS = [
  { key: 'team',    label: 'Teams (main event)' },
  { key: 'solos',   label: 'Solos' },
  { key: 'doubles', label: 'Doubles' },
  { key: 'triples', label: 'Triples' },
  { key: 'masters', label: 'Masters' },
  { key: 'womens',  label: 'Womens' },
  { key: 'juniors', label: 'Juniors' },
  { key: 'lotr',    label: 'Lord of the Rings' },
]

const CURRENT_YEAR = new Date().getFullYear()

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function Toast({ toast }) {
  if (!toast) return null
  return (
    <div className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-medium shadow-xl border ${
      toast.type === 'error'
        ? 'bg-red-500/10 border-red-500/30 text-red-400'
        : 'bg-brand/10 border-brand/30 text-brand'
    }`}>
      {toast.msg}
    </div>
  )
}

function useToast() {
  const [toast, setToast] = useState(null)
  function show(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }
  return { toast, show }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminZLTACResults() {
  useOutletContext()
  const [tab, setTab] = useState('tournaments')

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h1 className="text-lg font-black text-white">ZLTAC Results</h1>
        <div className="flex bg-[#111] border border-line rounded-lg p-1">
          <button
            onClick={() => setTab('tournaments')}
            className={`px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition-colors ${
              tab === 'tournaments' ? 'bg-brand text-black' : 'text-[#e5e5e5]/60 hover:text-white'
            }`}
          >
            Tournaments
          </button>
          <button
            onClick={() => setTab('standouts')}
            className={`px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition-colors ${
              tab === 'standouts' ? 'bg-brand text-black' : 'text-[#e5e5e5]/60 hover:text-white'
            }`}
          >
            Standouts
          </button>
          <button
            onClick={() => setTab('extras')}
            className={`px-4 py-1.5 text-xs font-bold uppercase tracking-wider rounded transition-colors ${
              tab === 'extras' ? 'bg-brand text-black' : 'text-[#e5e5e5]/60 hover:text-white'
            }`}
          >
            Extras
          </button>
        </div>
      </div>

      {tab === 'tournaments' && <TournamentsTab />}
      {tab === 'standouts' && <StandoutsTab />}
      {tab === 'extras' && <ExtrasTab />}
    </div>
  )
}


// ===========================================================================
// TOURNAMENTS TAB
// ===========================================================================

function emptyYearForm() {
  return {
    year: '',
    name: '',
    location_venue: '',
    location_city: '',
    location_state: '',
    location_country: '',
    start_date: '',
    end_date: '',
    description: '',
    historic_note: '',
    team_count: '',
    is_cancelled: false,
    is_upcoming: false,
    mvp_name: '',
    mvp_alias: '',
  }
}

function TournamentsTab() {
  const [years, setYears] = useState([])
  const [placingCounts, setPlacingCounts] = useState(new Map()) // year → count
  const [loadingList, setLoadingList] = useState(true)
  const [selected, setSelected] = useState(null) // 'new' | uuid | null
  const { toast, show: showToast } = useToast()

  async function loadList() {
    setLoadingList(true)
    const [yearsRes, placingsRes] = await Promise.all([
      supabase
        .from('zltac_event_history')
        .select('id, year, name, location_city, location_state, location_venue, location_country, is_cancelled, is_upcoming, team_count')
        .order('year', { ascending: false }),
      supabase
        .from('zltac_event_placings')
        .select('tournament_year'),
    ])
    if (!yearsRes.error) setYears(yearsRes.data ?? [])
    if (!placingsRes.error) {
      const counts = new Map()
      for (const p of (placingsRes.data ?? [])) {
        counts.set(p.tournament_year, (counts.get(p.tournament_year) ?? 0) + 1)
      }
      setPlacingCounts(counts)
    }
    setLoadingList(false)
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadList() }, [])

  function startNew() {
    setSelected('new')
  }

  return (
    <div className="flex flex-col md:flex-row gap-6" style={{ minHeight: 'calc(100vh - 14rem)' }}>
      <Toast toast={toast} />

      {/* Left: year list */}
      <div className="w-full md:w-80 flex-shrink-0 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Tournaments</h2>
          <button
            onClick={startNew}
            className="text-xs bg-brand/10 hover:bg-brand/20 text-brand border border-brand/20 px-3 py-1.5 rounded-lg font-medium transition-colors"
          >
            + Add year
          </button>
        </div>
        <p className="text-xs text-[#e5e5e5]/60">{years.length} {years.length === 1 ? 'year' : 'years'}</p>

        <div className="flex flex-col gap-2 max-h-[60vh] md:max-h-none overflow-y-auto pr-1">
          {loadingList && (
            <div className="flex justify-center py-8">
              <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {!loadingList && years.length === 0 && (
            <p className="text-[#e5e5e5]/60 text-sm text-center py-10">No tournaments yet.</p>
          )}
          {years.map(y => {
            const placings = placingCounts.get(y.year) ?? 0
            const loc = [y.location_city, y.location_state, y.location_country]
              .filter(Boolean)
              .filter((v, i, arr) => arr.indexOf(v) === i)
              .join(', ')
            return (
              <button
                key={y.id}
                onClick={() => setSelected(y.id)}
                className={`text-left px-3 py-2.5 rounded-xl border transition-all ${
                  selected === y.id
                    ? 'bg-brand/10 border-brand/30'
                    : 'bg-surface border-line hover:border-brand/20'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-0.5">
                  <span className="font-black text-brand text-base tabular-nums">{y.year}</span>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {y.is_cancelled && (
                      <span className="text-[10px] bg-red-500/15 text-red-400 border border-red-500/30 px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">
                        Cancelled
                      </span>
                    )}
                    {y.is_upcoming && (
                      <span className="text-[10px] bg-brand/15 text-brand border border-brand/30 px-1.5 py-0.5 rounded font-bold uppercase tracking-wide">
                        Upcoming
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-sm font-semibold text-white truncate">{y.name || `ZLTAC ${y.year}`}</p>
                {loc && <p className="text-xs text-[#e5e5e5]/60 truncate mt-0.5">{loc}</p>}
                <p className="text-[10px] text-[#e5e5e5]/60 mt-1 uppercase tracking-wider">
                  {placings} {placings === 1 ? 'placing' : 'placings'}
                </p>
              </button>
            )
          })}
        </div>
      </div>

      {/* Right: editor */}
      {selected ? (
        <TournamentEditor
          key={selected}
          rowId={selected}
          onClose={() => setSelected(null)}
          onSaved={(newId) => {
            loadList()
            if (selected === 'new' && newId) setSelected(newId)
          }}
          onDeleted={() => {
            setSelected(null)
            loadList()
          }}
          showToast={showToast}
        />
      ) : (
        <div className="flex-1 bg-surface border border-line rounded-2xl flex items-center justify-center min-h-[300px]">
          <div className="text-center px-6">
            <div className="w-14 h-14 bg-[#191919] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">🏆</span>
            </div>
            <p className="text-[#e5e5e5]/60 text-sm leading-relaxed">
              Select a tournament year from the list<br />
              or click <span className="text-brand/60">+ Add year</span> to create one.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}


// ---------------------------------------------------------------------------
// Tournament editor — metadata + placings for a single year
// ---------------------------------------------------------------------------

function TournamentEditor({ rowId, onClose, onSaved, onDeleted, showToast }) {
  const isNew = rowId === 'new'
  const [loaded, setLoaded] = useState(false)
  const [form, setForm] = useState(emptyYearForm())
  const [placings, setPlacings] = useState([]) // [{ division, rank, name, subtitle }]
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [errors, setErrors] = useState({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (isNew) {
        setForm(emptyYearForm())
        setPlacings([])
        setLoaded(true)
        return
      }
      const evRes = await supabase.from('zltac_event_history').select('*').eq('id', rowId).single()
      if (cancelled) return
      if (evRes.data) {
        const d = evRes.data
        setForm({
          year: d.year ?? '',
          name: d.name ?? '',
          location_venue: d.location_venue ?? '',
          location_city: d.location_city ?? '',
          location_state: d.location_state ?? '',
          location_country: d.location_country ?? '',
          start_date: d.start_date ?? '',
          end_date: d.end_date ?? '',
          description: d.description ?? '',
          historic_note: d.historic_note ?? '',
          team_count: d.team_count ?? '',
          is_cancelled: !!d.is_cancelled,
          is_upcoming: !!d.is_upcoming,
          mvp_name: d.mvp_name ?? '',
          mvp_alias: d.mvp_alias ?? '',
        })
        const plRes = await supabase.from('zltac_event_placings')
          .select('division, rank, name, subtitle')
          .eq('tournament_year', d.year)
          .order('division').order('rank')
        if (cancelled) return
        setPlacings(plRes.data ?? [])
      } else {
        setPlacings([])
      }
      setLoaded(true)
    }
    load()
    return () => { cancelled = true }
  }, [rowId, isNew])

  function setField(key, val) {
    setForm(f => ({ ...f, [key]: val }))
    if (errors[key]) setErrors(e => ({ ...e, [key]: undefined }))
  }

  function validate() {
    const e = {}
    const yr = parseInt(form.year)
    if (!Number.isInteger(yr) || yr < 1999 || yr > CURRENT_YEAR + 5) {
      e.year = `Year must be between 1999 and ${CURRENT_YEAR + 5}.`
    }
    if (!form.name?.trim()) e.name = 'Name is required.'
    if (form.is_cancelled && form.is_upcoming) {
      e.flags = 'Cannot be both cancelled and upcoming.'
    }
    if (form.team_count !== '' && form.team_count !== null) {
      const n = parseInt(form.team_count)
      if (!Number.isInteger(n) || n < 0) e.team_count = 'Team count must be a non-negative integer.'
    }
    // Placings: unique (division, rank); rank must be int; name required
    const placingErrors = []
    const seen = new Set()
    placings.forEach((p, i) => {
      const key = `${p.division}:${p.rank}`
      if (!Number.isInteger(parseInt(p.rank))) {
        placingErrors.push(`Row ${i + 1}: rank must be an integer.`)
      } else if (seen.has(key)) {
        placingErrors.push(`${DIVISIONS.find(d => d.key === p.division)?.label || p.division}: duplicate rank ${p.rank}.`)
      } else {
        seen.add(key)
      }
      if (!p.name?.trim()) {
        placingErrors.push(`${DIVISIONS.find(d => d.key === p.division)?.label || p.division} rank ${p.rank}: name required.`)
      }
    })
    if (placingErrors.length > 0) e.placings = placingErrors

    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function save() {
    if (!validate()) {
      showToast('Fix the highlighted errors before saving.', 'error')
      return
    }
    setSaving(true)

    const payload = {
      year: parseInt(form.year),
      name: form.name.trim(),
      location_venue: form.location_venue?.trim() || null,
      location_city: form.location_city?.trim() || null,
      location_state: form.location_state?.trim() || null,
      location_country: form.location_country?.trim() || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      description: form.description?.trim() || null,
      historic_note: form.historic_note?.trim() || null,
      team_count: form.team_count !== '' ? parseInt(form.team_count) : null,
      is_cancelled: !!form.is_cancelled,
      is_upcoming: !!form.is_upcoming,
      mvp_name: form.mvp_name?.trim() || null,
      mvp_alias: form.mvp_alias?.trim() || null,
      updated_at: new Date().toISOString(),
    }

    let savedYear = payload.year
    let savedId = rowId

    if (isNew) {
      const res = await supabase.from('zltac_event_history').insert(payload).select('id, year').single()
      if (res.error) {
        setSaving(false)
        showToast(res.error.message, 'error')
        return
      }
      savedId = res.data.id
      savedYear = res.data.year
    } else {
      const res = await supabase.from('zltac_event_history').update(payload).eq('id', rowId)
      if (res.error) {
        setSaving(false)
        showToast(res.error.message, 'error')
        return
      }
    }

    // Sync placings: delete all for this year, re-insert the current set.
    // Simple + safe — race-free for a single editor.
    const placingsPayload = placings
      .filter(p => p.name?.trim() && Number.isInteger(parseInt(p.rank)))
      .map(p => ({
        tournament_year: savedYear,
        division: p.division,
        rank: parseInt(p.rank),
        name: p.name.trim(),
        subtitle: p.subtitle?.trim() || null,
      }))

    const delRes = await supabase
      .from('zltac_event_placings')
      .delete()
      .eq('tournament_year', savedYear)
    if (delRes.error) {
      setSaving(false)
      showToast(`Placings clear failed: ${delRes.error.message}`, 'error')
      return
    }

    if (placingsPayload.length > 0) {
      const insRes = await supabase.from('zltac_event_placings').insert(placingsPayload)
      if (insRes.error) {
        setSaving(false)
        showToast(`Placings save failed (year metadata saved, placings empty): ${insRes.error.message}`, 'error')
        return
      }
    }

    setSaving(false)
    showToast('Saved.')
    onSaved(savedId)
  }

  async function deleteRow() {
    if (isNew) return
    setDeleting(true)
    // Wipe placings first to avoid dangling rows by year (no FK, but tidy).
    if (form.year) {
      await supabase.from('zltac_event_placings').delete().eq('tournament_year', parseInt(form.year))
    }
    const { error } = await supabase.from('zltac_event_history').delete().eq('id', rowId)
    setDeleting(false)
    if (error) {
      showToast(error.message, 'error')
      return
    }
    showToast('Tournament deleted.')
    onDeleted()
  }

  if (!loaded) {
    return (
      <div className="flex-1 bg-surface border border-line rounded-2xl flex items-center justify-center min-h-[300px]">
        <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex-1 bg-surface border border-line rounded-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-line flex items-center justify-between gap-3 flex-shrink-0">
        <div className="min-w-0">
          <p className="text-xs text-[#e5e5e5]/60 uppercase tracking-wider">
            {isNew ? 'New tournament year' : 'Editing'}
          </p>
          <p className="text-white font-bold text-sm truncate">
            {form.name || (form.year ? `ZLTAC ${form.year}` : '(unnamed)')}
          </p>
        </div>
        <button onClick={onClose} className="text-xs text-[#e5e5e5]/60 hover:text-white">✕ Close</button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        {!isNew && (
          <div className="bg-[#191919] border border-line rounded-lg px-4 py-3 text-xs text-[#e5e5e5]/60 flex items-center gap-2">
            <span>For event logo, photos, full results text, and committee notes, use the Extras tab.</span>
          </div>
        )}

        {/* SECTION 1 — Year metadata */}
        <section className="space-y-5">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Year metadata</h3>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className={labelClass}>Year *</label>
              <input
                type="number"
                className={inputClass}
                value={form.year}
                onChange={e => setField('year', e.target.value)}
                placeholder="2024"
              />
              {errors.year && <p className="text-xs text-red-400 mt-1">{errors.year}</p>}
            </div>
            <div className="col-span-3">
              <label className={labelClass}>Tournament name *</label>
              <input
                className={inputClass}
                value={form.name}
                onChange={e => setField('name', e.target.value)}
                placeholder="ZLTAC 2024"
              />
              {errors.name && <p className="text-xs text-red-400 mt-1">{errors.name}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className={labelClass}>Venue</label>
              <input className={inputClass} value={form.location_venue} onChange={e => setField('location_venue', e.target.value)} placeholder="Albury" />
            </div>
            <div>
              <label className={labelClass}>City</label>
              <input className={inputClass} value={form.location_city} onChange={e => setField('location_city', e.target.value)} placeholder="Albury" />
            </div>
            <div>
              <label className={labelClass}>State / region</label>
              <input className={inputClass} value={form.location_state} onChange={e => setField('location_state', e.target.value)} placeholder="NSW" />
            </div>
            <div>
              <label className={labelClass}>Country</label>
              <input className={inputClass} value={form.location_country} onChange={e => setField('location_country', e.target.value)} placeholder="AU" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Start date</label>
              <input type="date" className={inputClass} value={form.start_date} onChange={e => setField('start_date', e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>End date</label>
              <input type="date" className={inputClass} value={form.end_date} onChange={e => setField('end_date', e.target.value)} />
            </div>
          </div>

          <div>
            <label className={labelClass}>Description / per-year notes</label>
            <textarea
              className={`${inputClass} resize-y`}
              rows={3}
              value={form.description}
              onChange={e => setField('description', e.target.value)}
              placeholder="e.g. Vikings (Hobart) back-to-back team champions."
            />
            <p className="text-xs text-[#e5e5e5]/60 mt-1">Shown on the public detail page hero and in the year card expanded details.</p>
          </div>

          <div>
            <label className={labelClass}>Historic note (sub-heading)</label>
            <input
              className={inputClass}
              value={form.historic_note}
              onChange={e => setField('historic_note', e.target.value)}
              placeholder="e.g. Originally known as the Australian Zone 3 Nationals"
            />
            <p className="text-xs text-[#e5e5e5]/60 mt-1">Shown as italic sub-heading above the location on the year card. Use sparingly.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>Team count</label>
              <input
                type="number"
                className={inputClass}
                value={form.team_count}
                onChange={e => setField('team_count', e.target.value)}
                placeholder="24"
              />
              {errors.team_count && <p className="text-xs text-red-400 mt-1">{errors.team_count}</p>}
            </div>
            <div className="flex items-center pt-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!form.is_cancelled}
                  onChange={e => setField('is_cancelled', e.target.checked)}
                  className="w-4 h-4 accent-brand"
                />
                <span className="text-sm text-white">Cancelled</span>
              </label>
            </div>
            <div className="flex items-center pt-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!form.is_upcoming}
                  onChange={e => setField('is_upcoming', e.target.checked)}
                  className="w-4 h-4 accent-brand"
                />
                <span className="text-sm text-white">Upcoming</span>
              </label>
            </div>
          </div>
          {errors.flags && <p className="text-xs text-red-400 -mt-2">{errors.flags}</p>}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>MVP name</label>
              <input className={inputClass} value={form.mvp_name} onChange={e => setField('mvp_name', e.target.value)} placeholder="Player name" />
            </div>
            <div>
              <label className={labelClass}>MVP alias</label>
              <input className={inputClass} value={form.mvp_alias} onChange={e => setField('mvp_alias', e.target.value)} placeholder="Callsign" />
            </div>
          </div>
        </section>

        {/* SECTION 2 — Placings */}
        <section className="space-y-5">
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Placings</h3>
            <p className="text-xs text-[#e5e5e5]/60 mt-1">
              Drives the public-page podium and side events for this year. One row per (division, rank).
            </p>
          </div>

          {errors.placings && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs text-red-400 space-y-1">
              {errors.placings.map((msg, i) => <p key={i}>• {msg}</p>)}
            </div>
          )}

          <PlacingsEditor placings={placings} setPlacings={setPlacings} />
        </section>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-line flex items-center justify-between flex-shrink-0 gap-3">
        <div>
          {!isNew && !confirmDelete && (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs text-red-400/70 hover:text-red-400 transition-colors"
            >
              Delete tournament
            </button>
          )}
          {!isNew && confirmDelete && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-red-400">Delete year and all its placings?</span>
              <button
                onClick={deleteRow}
                disabled={deleting}
                className="text-xs bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/30 px-2.5 py-1 rounded font-medium disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs text-[#e5e5e5]/60 hover:text-white">Cancel</button>
            </div>
          )}
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="bg-brand hover:bg-brand-hover disabled:opacity-40 text-black font-bold px-6 py-2.5 rounded-xl text-sm transition-all"
        >
          {saving ? 'Saving…' : isNew ? 'Create tournament' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}


// ---------------------------------------------------------------------------
// Placings editor — grouped by division
// ---------------------------------------------------------------------------

function PlacingsEditor({ placings, setPlacings }) {
  const grouped = useMemo(() => {
    const by = new Map()
    for (const div of DIVISIONS) by.set(div.key, [])
    for (const p of placings) {
      if (by.has(p.division)) by.get(p.division).push(p)
    }
    for (const list of by.values()) list.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
    return by
  }, [placings])

  function updateAt(idx, key, val) {
    setPlacings(ps => ps.map((p, i) => i === idx ? { ...p, [key]: val } : p))
  }

  function removeAt(idx) {
    setPlacings(ps => ps.filter((_, i) => i !== idx))
  }

  function addRow(division) {
    const existing = placings.filter(p => p.division === division)
    const nextRank = existing.length === 0
      ? 1
      : Math.max(...existing.map(p => parseInt(p.rank) || 0)) + 1
    setPlacings(ps => [...ps, { division, rank: nextRank, name: '', subtitle: '' }])
  }

  return (
    <div className="space-y-4">
      {DIVISIONS.map(div => {
        const rows = grouped.get(div.key)
        return (
          <div key={div.key} className="bg-[#191919] border border-line rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-bold text-brand uppercase tracking-wider">{div.label}</h4>
              <button
                onClick={() => addRow(div.key)}
                className="text-xs bg-brand/10 hover:bg-brand/20 text-brand border border-brand/20 px-2.5 py-1 rounded font-medium transition-colors"
              >
                + Add placing
              </button>
            </div>

            {rows.length === 0 ? (
              <p className="text-xs text-[#e5e5e5]/60 italic text-center py-3">No placings recorded for this division.</p>
            ) : (
              <div className="space-y-3">
                {rows.map(p => {
                  const idx = placings.indexOf(p)
                  return (
                    <div
                      key={`${div.key}-${idx}`}
                      className="flex flex-col gap-2 xl:flex-row xl:items-start"
                    >
                      {/* Rank + delete (delete shown here on narrow viewports, hidden on xl+) */}
                      <div className="flex items-center gap-2 xl:flex-shrink-0">
                        <input
                          type="number"
                          className={`${inputClass} w-16 text-center font-bold`}
                          value={p.rank}
                          onChange={e => updateAt(idx, 'rank', e.target.value)}
                          title="Rank"
                        />
                        <button
                          onClick={() => removeAt(idx)}
                          className="xl:hidden text-red-400/60 hover:text-red-400 text-lg px-2 ml-auto"
                          title="Remove row"
                        >
                          ×
                        </button>
                      </div>
                      <input
                        className={`${inputClass} xl:flex-1 xl:min-w-0`}
                        value={p.name}
                        onChange={e => updateAt(idx, 'name', e.target.value)}
                        placeholder="Player or team name"
                      />
                      <input
                        className={`${inputClass} xl:flex-1 xl:min-w-0`}
                        value={p.subtitle ?? ''}
                        onChange={e => updateAt(idx, 'subtitle', e.target.value)}
                        placeholder="Subtitle (optional, e.g. team sub-name)"
                      />
                      <button
                        onClick={() => removeAt(idx)}
                        className="hidden xl:block text-red-400/60 hover:text-red-400 text-lg px-2 flex-shrink-0"
                        title="Remove row"
                      >
                        ×
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}


// ===========================================================================
// STANDOUTS TAB — Legends + Dynasties
// ===========================================================================

function StandoutsTab() {
  const { toast, show: showToast } = useToast()

  return (
    <div className="space-y-10">
      <Toast toast={toast} />
      <LegendsSection showToast={showToast} />
      <DynastiesSection showToast={showToast} />
    </div>
  )
}


// ---------------------------------------------------------------------------
// LEGENDS
// ---------------------------------------------------------------------------

function emptyLegend() {
  return { alias: '', titles: '', summary: '', display_order: 0, is_visible: true }
}

function LegendsSection({ showToast }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null) // 'new' | uuid | null
  const [draft, setDraft] = useState(emptyLegend())
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null) // uuid

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('zltac_legends')
      .select('*')
      .order('display_order', { ascending: true })
      .order('alias', { ascending: true })
    setRows(data ?? [])
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [])

  function startEdit(row) {
    setEditingId(row.id)
    setDraft({
      alias: row.alias ?? '',
      titles: row.titles ?? '',
      summary: row.summary ?? '',
      display_order: row.display_order ?? 0,
      is_visible: row.is_visible ?? true,
    })
  }

  function startNew() {
    setEditingId('new')
    setDraft(emptyLegend())
  }

  function cancel() {
    setEditingId(null)
    setDraft(emptyLegend())
  }

  async function save() {
    if (!draft.alias?.trim()) {
      showToast('Alias is required.', 'error')
      return
    }
    setSaving(true)
    const payload = {
      alias: draft.alias.trim(),
      titles: draft.titles?.trim() || null,
      summary: draft.summary?.trim() || null,
      display_order: parseInt(draft.display_order) || 0,
      is_visible: !!draft.is_visible,
    }
    const res = editingId === 'new'
      ? await supabase.from('zltac_legends').insert(payload)
      : await supabase.from('zltac_legends').update(payload).eq('id', editingId)
    setSaving(false)
    if (res.error) {
      showToast(res.error.message, 'error')
      return
    }
    showToast('Saved.')
    cancel()
    load()
  }

  async function doDelete(id) {
    const { error } = await supabase.from('zltac_legends').delete().eq('id', id)
    setConfirmDelete(null)
    if (error) {
      showToast(error.message, 'error')
      return
    }
    showToast('Legend deleted.')
    load()
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Legends (Stand-Out Players)</h2>
          <p className="text-xs text-[#e5e5e5]/60 mt-1">Editorial spotlight cards on the public Stand Out Players section.</p>
        </div>
        <button
          onClick={startNew}
          className="text-xs bg-brand/10 hover:bg-brand/20 text-brand border border-brand/20 px-3 py-1.5 rounded-lg font-medium transition-colors"
        >
          + Add legend
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {editingId === 'new' && (
            <LegendEditCard
              draft={draft} setDraft={setDraft} saving={saving} isNew
              onSave={save} onCancel={cancel}
            />
          )}
          {rows.length === 0 && editingId !== 'new' && (
            <p className="text-[#e5e5e5]/60 text-sm text-center py-6 bg-surface border border-line rounded-xl">No legends yet.</p>
          )}
          {rows.map(r => (
            editingId === r.id ? (
              <LegendEditCard
                key={r.id}
                draft={draft} setDraft={setDraft} saving={saving}
                onSave={save} onCancel={cancel}
              />
            ) : (
              <LegendDisplayCard
                key={r.id}
                row={r}
                onEdit={() => startEdit(r)}
                onDeleteRequest={() => setConfirmDelete(r.id)}
                deleteRequested={confirmDelete === r.id}
                onConfirmDelete={() => doDelete(r.id)}
                onCancelDelete={() => setConfirmDelete(null)}
              />
            )
          ))}
        </div>
      )}
    </section>
  )
}

function LegendDisplayCard({ row, onEdit, onDeleteRequest, deleteRequested, onConfirmDelete, onCancelDelete }) {
  return (
    <div className="bg-surface border border-line rounded-xl p-4 flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-white font-black text-base">{row.alias}</span>
          {!row.is_visible && (
            <span className="text-[10px] bg-[#191919] border border-line text-[#e5e5e5]/60 px-1.5 py-0.5 rounded font-medium uppercase tracking-wide">Hidden</span>
          )}
        </div>
        {row.titles && <p className="text-xs text-brand/70 leading-relaxed">{row.titles}</p>}
        {row.summary && <p className="text-xs text-[#e5e5e5]/60 mt-2 leading-relaxed">{row.summary}</p>}
      </div>
      <div className="flex flex-col items-end gap-2 flex-shrink-0">
        {!deleteRequested ? (
          <>
            <button onClick={onEdit} className="text-xs text-brand/80 hover:text-brand font-medium">Edit</button>
            <button onClick={onDeleteRequest} className="text-xs text-red-400/60 hover:text-red-400">Delete</button>
          </>
        ) : (
          <div className="flex flex-col items-end gap-1">
            <span className="text-xs text-red-400">Delete?</span>
            <div className="flex gap-2">
              <button onClick={onConfirmDelete} className="text-xs bg-red-500/15 text-red-400 border border-red-500/30 px-2 py-0.5 rounded font-medium">Yes</button>
              <button onClick={onCancelDelete} className="text-xs text-[#e5e5e5]/60 hover:text-white">No</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function LegendEditCard({ draft, setDraft, saving, isNew, onSave, onCancel }) {
  function set(k, v) { setDraft(d => ({ ...d, [k]: v })) }
  return (
    <div className="bg-[#191919] border border-brand/30 rounded-xl p-4 space-y-4">
      <p className="text-xs text-brand font-bold uppercase tracking-wider">{isNew ? 'New legend' : 'Editing legend'}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="sm:col-span-2">
          <label className={labelClass}>Alias *</label>
          <input className={inputClass} value={draft.alias} onChange={e => set('alias', e.target.value)} placeholder="Bootza" />
        </div>
        <div>
          <label className={labelClass}>Sort order</label>
          <input type="number" className={inputClass} value={draft.display_order} onChange={e => set('display_order', e.target.value)} />
        </div>
      </div>
      <div>
        <label className={labelClass}>Titles</label>
        <textarea
          className={`${inputClass} resize-y`}
          rows={2}
          value={draft.titles}
          onChange={e => set('titles', e.target.value)}
          placeholder="Separate titles with “ · ” (space-middot-space). e.g. Solos 2015/16/17 · Masters 2012/13/15/19"
        />
      </div>
      <div>
        <label className={labelClass}>Summary</label>
        <textarea
          className={`${inputClass} resize-y`}
          rows={2}
          value={draft.summary}
          onChange={e => set('summary', e.target.value)}
          placeholder="One-line editorial summary."
        />
      </div>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!draft.is_visible} onChange={e => set('is_visible', e.target.checked)} className="w-4 h-4 accent-brand" />
          <span className="text-sm text-white">Show on public page</span>
        </label>
        <div className="flex gap-2">
          <button onClick={onCancel} className="text-xs px-3 py-1.5 text-[#e5e5e5]/60 hover:text-white">Cancel</button>
          <button onClick={onSave} disabled={saving} className="text-xs bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-4 py-1.5 rounded-lg">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}


// ---------------------------------------------------------------------------
// DYNASTIES
// ---------------------------------------------------------------------------

function emptyDynasty() {
  return { team_name: '', category: 'three_peat', years_text: '', note: '', display_order: 0, is_visible: true }
}

function parseYears(text) {
  if (!text) return []
  return text
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => parseInt(s))
}

function validateDynasty(draft) {
  const errors = []
  if (!draft.team_name?.trim()) errors.push('Team name is required.')
  if (draft.category !== 'three_peat' && draft.category !== 'back_to_back') {
    errors.push('Category must be three-peat or back-to-back.')
  }
  const years = parseYears(draft.years_text)
  const expectedLength = draft.category === 'three_peat' ? 3 : 2
  if (years.length !== expectedLength) {
    errors.push(`${draft.category === 'three_peat' ? 'Three-peat' : 'Back-to-back'} requires exactly ${expectedLength} years.`)
  } else if (years.some(y => !Number.isInteger(y))) {
    errors.push('All years must be integers.')
  } else {
    const sorted = years.slice().sort((a, b) => a - b)
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== sorted[i - 1] + 1) {
        errors.push('Years must be consecutive.')
        break
      }
    }
  }
  return { errors, years }
}

function DynastiesSection({ showToast }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState(emptyDynasty())
  const [draftErrors, setDraftErrors] = useState([])
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('zltac_dynasties')
      .select('*')
      .order('display_order', { ascending: true })
      .order('team_name', { ascending: true })
    setRows(data ?? [])
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [])

  function startEdit(row) {
    setEditingId(row.id)
    setDraft({
      team_name: row.team_name ?? '',
      category: row.category ?? 'three_peat',
      years_text: (row.years ?? []).join(', '),
      note: row.note ?? '',
      display_order: row.display_order ?? 0,
      is_visible: row.is_visible ?? true,
    })
    setDraftErrors([])
  }

  function startNew() {
    setEditingId('new')
    setDraft(emptyDynasty())
    setDraftErrors([])
  }

  function cancel() {
    setEditingId(null)
    setDraft(emptyDynasty())
    setDraftErrors([])
  }

  async function save() {
    const { errors, years } = validateDynasty(draft)
    if (errors.length > 0) {
      setDraftErrors(errors)
      return
    }
    setSaving(true)
    const payload = {
      team_name: draft.team_name.trim(),
      category: draft.category,
      years: years.slice().sort((a, b) => a - b),
      note: draft.note?.trim() || null,
      display_order: parseInt(draft.display_order) || 0,
      is_visible: !!draft.is_visible,
    }
    const res = editingId === 'new'
      ? await supabase.from('zltac_dynasties').insert(payload)
      : await supabase.from('zltac_dynasties').update(payload).eq('id', editingId)
    setSaving(false)
    if (res.error) {
      showToast(res.error.message, 'error')
      return
    }
    showToast('Saved.')
    cancel()
    load()
  }

  async function doDelete(id) {
    const { error } = await supabase.from('zltac_dynasties').delete().eq('id', id)
    setConfirmDelete(null)
    if (error) {
      showToast(error.message, 'error')
      return
    }
    showToast('Dynasty deleted.')
    load()
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">Dynasties (Team)</h2>
          <p className="text-xs text-[#e5e5e5]/60 mt-1">Three-peats and back-to-back team championship runs.</p>
        </div>
        <button
          onClick={startNew}
          className="text-xs bg-brand/10 hover:bg-brand/20 text-brand border border-brand/20 px-3 py-1.5 rounded-lg font-medium transition-colors"
        >
          + Add dynasty
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <div className="w-5 h-5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {editingId === 'new' && (
            <DynastyEditCard
              draft={draft} setDraft={setDraft} errors={draftErrors} saving={saving} isNew
              onSave={save} onCancel={cancel}
            />
          )}
          {rows.length === 0 && editingId !== 'new' && (
            <p className="text-[#e5e5e5]/60 text-sm text-center py-6 bg-surface border border-line rounded-xl">No dynasties yet.</p>
          )}
          {rows.map(r => (
            editingId === r.id ? (
              <DynastyEditCard
                key={r.id}
                draft={draft} setDraft={setDraft} errors={draftErrors} saving={saving}
                onSave={save} onCancel={cancel}
              />
            ) : (
              <DynastyDisplayCard
                key={r.id}
                row={r}
                onEdit={() => startEdit(r)}
                onDeleteRequest={() => setConfirmDelete(r.id)}
                deleteRequested={confirmDelete === r.id}
                onConfirmDelete={() => doDelete(r.id)}
                onCancelDelete={() => setConfirmDelete(null)}
              />
            )
          ))}
        </div>
      )}
    </section>
  )
}

function DynastyDisplayCard({ row, onEdit, onDeleteRequest, deleteRequested, onConfirmDelete, onCancelDelete }) {
  const categoryLabel = row.category === 'three_peat' ? 'Three-peat' : 'Back-to-back'
  return (
    <div className="bg-surface border border-line rounded-xl p-4 flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-white font-black text-base">{row.team_name}</span>
          <span className="text-[10px] uppercase tracking-wider font-bold text-brand bg-brand/10 border border-brand/20 px-1.5 py-0.5 rounded">
            {categoryLabel}
          </span>
          {!row.is_visible && (
            <span className="text-[10px] bg-[#191919] border border-line text-[#e5e5e5]/60 px-1.5 py-0.5 rounded font-medium uppercase tracking-wide">Hidden</span>
          )}
        </div>
        <div className="flex flex-wrap gap-1 mt-1">
          {(row.years ?? []).map(y => (
            <span key={y} className="text-xs font-bold text-brand bg-brand/10 px-2 py-0.5 rounded tabular-nums">{y}</span>
          ))}
        </div>
        {row.note && <p className="text-xs text-[#e5e5e5]/60 mt-2 italic">{row.note}</p>}
      </div>
      <div className="flex flex-col items-end gap-2 flex-shrink-0">
        {!deleteRequested ? (
          <>
            <button onClick={onEdit} className="text-xs text-brand/80 hover:text-brand font-medium">Edit</button>
            <button onClick={onDeleteRequest} className="text-xs text-red-400/60 hover:text-red-400">Delete</button>
          </>
        ) : (
          <div className="flex flex-col items-end gap-1">
            <span className="text-xs text-red-400">Delete?</span>
            <div className="flex gap-2">
              <button onClick={onConfirmDelete} className="text-xs bg-red-500/15 text-red-400 border border-red-500/30 px-2 py-0.5 rounded font-medium">Yes</button>
              <button onClick={onCancelDelete} className="text-xs text-[#e5e5e5]/60 hover:text-white">No</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function DynastyEditCard({ draft, setDraft, errors, saving, isNew, onSave, onCancel }) {
  function set(k, v) { setDraft(d => ({ ...d, [k]: v })) }
  return (
    <div className="bg-[#191919] border border-brand/30 rounded-xl p-4 space-y-4">
      <p className="text-xs text-brand font-bold uppercase tracking-wider">{isNew ? 'New dynasty' : 'Editing dynasty'}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="sm:col-span-2">
          <label className={labelClass}>Team name *</label>
          <input className={inputClass} value={draft.team_name} onChange={e => set('team_name', e.target.value)} placeholder="Brisbane Maroons" />
        </div>
        <div>
          <label className={labelClass}>Sort order</label>
          <input type="number" className={inputClass} value={draft.display_order} onChange={e => set('display_order', e.target.value)} />
        </div>
      </div>

      <div>
        <p className={labelClass}>Category</p>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-white">
            <input
              type="radio"
              name={`dynasty-category-${isNew ? 'new' : draft.team_name}`}
              checked={draft.category === 'three_peat'}
              onChange={() => set('category', 'three_peat')}
              className="accent-brand"
            />
            Three-peat (exactly 3 consecutive years)
          </label>
          <label className="flex items-center gap-2 cursor-pointer text-sm text-white">
            <input
              type="radio"
              name={`dynasty-category-${isNew ? 'new' : draft.team_name}`}
              checked={draft.category === 'back_to_back'}
              onChange={() => set('category', 'back_to_back')}
              className="accent-brand"
            />
            Back-to-back (exactly 2 consecutive years)
          </label>
        </div>
      </div>

      <div>
        <label className={labelClass}>Years</label>
        <input
          className={inputClass}
          value={draft.years_text}
          onChange={e => set('years_text', e.target.value)}
          placeholder={draft.category === 'three_peat' ? '2015, 2016, 2017' : '2023, 2024'}
        />
        <p className="text-xs text-[#e5e5e5]/60 mt-1">Comma-separated. Must be consecutive.</p>
      </div>

      <div>
        <label className={labelClass}>Note (optional)</label>
        <input
          className={inputClass}
          value={draft.note}
          onChange={e => set('note', e.target.value)}
          placeholder="e.g. 3rd in 2010, 2nd in 2013"
        />
      </div>

      {errors.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs text-red-400 space-y-1">
          {errors.map((msg, i) => <p key={i}>• {msg}</p>)}
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={!!draft.is_visible} onChange={e => set('is_visible', e.target.checked)} className="w-4 h-4 accent-brand" />
          <span className="text-sm text-white">Show on public page</span>
        </label>
        <div className="flex gap-2">
          <button onClick={onCancel} className="text-xs px-3 py-1.5 text-[#e5e5e5]/60 hover:text-white">Cancel</button>
          <button onClick={onSave} disabled={saving} className="text-xs bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-4 py-1.5 rounded-lg">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}


// ===========================================================================
// EXTRAS TAB — logo, full results text, photo gallery, internal notes
// (rehoused from the former standalone Event History page; edits the four
//  retained zltac_event_history columns. UPDATE only — years are created on
//  the Tournaments tab.)
// ===========================================================================

function emptyExtras() {
  return {
    logo_url: '',
    full_results_text: '',
    photo_urls: [],
    internal_notes: '',
  }
}

function ExtrasTab() {
  const { toast, show: showToast } = useToast()
  const [years, setYears] = useState([])
  const [loadingList, setLoadingList] = useState(true)
  const [selectedId, setSelectedId] = useState('')
  const [selectedYear, setSelectedYear] = useState(null)
  const [form, setForm] = useState(emptyExtras())
  const [saving, setSaving] = useState(false)
  const [logoUploading, setLogoUploading] = useState(false)
  const [photoUploading, setPhotoUploading] = useState(false)
  const logoRef = useRef()
  const photoRef = useRef()
  const photoUrlRef = useRef()

  async function loadYears() {
    setLoadingList(true)
    // Existing zltac_event_history rows only — same table/scope the Tournaments
    // tab lists from. Years that don't exist yet are created there first.
    const { data } = await supabase
      .from('zltac_event_history')
      .select('id, year, name')
      .order('year', { ascending: false })
    setYears(data ?? [])
    setLoadingList(false)
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadYears() }, [])

  async function selectYear(id) {
    setSelectedId(id)
    if (!id) {
      setSelectedYear(null)
      setForm(emptyExtras())
      return
    }
    const { data } = await supabase.from('zltac_event_history').select('*').eq('id', id).single()
    if (data) {
      setSelectedYear(data.year)
      setForm({
        logo_url: data.logo_url ?? '',
        full_results_text: data.full_results_text ?? '',
        photo_urls: data.photo_urls ?? [],
        internal_notes: data.internal_notes ?? '',
      })
    }
  }

  function setField(key, val) {
    setForm(f => ({ ...f, [key]: val }))
  }

  async function save() {
    if (!selectedId) return
    setSaving(true)
    const payload = {
      logo_url: form.logo_url || null,
      full_results_text: form.full_results_text || null,
      photo_urls: form.photo_urls?.length > 0 ? form.photo_urls : null,
      internal_notes: form.internal_notes || null,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('zltac_event_history').update(payload).eq('id', selectedId)
    setSaving(false)
    if (error) showToast(error.message, 'error')
    else showToast('Saved.')
  }

  async function uploadLogo(file) {
    setLogoUploading(true)
    const ext = file.name.split('.').pop()
    const path = `history/${selectedYear ?? 'unknown'}-logo-${Date.now()}.${ext}`
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
    const path = `history/${selectedYear ?? 'unknown'}-${Date.now()}.${ext}`
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

  function removePhoto(idx) {
    setField('photo_urls', form.photo_urls.filter((_, i) => i !== idx))
  }

  return (
    <div className="flex flex-col gap-6" style={{ minHeight: 'calc(100vh - 14rem)' }}>
      <Toast toast={toast} />

      {/* Year picker */}
      <div className="bg-surface border border-line rounded-2xl p-5 max-w-xl">
        <label className={labelClass}>Tournament year</label>
        <select
          value={selectedId}
          onChange={e => selectYear(e.target.value)}
          className={inputClass}
          disabled={loadingList}
        >
          <option value="">{loadingList ? 'Loading…' : 'Select a year…'}</option>
          {years.map(y => (
            <option key={y.id} value={y.id}>
              {y.year} · {y.name || `ZLTAC ${y.year}`}
            </option>
          ))}
        </select>
        <p className="text-xs text-[#e5e5e5]/60 mt-2">
          Only years that already exist appear here. To add a new year, create it on the Tournaments tab first.
        </p>
      </div>

      {/* Editor */}
      {selectedId ? (
        <div className="bg-surface border border-line rounded-2xl flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-8 max-w-2xl">

            {/* Event logo */}
            <div>
              <label className={labelClass}>Event Logo</label>
              {form.logo_url && (
                <div className="mb-3">
                  <img src={maskStorageUrl(form.logo_url)} alt="logo" className="h-20 rounded-lg object-contain bg-[#191919] p-2 border border-line" />
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

            {/* Full results text */}
            <div>
              <label className={labelClass}>Full Results Text</label>
              <p className="text-[#e5e5e5]/60 text-xs mb-2">
                Paste or type the complete results, standings, notable mentions. Rendered publicly as formatted text.
              </p>
              <textarea
                className={`${inputClass} resize-y font-mono text-xs leading-relaxed`}
                rows={12}
                value={form.full_results_text}
                onChange={e => setField('full_results_text', e.target.value)}
                placeholder={'# ZLTAC 2019 Full Results\n\n## Final Standings\n1. Team Alpha (2,450 pts)\n2. Team Bravo (2,310 pts)\n...'}
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
                <p className="text-[#e5e5e5]/60 text-sm text-center py-4">No photos added yet.</p>
              )}
              {(form.photo_urls ?? []).length > 0 && (
                <div className="grid grid-cols-4 gap-2">
                  {form.photo_urls.map((url, i) => (
                    <div key={i} className="relative group">
                      <img src={maskStorageUrl(url)} alt="" className="h-20 w-full object-cover rounded-lg bg-[#191919] border border-line" />
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

            {/* Internal notes */}
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-brand mb-2">Committee Only Notes</p>
              <div className="flex items-center gap-2 mb-4 p-3 bg-[#191919] border border-line rounded-lg">
                <svg className="w-4 h-4 text-[#e5e5e5]/60 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <p className="text-xs text-[#e5e5e5]/60">Committee-only notes. Not displayed publicly.</p>
              </div>
              <textarea
                className={`${inputClass} resize-y`}
                rows={16}
                value={form.internal_notes}
                onChange={e => setField('internal_notes', e.target.value)}
                placeholder="Internal committee notes, context, or references for this event..."
              />
            </div>

          </div>

          {/* Footer / Save */}
          <div className="px-6 py-4 border-t border-line flex items-center justify-end flex-shrink-0">
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
        <div className="bg-surface border border-line rounded-2xl flex items-center justify-center min-h-[240px]">
          <div className="text-center px-6">
            <div className="w-14 h-14 bg-[#191919] rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">🖼️</span>
            </div>
            <p className="text-[#e5e5e5]/60 text-sm leading-relaxed">
              Select a tournament year above to edit its logo, photos,<br />
              full results text, and committee notes.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
