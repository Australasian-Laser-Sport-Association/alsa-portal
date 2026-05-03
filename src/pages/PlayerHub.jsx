import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/apiFetch.js'
import { formatDate } from '../lib/dateFormat'
import Footer from '../components/Footer'
import PlayerHubProgress from '../components/PlayerHubProgress'
import JoinTeamModal from '../components/JoinTeamModal'
import { DashboardGridIcon } from '../components/icons.jsx'

function dollars(cents) {
  return `$${((cents ?? 0) / 100).toFixed(2)}`
}

function isUnder18(dob, eventYear) {
  if (!dob) return false
  const cutoff = new Date(`${eventYear}-07-01`)
  const birth = new Date(dob)
  const eighteenth = new Date(birth)
  eighteenth.setFullYear(eighteenth.getFullYear() + 18)
  return eighteenth > cutoff
}

// ── Checklist Item ──────────────────────────────────────────────────────────
function ChecklistItem({ status, label, children }) {
  // status: 'done' | 'error' | 'pending'
  const [open, setOpen] = useState(false)
  const colors = {
    done: 'bg-brand text-black',
    error: 'bg-red-500/20 border border-red-500/40 text-red-400',
    pending: 'bg-[#374056] text-[#e5e5e5]/40',
  }
  const icons = { done: '✓', error: '✗', pending: '·' }

  return (
    <div className="border-b border-line last:border-0">
      <button
        type="button"
        onClick={() => children && setOpen(v => !v)}
        className={`w-full flex items-center gap-4 px-5 py-4 text-left ${children ? 'hover:bg-line/20 transition-colors' : ''}`}
      >
        <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${colors[status]}`}>
          {icons[status]}
        </div>
        <div className="flex-1">
          <p className={`text-sm font-semibold ${status === 'done' ? 'text-white' : 'text-[#e5e5e5]/70'}`}>{label}</p>
        </div>
        {children && (
          <svg className={`w-4 h-4 text-[#e5e5e5]/30 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>
      {open && children && (
        <div className="px-5 pb-5">{children}</div>
      )}
    </div>
  )
}

// ── CoC Panel ───────────────────────────────────────────────────────────────
function CoCPanel({ userId, eventYear, content, onSigned }) {
  const [agreed, setAgreed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function sign() {
    if (!agreed) return
    setSaving(true)
    const { data: existing, error: checkErr } = await supabase
      .from('code_of_conduct_signatures')
      .select('id')
      .eq('user_id', userId)
      .eq('event_year', eventYear)
      .maybeSingle()
    if (checkErr) { setSaving(false); setError(checkErr.message); return }
    const signedAt = new Date().toISOString()
    let saveError
    if (existing) {
      ;({ error: saveError } = await supabase.from('code_of_conduct_signatures')
        .update({ signed_at: signedAt })
        .eq('user_id', userId)
        .eq('event_year', eventYear))
    } else {
      ;({ error: saveError } = await supabase.from('code_of_conduct_signatures')
        .insert({ user_id: userId, event_year: eventYear, signed_at: signedAt }))
    }
    setSaving(false)
    if (saveError) { setError(saveError.message); return }
    onSigned()
  }

  return (
    <div>
      <div className="bg-base border border-line rounded-xl p-4 h-48 overflow-y-auto mb-4">
        {content ? (
          <pre className="text-[#e5e5e5]/50 text-xs leading-relaxed whitespace-pre-wrap font-sans">{content}</pre>
        ) : (
          <p className="text-[#e5e5e5]/60 italic text-xs">Code of Conduct content is not yet available — contact the committee.</p>
        )}
      </div>
      <label className="flex items-start gap-3 cursor-pointer mb-3">
        <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5 accent-[#00FF41]" />
        <span className="text-[#e5e5e5]/70 text-xs leading-relaxed">I have read and agree to the ALSA Code of Conduct</span>
      </label>
      {error && <p className="text-red-400 text-xs mb-2">{error}</p>}
      <button
        onClick={sign}
        disabled={!agreed || saving}
        className="bg-brand hover:bg-brand-hover disabled:opacity-40 text-black font-bold px-5 py-2 rounded-lg text-xs transition-colors"
      >
        {saving ? 'Signing…' : 'Sign Code of Conduct'}
      </button>
    </div>
  )
}

// ── Under 18 Panel ──────────────────────────────────────────────────────────
function Under18Panel({ userId, eventYear, playerName, formContent, onSubmitted }) {
  const [parentName, setParentName] = useState('')
  const [relationship, setRelationship] = useState('Parent')
  const [parentPhone, setParentPhone] = useState('')
  const [parentEmail, setParentEmail] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!parentName.trim() || !parentPhone.trim()) { setError('Parent/Guardian name and phone are required.'); return }
    if (!agreed) { setError('Guardian consent is required.'); return }
    setSaving(true)
    const { error: submitError } = await supabase.from('under18_submissions').upsert({
      user_id: userId,
      event_year: eventYear,
      parent_name: parentName.trim(),
      relationship,
      parent_phone: parentPhone.trim(),
      parent_email: parentEmail.trim() || null,
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'user_id,event_year' })
    setSaving(false)
    if (submitError) { setError(submitError.message); return }
    onSubmitted()
  }

  return (
    <div>
      <div className="bg-base border border-line rounded-xl p-4 h-40 overflow-y-auto mb-4">
        {formContent ? (
          <pre className="text-[#e5e5e5]/50 text-xs leading-relaxed whitespace-pre-wrap font-sans">{formContent}</pre>
        ) : (
          <p className="text-[#e5e5e5]/60 italic text-xs">Under-18 form is not yet available — contact the committee.</p>
        )}
      </div>
      <div className="space-y-3 mb-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-[#e5e5e5]/40 mb-1">Parent / Guardian Name *</label>
            <input type="text" value={parentName} onChange={e => setParentName(e.target.value)} placeholder="Full name" className="w-full bg-base border border-line rounded-lg px-3 py-2 text-xs text-white placeholder-[#e5e5e5]/20 focus:outline-none focus:border-brand" />
          </div>
          <div>
            <label className="block text-xs text-[#e5e5e5]/40 mb-1">Relationship</label>
            <select value={relationship} onChange={e => setRelationship(e.target.value)} className="w-full bg-base border border-line rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-brand">
              {['Parent', 'Legal Guardian', 'Other'].map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-[#e5e5e5]/40 mb-1">Phone *</label>
            <input type="tel" value={parentPhone} onChange={e => setParentPhone(e.target.value)} placeholder="04XX XXX XXX" className="w-full bg-base border border-line rounded-lg px-3 py-2 text-xs text-white placeholder-[#e5e5e5]/20 focus:outline-none focus:border-brand" />
          </div>
          <div>
            <label className="block text-xs text-[#e5e5e5]/40 mb-1">Email</label>
            <input type="email" value={parentEmail} onChange={e => setParentEmail(e.target.value)} placeholder="guardian@email.com" className="w-full bg-base border border-line rounded-lg px-3 py-2 text-xs text-white placeholder-[#e5e5e5]/20 focus:outline-none focus:border-brand" />
          </div>
        </div>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5 accent-[#00FF41]" />
          <span className="text-[#e5e5e5]/60 text-xs leading-relaxed">
            I give consent for <strong className="text-white">{playerName}</strong> to participate in ZLTAC {eventYear} and all associated events.
          </span>
        </label>
      </div>
      {error && <p className="text-red-400 text-xs mb-2">{error}</p>}
      <button
        onClick={submit}
        disabled={saving}
        className="bg-brand hover:bg-brand-hover disabled:opacity-40 text-black font-bold px-5 py-2 rounded-lg text-xs transition-colors"
      >
        {saving ? 'Submitting…' : 'Submit Under 18 Form'}
      </button>
    </div>
  )
}

// ── Media Release Panel ─────────────────────────────────────────────────────
function MediaReleasePanel({ userId, eventYear, formContent, onSubmitted }) {
  const [consents, setConsents] = useState(null) // null | true | false
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (consents === null) { setError('Please select an option.'); return }
    setSaving(true)
    const { error: submitError } = await supabase.from('media_release_submissions').upsert({
      user_id: userId,
      event_year: eventYear,
      consents,
      submitted_at: new Date().toISOString(),
    }, { onConflict: 'user_id,event_year' })
    setSaving(false)
    if (submitError) { setError(submitError.message); return }
    onSubmitted(consents)
  }

  return (
    <div>
      <div className="bg-base border border-line rounded-xl p-4 h-36 overflow-y-auto mb-4">
        {formContent ? (
          <pre className="text-[#e5e5e5]/50 text-xs leading-relaxed whitespace-pre-wrap font-sans">{formContent}</pre>
        ) : (
          <p className="text-[#e5e5e5]/60 italic text-xs">Media release form is not yet available — contact the committee.</p>
        )}
      </div>
      <div className="space-y-2 mb-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="radio" name="media" checked={consents === true} onChange={() => setConsents(true)} className="accent-[#00FF41]" />
          <span className="text-[#e5e5e5]/70 text-xs leading-relaxed">I consent to photos/video being used for ALSA promotional purposes</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="radio" name="media" checked={consents === false} onChange={() => setConsents(false)} className="accent-[#00FF41]" />
          <span className="text-[#e5e5e5]/70 text-xs leading-relaxed">I do not consent to my image being used</span>
        </label>
      </div>
      {error && <p className="text-red-400 text-xs mb-2">{error}</p>}
      <button
        onClick={submit}
        disabled={saving || consents === null}
        className="bg-brand hover:bg-brand-hover disabled:opacity-40 text-black font-bold px-5 py-2 rounded-lg text-xs transition-colors"
      >
        {saving ? 'Submitting…' : 'Submit Media Release'}
      </button>
    </div>
  )
}

// ── Doubles Partner Selector ─────────────────────────────────────────────────
function DoublesSelector({ userId, eventYear, record, partnerProfileMap, onUpdate }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const partnerId = record
    ? (record.player1_id === userId ? record.player2_id : record.player1_id)
    : null
  const partnerProfile = partnerId ? partnerProfileMap[partnerId] : null
  const isInitiator = record?.player1_id === userId

  async function runSearch(q) {
    setSearch(q)
    if (q.trim().length < 2) { setResults([]); return }
    setSearching(true)
    try {
      const { results: res } = await apiFetch('/api/player/doubles', {
        method: 'POST',
        body: JSON.stringify({ action: 'search', eventYear, term: q.trim() }),
      })
      setResults(res ?? [])
    } finally { setSearching(false) }
  }

  async function invite(pid) {
    setSaving(true); setError('')
    try {
      const { record: rec } = await apiFetch('/api/player/doubles', {
        method: 'POST',
        body: JSON.stringify({ action: 'create', eventYear, partnerId: pid }),
      })
      onUpdate(rec, { [pid]: results.find(r => r.id === pid) })
      setSearch(''); setResults([])
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function changePartner() {
    setSaving(true)
    await apiFetch('/api/player/doubles', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', id: record.id }),
    })
    setSaving(false)
    onUpdate(null, {})
  }

  if (record) {
    return (
      <div className="mt-3 bg-base border border-line rounded-xl p-4">
        <p className="text-xs text-[#e5e5e5]/40 font-bold uppercase tracking-wider mb-3">Your Doubles Partner</p>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-full bg-brand/20 border border-brand/30 flex items-center justify-center text-brand font-black text-xs flex-shrink-0">
            {partnerProfile ? ((partnerProfile.first_name?.[0] ?? '') + (partnerProfile.last_name?.[0] ?? '')).toUpperCase() : '?'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-semibold">
              {partnerProfile ? `${partnerProfile.first_name} ${partnerProfile.last_name}` : 'Unknown Player'}
              {partnerProfile?.alias && <span className="text-brand ml-1">"{partnerProfile.alias}"</span>}
            </p>
          </div>
          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${
            record.confirmed
              ? 'bg-green-500/15 text-green-400 border-green-500/30'
              : 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
          }`}>
            {record.confirmed ? 'Confirmed' : isInitiator ? 'Pending their confirmation' : 'Pending your confirmation'}
          </span>
        </div>
        {error && <p className="text-red-400 text-xs mb-2">{error}</p>}
        {isInitiator && (
          <button onClick={changePartner} disabled={saving}
            className="text-xs text-[#e5e5e5]/40 hover:text-white border border-line hover:border-[#374056] px-3 py-1.5 rounded-lg transition-colors">
            {saving ? 'Removing…' : 'Change partner'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="mt-3 bg-base border border-line rounded-xl p-4">
      <p className="text-xs text-[#e5e5e5]/40 font-bold uppercase tracking-wider mb-3">Select your Doubles partner</p>
      <input type="text" value={search} onChange={e => runSearch(e.target.value)}
        placeholder="Search by name or alias…"
        className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-xs text-white placeholder-[#e5e5e5]/25 focus:outline-none focus:border-brand mb-2"
      />
      {searching && <p className="text-[#e5e5e5]/30 text-xs">Searching…</p>}
      {results.length > 0 && (
        <div className="space-y-1 mt-1">
          {results.map(p => (
            <div key={p.id} className="flex items-center gap-3 bg-surface rounded-lg px-3 py-2.5 border border-line">
              <div className="w-7 h-7 rounded-full bg-brand/10 flex items-center justify-center text-brand text-[10px] font-black flex-shrink-0">
                {((p.first_name?.[0] ?? '') + (p.last_name?.[0] ?? '')).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-semibold">
                  {p.first_name} {p.last_name}
                  {p.alias && <span className="text-brand ml-1">"{p.alias}"</span>}
                </p>
                <p className="text-[#e5e5e5]/35 text-[10px] mt-0.5">
                  {p.teamName ?? 'No team'}
                  {p.state && <span className="ml-2 text-brand/60">{p.state}</span>}
                </p>
              </div>
              <button onClick={() => invite(p.id)} disabled={saving}
                className="text-xs bg-brand hover:bg-brand-hover text-black font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0">
                Invite
              </button>
            </div>
          ))}
        </div>
      )}
      {search.trim().length >= 2 && !searching && results.length === 0 && (
        <p className="text-[#e5e5e5]/30 text-xs">No available doubles players found for "{search}"</p>
      )}
      {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
    </div>
  )
}

// ── Triples Partner Selector ─────────────────────────────────────────────────
function TriplesSelector({ userId, eventYear, record, partnerProfileMap, onUpdate }) {
  const [searchSlot, setSearchSlot] = useState(null)
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isCreator = !record || record.player1_id === userId
  const filledSlots = record ? [record.player2_id, record.player3_id].filter(Boolean).length : 0

  async function runSearch(q) {
    setSearch(q)
    if (q.trim().length < 2) { setResults([]); return }
    setSearching(true)
    try {
      const { results: res } = await apiFetch('/api/player/triples', {
        method: 'POST',
        body: JSON.stringify({
          action: 'search',
          eventYear,
          term: q.trim(),
          existingPlayer2Id: record?.player2_id ?? null,
          existingPlayer3Id: record?.player3_id ?? null,
        }),
      })
      setResults(res ?? [])
    } finally { setSearching(false) }
  }

  async function inviteToSlot(slot, pid) {
    setSaving(true); setError('')
    const partnerProfile = results.find(r => r.id === pid)
    try {
      const { record: rec } = await apiFetch('/api/player/triples', {
        method: 'POST',
        body: JSON.stringify(
          record
            ? { action: 'add-slot', id: record.id, slot, partnerId: pid, eventYear }
            : { action: 'create', eventYear, slot, partnerId: pid }
        ),
      })
      onUpdate(rec, partnerProfile ? { [pid]: partnerProfile } : {})
      setSearch(''); setResults([]); setSearchSlot(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function clearSlot(slot) {
    setSaving(true)
    try {
      const { record: rec } = await apiFetch('/api/player/triples', {
        method: 'POST',
        body: JSON.stringify({ action: 'clear-slot', id: record.id, slot }),
      })
      onUpdate(rec, {})
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function disbandTeam() {
    setSaving(true)
    await apiFetch('/api/player/triples', {
      method: 'POST',
      body: JSON.stringify({ action: 'disband', id: record.id }),
    })
    setSaving(false)
    onUpdate(null, {})
  }

  const p2confirmed = record?.player2_confirmed === true
  const p3confirmed = record?.player3_confirmed === true
  const confirmedCount = (p2confirmed ? 1 : 0) + (p3confirmed ? 1 : 0)
  const allConfirmed = record?.confirmed === true

  const overallStatus = allConfirmed ? 'Complete — all confirmed'
    : confirmedCount === 1 ? '1 partner confirmed, waiting for 1 more'
    : filledSlots === 2 ? 'Waiting for partners'
    : `${filledSlots}/2 partners selected`

  function renderSlot(slot, playerId) {
    const isMe = playerId === userId
    const p = playerId ? partnerProfileMap[playerId] : null

    if (!playerId) {
      if (!isCreator) return (
        <div key={slot} className="flex items-center gap-3 py-2.5">
          <div className="w-7 h-7 rounded-full border border-dashed border-line flex items-center justify-center flex-shrink-0">
            <span className="text-[#e5e5e5]/20 text-[10px]">{slot}</span>
          </div>
          <span className="text-[#e5e5e5]/30 text-xs italic">Empty slot</span>
        </div>
      )
      if (searchSlot === slot) return (
        <div key={slot} className="flex items-center gap-3 py-2.5">
          <div className="w-7 h-7 rounded-full border border-dashed border-brand/40 flex items-center justify-center flex-shrink-0">
            <span className="text-brand/40 text-[10px]">{slot}</span>
          </div>
          <input autoFocus type="text" value={search} onChange={e => runSearch(e.target.value)}
            placeholder="Search by name or alias…"
            className="flex-1 bg-surface border border-brand/30 rounded-lg px-3 py-1.5 text-xs text-white placeholder-[#e5e5e5]/25 focus:outline-none focus:border-brand"
          />
          <button onClick={() => { setSearchSlot(null); setSearch(''); setResults([]) }}
            className="text-[#e5e5e5]/30 hover:text-white text-xs">✕</button>
        </div>
      )
      return (
        <div key={slot} className="flex items-center gap-3 py-2.5">
          <div className="w-7 h-7 rounded-full border border-dashed border-brand/30 flex items-center justify-center flex-shrink-0">
            <span className="text-brand/30 text-[10px]">{slot}</span>
          </div>
          <button onClick={() => { setSearchSlot(slot); setSearch(''); setResults([]) }}
            className="text-xs text-brand/60 hover:text-brand border border-brand/20 hover:border-brand/40 px-3 py-1 rounded-lg transition-colors">
            + Invite Player {slot}
          </button>
        </div>
      )
    }

    const slotConfirmed = isMe || (slot === 2 ? p2confirmed : p3confirmed)
    return (
      <div key={slot} className="flex items-center gap-3 py-2.5">
        <div className="w-7 h-7 rounded-full bg-brand/20 border border-brand/30 flex items-center justify-center text-brand text-[10px] font-black flex-shrink-0">
          {isMe ? 'Y' : p ? ((p.first_name?.[0] ?? '') + (p.last_name?.[0] ?? '')).toUpperCase() : '?'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white text-xs font-semibold">
            {isMe ? 'You (organiser)' : p ? `${p.first_name} ${p.last_name}` : '—'}
            {!isMe && p?.alias && <span className="text-brand ml-1">"{p.alias}"</span>}
          </p>
        </div>
        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border flex-shrink-0 ${
          slotConfirmed
            ? 'bg-green-500/15 text-green-400 border-green-500/30'
            : 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
        }`}>
          {slotConfirmed ? 'Confirmed' : 'Pending'}
        </span>
        {!isMe && isCreator && (
          <button onClick={() => clearSlot(slot)} disabled={saving}
            className="text-[#e5e5e5]/25 hover:text-red-400 text-xs transition-colors px-1">✕</button>
        )}
      </div>
    )
  }

  return (
    <div className="mt-3 bg-base border border-line rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-[#e5e5e5]/40 font-bold uppercase tracking-wider">Triples Team</p>
        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${
          allConfirmed ? 'bg-green-500/15 text-green-400 border-green-500/30'
            : filledSlots > 0 ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30'
            : 'bg-[#374056] text-[#e5e5e5]/40 border-line'
        }`}>{overallStatus}</span>
      </div>
      <div className="divide-y divide-line/50">
        {renderSlot(1, record?.player1_id ?? userId)}
        {renderSlot(2, record?.player2_id)}
        {renderSlot(3, record?.player3_id)}
      </div>
      {searchSlot && results.length > 0 && (
        <div className="mt-2 space-y-1">
          {results.map(p => (
            <div key={p.id} className="flex items-center gap-3 bg-surface rounded-lg px-3 py-2.5 border border-line">
              <div className="w-7 h-7 rounded-full bg-brand/10 flex items-center justify-center text-brand text-[10px] font-black flex-shrink-0">
                {((p.first_name?.[0] ?? '') + (p.last_name?.[0] ?? '')).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-semibold">
                  {p.first_name} {p.last_name}
                  {p.alias && <span className="text-brand ml-1">"{p.alias}"</span>}
                </p>
                <p className="text-[#e5e5e5]/35 text-[10px] mt-0.5">
                  {p.teamName ?? 'No team'}
                  {p.state && <span className="ml-2 text-brand/60">{p.state}</span>}
                </p>
              </div>
              <button onClick={() => inviteToSlot(searchSlot, p.id)} disabled={saving}
                className="text-xs bg-brand hover:bg-brand-hover text-black font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0">
                Invite
              </button>
            </div>
          ))}
        </div>
      )}
      {searching && <p className="text-[#e5e5e5]/30 text-xs mt-2">Searching…</p>}
      {searchSlot && search.trim().length >= 2 && !searching && results.length === 0 && (
        <p className="text-[#e5e5e5]/30 text-xs mt-2">No available triples players found</p>
      )}
      {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
      {record && isCreator && (
        <button onClick={disbandTeam} disabled={saving}
          className="mt-3 text-xs text-[#e5e5e5]/25 hover:text-red-400 transition-colors">
          Disband triples team
        </button>
      )}
    </div>
  )
}

// ── Main Page ───────────────────────────────────────────────────────────────
export default function PlayerHub() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [event, setEvent] = useState(null)
  const [profile, setProfile] = useState(null)
  const [registration, setRegistration] = useState(null)
  const [team, setTeam] = useState(null)
  const [cocContent, setCocContent] = useState('')
  const [cocSig, setCocSig] = useState(null) // null = not signed, { signed_at } = signed
  const [testResult, setTestResult] = useState(null)
  const [payment, setPayment] = useState(null)
  const [u18Sub, setU18Sub] = useState(null) // null = not submitted
  const [u18FormContent, setU18FormContent] = useState('')
  const [mediaSub, setMediaSub] = useState(null) // null = not submitted, { consents } = submitted
  const [mediaFormContent, setMediaFormContent] = useState('')

  // Doubles / triples state
  const [doublesRecord, setDoublesRecord] = useState(null)
  const [triplesRecord, setTriplesRecord] = useState(null)
  const [partnerProfileMap, setPartnerProfileMap] = useState({})

  // Team roster
  const [teamRoster, setTeamRoster] = useState([])

  // Side event selection state
  const [selectedSlugs, setSelectedSlugs] = useState(new Set())
  const [dinnerGuests, setDinnerGuests] = useState(0)
  const [dinnerGuestsDraft, setDinnerGuestsDraft] = useState(0)
  const [savingConfirm, setSavingConfirm] = useState(false)
  const [savingExtrasConfirm, setSavingExtrasConfirm] = useState(false)

  // Cancel registration modal
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState(null) // string | { message, captainBlocker: true }

  // Join Team modal
  const [joinOpen, setJoinOpen] = useState(false)

  useEffect(() => {
    if (!authLoading && !user) { navigate('/login'); return }
    if (!user) return
    load()
  }, [authLoading, user, navigate])

  async function load() {
    // 1. Get active event
    const { data: ev } = await supabase
      .from('zltac_events')
      .select('id, name, year, status, side_events, main_fee, processing_fee_pct, dinner_guest_price, reg_open_date')
      .eq('status', 'open')
      .maybeSingle()

    setEvent(ev)
    const eventYear = ev?.year

    if (!eventYear) { setLoading(false); return }

    const [
      { data: prof },
      { data: reg },
      { data: cocVersion, error: cocVersionErr },
      { data: cocSigData },
      { data: testData },
      { data: payData },
      { data: u18Data },
      { data: u18Version, error: under18VersionErr },
      { data: mediaData },
      { data: mediaVersion, error: mediaVersionErr },
    ] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('zltac_registrations')
        .select('*, teams(id, name, captain_id, logo_url, state, status, home_venue, profiles!teams_captain_id_fkey(first_name, last_name))')
        .eq('user_id', user.id).eq('year', eventYear).maybeSingle(),
      supabase.from('code_of_conduct_versions').select('content').eq('is_published', true).maybeSingle(),
      supabase.from('code_of_conduct_signatures').select('signed_at').eq('user_id', user.id).eq('event_year', eventYear).maybeSingle(),
      supabase.from('referee_test_results').select('passed, score').eq('user_id', user.id).maybeSingle(),
      supabase.from('payments').select('amount, status, created_at').eq('user_id', user.id).eq('event_year', eventYear).maybeSingle(),
      supabase.from('under18_submissions').select('submitted_at').eq('user_id', user.id).eq('event_year', eventYear).maybeSingle(),
      supabase.from('under18_form_versions').select('content').eq('is_published', true).maybeSingle(),
      supabase.from('media_release_submissions').select('consents, submitted_at').eq('user_id', user.id).eq('event_year', eventYear).maybeSingle(),
      supabase.from('media_release_versions').select('content').eq('is_published', true).maybeSingle(),
    ])

    if (cocVersionErr) console.error('PlayerHub: code_of_conduct_versions query failed:', cocVersionErr)
    if (under18VersionErr) console.error('PlayerHub: under18_form_versions query failed:', under18VersionErr)
    if (mediaVersionErr) console.error('PlayerHub: media_release_versions query failed:', mediaVersionErr)

    setProfile(prof)
    setRegistration(reg)
    if (reg?.teams) setTeam(reg.teams)
    setCocContent(cocVersion?.content ?? '')
    setCocSig(cocSigData ?? null)
    setTestResult(testData ?? null)
    setPayment(payData ?? null)
    setU18Sub(u18Data ?? null)
    setU18FormContent(u18Version?.content ?? '')
    setMediaSub(mediaData ?? null)
    setMediaFormContent(mediaVersion?.content ?? '')

    if (reg) {
      setSelectedSlugs(new Set(reg.side_events ?? []))
      setDinnerGuests(reg.dinner_guests ?? 0)
      setDinnerGuestsDraft(reg.dinner_guests ?? 0)
    }

    // Fetch team roster if player is on a team
    if (reg?.team_id) {
      const { profiles: rosterProfs } = await apiFetch('/api/profiles', {
        method: 'POST',
        body: JSON.stringify({ teamId: reg.team_id, eventYear }),
      })
      setTeamRoster(rosterProfs ?? [])
    }

    // Fetch doubles/triples records
    const [{ data: doublesData }, { data: triplesData }] = await Promise.all([
      supabase.from('doubles_pairs')
        .select('*')
        .or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`)
        .eq('event_year', eventYear)
        .maybeSingle(),
      supabase.from('triples_teams')
        .select('*')
        .or(`player1_id.eq.${user.id},player2_id.eq.${user.id},player3_id.eq.${user.id}`)
        .eq('event_year', eventYear)
        .maybeSingle(),
    ])
    setDoublesRecord(doublesData ?? null)
    setTriplesRecord(triplesData ?? null)

    // Fetch partner profiles for display
    const partnerIds = new Set()
    if (doublesData) {
      if (doublesData.player1_id !== user.id && doublesData.player1_id) partnerIds.add(doublesData.player1_id)
      if (doublesData.player2_id !== user.id && doublesData.player2_id) partnerIds.add(doublesData.player2_id)
    }
    if (triplesData) {
      ;[triplesData.player1_id, triplesData.player2_id, triplesData.player3_id].forEach(id => {
        if (id && id !== user.id) partnerIds.add(id)
      })
    }
    if (partnerIds.size > 0) {
      const { profiles: partnerProfs } = await apiFetch('/api/profiles', {
        method: 'POST',
        body: JSON.stringify({ ids: [...partnerIds] }),
      })
      setPartnerProfileMap(Object.fromEntries((partnerProfs ?? []).map(p => [p.id, p])))
    }

    setLoading(false)
  }

  function toggleSideEvent(slug) {
    const newSlugs = new Set(selectedSlugs)
    const removing = newSlugs.has(slug)
    removing ? newSlugs.delete(slug) : newSlugs.add(slug)
    setSelectedSlugs(newSlugs)
    if (removing) {
      if (slug === 'doubles' && doublesRecord) {
        apiFetch('/api/player/doubles', {
          method: 'POST',
          body: JSON.stringify({ action: 'delete', id: doublesRecord.id }),
        }).then(() => setDoublesRecord(null))
      }
      if (slug === 'triples' && triplesRecord) {
        apiFetch('/api/player/triples', {
          method: 'POST',
          body: JSON.stringify({ action: 'disband', id: triplesRecord.id }),
        }).then(() => setTriplesRecord(null))
      }
    }
  }

  async function confirmSideEvents() {
    if (!event || !registration) return
    setSavingConfirm(true)
    const { data: updated } = await supabase.from('zltac_registrations')
      .update({ side_events: [...selectedSlugs], has_confirmed_side_events: true })
      .eq('user_id', user.id).eq('year', event.year).select().single()
    if (updated) setRegistration(updated)
    setSavingConfirm(false)
  }

  async function confirmExtras() {
    if (!event || !registration) return
    setSavingExtrasConfirm(true)
    const { data: updated } = await supabase.from('zltac_registrations')
      .update({ dinner_guests: dinnerGuestsDraft, has_confirmed_extras: true })
      .eq('user_id', user.id).eq('year', event.year).select().single()
    if (updated) {
      setRegistration(updated)
      setDinnerGuests(dinnerGuestsDraft)
    }
    setSavingExtrasConfirm(false)
  }

  // ── Cancel registration ───────────────────────────────────────────────────
  async function cancelRegistration() {
    if (!event?.year) return
    setCancelling(true)
    setCancelError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/player/cancel-registration', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ year: event.year }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.status === 409 && body.code === 'CAPTAIN_BLOCKED') {
        setCancelError({ message: body.error || 'You are the team captain. Disband your team first.', captainBlocker: true })
        setCancelling(false)
        return
      }
      if (!res.ok) {
        setCancelError(body.error || 'Failed to cancel registration. Please try again.')
        setCancelling(false)
        return
      }
      navigate('/dashboard')
    } catch (err) {
      console.error('[PlayerHub] cancelRegistration threw:', err)
      setCancelError(err?.message || 'Failed to cancel registration.')
      setCancelling(false)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-base flex flex-col items-center justify-center text-center px-6">
        <h1 className="text-2xl font-black text-white mb-2">No Active Event</h1>
        <p className="text-[#e5e5e5]/40 text-sm mb-6">There is no active ZLTAC event at this time. Check back soon.</p>
        <Link to="/" className="text-brand text-sm font-semibold hover:underline">← Back to home</Link>
      </div>
    )
  }

  const eventYear = event.year
  const firstName = profile?.first_name ?? 'Player'
  const lastName = profile?.last_name ?? ''
  const aliasDisplay = profile?.alias
  const isRegistered = !!registration
  const u18Required = isUnder18(profile?.dob, eventYear)
  const memberId = user.id.split('-')[0].toUpperCase()

  // Side events from event JSONB
  const enabledSideEvents = (event.side_events ?? []).filter(se => se.enabled && se.slug !== 'presentation-dinner')
  const individualSideEvents = enabledSideEvents.filter(se => ['lord-of-the-rings', 'solos'].includes(se.slug))
  const teamSideEvents = enabledSideEvents.filter(se => ['doubles', 'triples'].includes(se.slug))
  const doublesEvent = teamSideEvents.find(se => se.slug === 'doubles')
  const triplesEvent = teamSideEvents.find(se => se.slug === 'triples')

  // Partner confirmation state
  const doublesConfirmed = doublesRecord?.confirmed === true
  const triplesConfirmed = triplesRecord?.confirmed === true // true only when player2_confirmed AND player3_confirmed
  const doublesPartnerId = doublesRecord ? (doublesRecord.player1_id === user.id ? doublesRecord.player2_id : doublesRecord.player1_id) : null
  const doublesPartner = doublesPartnerId ? partnerProfileMap[doublesPartnerId] : null
  const doublesPartnerDisplay = doublesPartner ? (doublesPartner.alias ?? `${doublesPartner.first_name} ${doublesPartner.last_name}`) : null

  // Team state
  const hasTeam = !!registration?.team_id
  const isTeamCaptain = team?.captain_id === user.id

  // Checklist / confirm button states
  const sideEventsConfirmed = registration?.has_confirmed_side_events === true
  const extrasConfirmed = registration?.has_confirmed_extras === true
  const savedSlugs = new Set(registration?.side_events ?? [])
  const sideEventsHasChanges = selectedSlugs.size !== savedSlugs.size || [...selectedSlugs].some(s => !savedSlugs.has(s))
  const sideConfirmDisabled = sideEventsConfirmed && !sideEventsHasChanges
  const extrasHasChanges = dinnerGuestsDraft !== dinnerGuests
  const extrasConfirmDisabled = extrasConfirmed && !extrasHasChanges

  // Cost
  const mainFee = event.main_fee ?? 0
  const dinnerPrice = event.dinner_guest_price ?? 0
  const selectedIndividualEvents = individualSideEvents.filter(se => selectedSlugs.has(se.slug))
  const individualSideTotal = selectedIndividualEvents.reduce((s, se) => s + (se.price ?? 0), 0)
  const teamSideTotal =
    (doublesConfirmed && selectedSlugs.has('doubles') ? (doublesEvent?.price ?? 0) : 0) +
    (triplesConfirmed && selectedSlugs.has('triples') ? (triplesEvent?.price ?? 0) : 0)
  const sideTotal = individualSideTotal + teamSideTotal
  const subtotal = mainFee + sideTotal + dinnerGuests * dinnerPrice
  const processingFee = Math.round(subtotal * (event.processing_fee_pct ?? 0) / 100)
  const total = subtotal + processingFee
  const amountPaid = payment?.amount ?? 0
  const balanceOwing = Math.max(0, total - amountPaid)
  const paymentStatus = payment?.status ?? (isRegistered ? 'unpaid' : null)

  const PAYMENT_STYLES = {
    unpaid: 'bg-red-500/15 text-red-400 border-red-500/30',
    partial: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    paid: 'bg-brand/15 text-brand border-brand/30',
  }

  return (
    <div className="min-h-screen bg-base text-white">

      {/* Cancel registration confirmation modal */}
      {cancelOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4">
          <div className="bg-surface border border-line rounded-2xl p-6 max-w-sm w-full">
            <p className="text-white font-bold mb-2">Cancel your registration?</p>
            <p className="text-[#e5e5e5]/50 text-sm mb-5">
              This permanently deletes your registration for <span className="text-white font-semibold">{event?.name ?? `ZLTAC ${eventYear}`}</span>.
              You'll lose your team membership and side event selections. Continue?
            </p>
            {cancelError && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 mb-4">
                <p className="text-red-400 text-xs">
                  {typeof cancelError === 'string' ? cancelError : cancelError.message}
                </p>
                {typeof cancelError === 'object' && cancelError.captainBlocker && (
                  <Link to="/captain-hub" className="text-brand text-xs font-semibold hover:underline mt-1 inline-block">
                    Go to Team Hub →
                  </Link>
                )}
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={cancelRegistration}
                disabled={cancelling || (typeof cancelError === 'object' && cancelError?.captainBlocker)}
                className="bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold px-5 py-2 rounded-xl text-sm transition-colors"
              >
                {cancelling ? 'Cancelling…' : 'Cancel registration'}
              </button>
              <button
                onClick={() => { setCancelOpen(false); setCancelError(null) }}
                className="border border-line text-[#e5e5e5]/60 hover:text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors"
              >
                Keep registration
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Join Team modal */}
      <JoinTeamModal open={joinOpen} onClose={() => setJoinOpen(false)} />

      <div className="max-w-3xl mx-auto px-6 py-10">

        {/* Back */}
        <Link to={`/events/${eventYear}`} className="text-[#e5e5e5]/40 hover:text-brand text-xs transition-colors mb-5 inline-block">
          ← {event.name}
        </Link>

        {/* Welcome */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex-shrink-0">
            <DashboardGridIcon />
          </div>
          <div>
            <h1 className="text-3xl md:text-4xl font-black text-white leading-tight">Welcome to Player Hub</h1>
            <p className="text-[#e5e5e5]/40 text-sm mt-1">
              Your hub for {event.name} registration, team status, and event-day prep.
            </p>
          </div>
        </div>

        {/* Header */}
        <div className="mb-8">
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-1">ZLTAC {eventYear} · Player Hub</p>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <h1 className="text-3xl font-black text-white">
                {firstName} {lastName}
                {aliasDisplay && <span className="text-brand ml-2 text-2xl">"{aliasDisplay}"</span>}
              </h1>
              <p className="text-[#e5e5e5]/40 text-xs mt-1">
                ALSA ID: {memberId} · {team ? team.name : isRegistered ? 'Side events only' : 'Not yet registered'}
              </p>
            </div>
            {isRegistered && (
              <span className={`self-start sm:self-auto text-xs font-bold px-3 py-1.5 rounded-full border ${
                registration.status === 'confirmed' ? 'bg-brand/15 text-brand border-brand/30' : 'bg-[#374056] text-[#e5e5e5]/60 border-line'
              }`}>
                {registration.status === 'confirmed' ? '✓ Confirmed' : '⏳ Pending'}
              </span>
            )}
          </div>
        </div>

        {/* ── Doubles partner invitation alert ── */}
        {doublesRecord && doublesRecord.player2_id === user.id && !doublesRecord.confirmed && (() => {
          const inviter = partnerProfileMap[doublesRecord.player1_id]
          return (
            <div className="bg-surface border border-brand/30 rounded-2xl p-5 mb-5">
              <p className="text-white font-bold mb-1">Doubles Partner Invitation</p>
              <p className="text-[#e5e5e5]/60 text-sm mb-4">
                <span className="text-white font-semibold">
                  {inviter ? `${inviter.first_name} ${inviter.last_name}` : 'A player'}
                </span>
                {inviter?.alias && <span className="text-brand"> ({inviter.alias})</span>}
                {' '}has invited you to be their Doubles partner. Do you accept?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    const { record } = await apiFetch('/api/player/doubles', {
                      method: 'POST',
                      body: JSON.stringify({ action: 'confirm', id: doublesRecord.id }),
                    })
                    if (record) setDoublesRecord(record)
                  }}
                  className="bg-brand hover:bg-brand-hover text-black font-bold px-4 py-2 rounded-xl text-sm transition-all">
                  Accept
                </button>
                <button
                  onClick={async () => {
                    await apiFetch('/api/player/doubles', {
                      method: 'POST',
                      body: JSON.stringify({ action: 'delete', id: doublesRecord.id }),
                    })
                    setDoublesRecord(null)
                  }}
                  className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 font-bold px-4 py-2 rounded-xl text-sm transition-colors">
                  Decline
                </button>
              </div>
            </div>
          )
        })()}

        {/* ── Triples team invitation alert ── */}
        {triplesRecord && triplesRecord.player1_id !== user.id && !triplesRecord.confirmed && (() => {
          const mySlot = triplesRecord.player2_id === user.id ? 2 : 3
          const alreadyAccepted = triplesRecord[`player${mySlot}_confirmed`] === true
          if (alreadyAccepted) return null
          const inviter = partnerProfileMap[triplesRecord.player1_id]
          return (
            <div className="bg-surface border border-brand/30 rounded-2xl p-5 mb-5">
              <p className="text-white font-bold mb-1">Triples Team Invitation</p>
              <p className="text-[#e5e5e5]/60 text-sm mb-4">
                <span className="text-white font-semibold">
                  {inviter ? `${inviter.first_name} ${inviter.last_name}` : 'A player'}
                </span>
                {inviter?.alias && <span className="text-brand"> ({inviter.alias})</span>}
                {' '}has invited you to join their Triples team. Do you accept?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    const { record } = await apiFetch('/api/player/triples', {
                      method: 'POST',
                      body: JSON.stringify({ action: 'confirm', id: triplesRecord.id, mySlot }),
                    })
                    if (record) setTriplesRecord(record)
                  }}
                  className="bg-brand hover:bg-brand-hover text-black font-bold px-4 py-2 rounded-xl text-sm transition-all">
                  Accept
                </button>
                <button
                  onClick={async () => {
                    await apiFetch('/api/player/triples', {
                      method: 'POST',
                      body: JSON.stringify({ action: 'disband', id: triplesRecord.id }),
                    })
                    setTriplesRecord(null)
                  }}
                  className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 font-bold px-4 py-2 rounded-xl text-sm transition-colors">
                  Decline
                </button>
              </div>
            </div>
          )
        })()}

        {!isRegistered && (
          <div className="bg-surface border border-line rounded-2xl p-6 mb-6 text-center">
            <p className="text-[#e5e5e5]/60 text-sm mb-3">You haven't registered for ZLTAC {eventYear} yet.</p>
            <Link to={`/events/${eventYear}/player-register`} className="inline-block bg-brand hover:bg-brand-hover text-black font-bold px-6 py-2.5 rounded-xl text-sm transition-all">
              Register Now →
            </Link>
          </div>
        )}

        {/* Personalized progress timeline (registered only) */}
        {isRegistered && (
          <PlayerHubProgress
            eventName={event.name}
            hasTeam={hasTeam}
            cocSigned={!!cocSig}
            refPassed={!!testResult?.passed}
            mediaSubmitted={!!mediaSub}
            paid={paymentStatus === 'paid'}
            sideEventsConfirmed={sideEventsConfirmed}
            extrasConfirmed={extrasConfirmed}
            u18Required={u18Required}
            u18Submitted={!!u18Sub}
          />
        )}

        <div className="space-y-5">

          {/* ── Team CTA (registered, not yet on a team) ── */}
          {isRegistered && !hasTeam && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="bg-surface border border-line rounded-2xl p-6 text-center flex flex-col" style={{ borderTopColor: '#00FF41', borderTopWidth: '3px' }}>
                <h3 className="text-white font-black text-lg mb-2">Create Team</h3>
                <p className="text-[#a0a0a0] text-sm leading-relaxed flex-1 mb-5">
                  Start a new team and share your invite code with players.
                </p>
                <Link
                  to={`/events/${eventYear}/captain-register`}
                  className="block bg-brand hover:bg-brand-hover text-black font-bold py-2.5 px-4 rounded-xl text-sm text-center transition-all hover:shadow-[0_0_20px_rgba(0,255,65,0.4)]"
                >
                  Create Team
                </Link>
              </div>
              <div className="bg-surface border border-line rounded-2xl p-6 text-center flex flex-col" style={{ borderTopColor: '#00FF41', borderTopWidth: '3px' }}>
                <h3 className="text-white font-black text-lg mb-2">Join Team with Code</h3>
                <p className="text-[#a0a0a0] text-sm leading-relaxed flex-1 mb-5">
                  Got an invite code from a captain? Enter it to join their team.
                </p>
                <button
                  onClick={() => setJoinOpen(true)}
                  className="block w-full bg-brand hover:bg-brand-hover text-black font-bold py-2.5 px-4 rounded-xl text-sm text-center transition-all hover:shadow-[0_0_20px_rgba(0,255,65,0.4)]"
                >
                  Enter Invite Code
                </button>
              </div>
            </div>
          )}

          {/* ── Registration Checklist ── */}
          <div className="bg-surface border border-line rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-line">
              <h2 className="text-white font-bold">Registration Checklist</h2>
              <p className="text-[#e5e5e5]/40 text-xs mt-0.5">Complete all items to confirm your registration.</p>
            </div>

            <ChecklistItem
              status={isRegistered ? 'done' : 'error'}
              label={isRegistered ? 'Player registration — complete' : 'Player registration — not yet registered'}
            >
              {!isRegistered && (
                <Link to={`/events/${eventYear}/player-register`} className="text-brand text-xs hover:underline">
                  Register now →
                </Link>
              )}
            </ChecklistItem>

            <ChecklistItem
              status={!isRegistered ? 'pending' : cocSig ? 'done' : 'error'}
              label={cocSig ? `Code of Conduct — signed ${formatDate(cocSig.signed_at)}` : 'Code of Conduct — not yet signed'}
            >
              {isRegistered && !cocSig && (
                <CoCPanel
                  userId={user.id}
                  eventYear={eventYear}
                  content={cocContent}
                  onSigned={() => setCocSig({ signed_at: new Date().toISOString() })}
                />
              )}
            </ChecklistItem>

            <ChecklistItem
              status={!isRegistered ? 'pending' : testResult?.passed ? 'done' : testResult ? 'error' : 'error'}
              label={
                testResult?.passed
                  ? `Referee Test — Passed (${testResult.score}%)`
                  : testResult
                    ? 'Referee Test — Failed — retake required'
                    : 'Referee Test — Not yet taken'
              }
            >
              {isRegistered && (
                <div>
                  {testResult?.passed && (
                    <p className="text-yellow-400/80 text-xs mb-2">
                      You have already passed the referee test ({testResult.score}%). Retaking will replace your current score.
                    </p>
                  )}
                  <Link to="/referee-test" className="text-brand text-xs hover:underline">
                    {testResult?.passed ? 'Retake Test →' : testResult ? 'Retake test →' : 'Take the Referee Test →'}
                  </Link>
                </div>
              )}
            </ChecklistItem>

            <ChecklistItem
              status={!isRegistered ? 'pending' : mediaSub ? 'done' : 'error'}
              label={
                mediaSub
                  ? `Media Release — ${mediaSub.consents ? 'Consented' : 'Declined'}`
                  : 'Media Release — not yet submitted'
              }
            >
              {isRegistered && !mediaSub && (
                <MediaReleasePanel
                  userId={user.id}
                  eventYear={eventYear}
                  formContent={mediaFormContent}
                  onSubmitted={c => setMediaSub({ consents: c, submitted_at: new Date().toISOString() })}
                />
              )}
            </ChecklistItem>

            <ChecklistItem
              status={!isRegistered ? 'pending' : sideEventsConfirmed ? 'done' : 'error'}
              label={!isRegistered ? 'Side events — pending registration' : sideEventsConfirmed ? 'Side events — confirmed' : 'Side events — not yet confirmed'}
            >
              {isRegistered && !sideEventsConfirmed && (
                <a href="#side-events" className="text-brand text-xs hover:underline">
                  Select side events below →
                </a>
              )}
            </ChecklistItem>

            <ChecklistItem
              status={!isRegistered ? 'pending' : extrasConfirmed ? 'done' : 'error'}
              label={!isRegistered ? 'Extras — pending registration' : extrasConfirmed ? 'Extras — confirmed' : 'Extras — not yet confirmed'}
            >
              {isRegistered && !extrasConfirmed && (
                <a href="#extras" className="text-brand text-xs hover:underline">
                  Confirm extras below →
                </a>
              )}
            </ChecklistItem>

            {u18Required && (
              <ChecklistItem
                status={!isRegistered ? 'pending' : u18Sub ? 'done' : 'error'}
                label={u18Sub ? `Under 18 Parental Consent — submitted ${formatDate(u18Sub.submitted_at)}` : 'Under 18 Parental Consent — not yet submitted'}
              >
                {isRegistered && !u18Sub && (
                  <Under18Panel
                    userId={user.id}
                    eventYear={eventYear}
                    playerName={`${firstName} ${lastName}`}
                    formContent={u18FormContent}
                    onSubmitted={() => setU18Sub({ submitted_at: new Date().toISOString() })}
                  />
                )}
              </ChecklistItem>
            )}

            <ChecklistItem
              status={!isRegistered || !paymentStatus ? 'pending' : paymentStatus === 'paid' ? 'done' : 'error'}
              label="Payment — Payment Info Released Soon"
            >
              <p className="text-[#e5e5e5]/60 text-sm">
                Payment details and instructions will be released closer to the event.
              </p>
            </ChecklistItem>
          </div>

          {/* ── My Team ── */}
          {isRegistered && hasTeam && team && (
            <div className="bg-surface border border-line rounded-2xl overflow-hidden">
              {/* Pending banner */}
              {team.status === 'pending' && (
                <div className="bg-yellow-500/10 border-b border-yellow-500/20 px-5 py-3">
                  <p className="text-yellow-400 text-xs font-semibold">Your team is awaiting ZLTAC committee approval. You can still complete your registration while waiting.</p>
                </div>
              )}
              {/* Team header */}
              <div className="p-5 flex items-center gap-4">
                {team.logo_url ? (
                  <img src={team.logo_url} alt={team.name} className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
                ) : (
                  <div className="w-14 h-14 rounded-xl bg-brand/20 border border-brand/30 flex items-center justify-center flex-shrink-0">
                    <span className="text-brand font-black text-lg">{team.name?.[0] ?? '?'}</span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-0.5">
                    <h2 className="text-white font-black text-lg leading-tight">{team.name}</h2>
                    {team.status === 'approved' && (
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded border bg-brand/15 text-brand border-brand/30">Approved</span>
                    )}
                    {team.status === 'pending' && (
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded border bg-yellow-500/15 text-yellow-400 border-yellow-500/30">Pending</span>
                    )}
                  </div>
                  {team.state && <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-brand/10 text-brand/80 border border-brand/20">{team.state}</span>}
                  {team.home_venue && <p className="text-[#e5e5e5]/40 text-xs mt-1">{team.home_venue}</p>}
                  <p className="text-[#e5e5e5]/40 text-xs mt-0.5">
                    {isTeamCaptain ? '👑 You are the captain' : `Captain: ${team.profiles ? `${team.profiles.first_name} ${team.profiles.last_name}` : '—'}`}
                  </p>
                </div>
              </div>
              {/* Roster */}
              {teamRoster.length > 0 && (
                <div className="border-t border-line px-5 py-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#e5e5e5]/30 mb-3">Team roster — {teamRoster.length} player{teamRoster.length !== 1 ? 's' : ''}</p>
                  <div className="space-y-2">
                    {teamRoster.map(p => (
                      <div key={p.id} className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-brand/20 border border-brand/30 flex items-center justify-center flex-shrink-0">
                          <span className="text-brand font-black text-[10px]">
                            {((p.first_name?.[0] ?? '') + (p.last_name?.[0] ?? '')).toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-semibold leading-tight">
                            {p.first_name} {p.last_name}
                            {p.alias && <span className="text-brand ml-1.5 font-normal">"{p.alias}"</span>}
                            {p.id === user.id && <span className="text-[#e5e5e5]/30 ml-1.5 text-xs">(You)</span>}
                            {p.id === team.captain_id && <span className="ml-1.5 text-xs">👑</span>}
                          </p>
                          {p.state && <p className="text-[#e5e5e5]/35 text-[10px]">{p.state}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Side Events ── */}
          {isRegistered && (
            <div className="bg-surface border border-line rounded-2xl p-5" id="side-events">
              <h2 className="text-white font-bold mb-1">Side Events</h2>
              <p className="text-[#e5e5e5]/40 text-xs mb-5">Register for individual and team side events for ZLTAC {eventYear}</p>

              {/* Individual entries */}
              {individualSideEvents.length > 0 && (
                <div className="mb-6">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#e5e5e5]/30 mb-3">Individual entries</p>
                  <div className="space-y-3">
                    {individualSideEvents.map(se => {
                      const active = selectedSlugs.has(se.slug)
                      return (
                        <div key={se.slug} className={`rounded-xl border p-4 flex items-center justify-between gap-4 transition-all ${active ? 'border-brand/40 bg-brand/5' : 'border-line bg-base'}`}>
                          <div className="flex-1 min-w-0">
                            <p className="text-white font-semibold text-sm">{se.name}</p>
                            {se.description && <p className="text-[#e5e5e5]/40 text-xs mt-0.5">{se.description}</p>}
                            <p className="text-brand font-black text-sm mt-1">{se.price > 0 ? dollars(se.price) : 'Included'}</p>
                          </div>
                          <button
                            onClick={() => toggleSideEvent(se.slug)}
                            className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-bold transition-all ${active ? 'bg-brand/15 border border-brand/40 text-brand' : 'bg-base border border-line text-[#e5e5e5]/50 hover:border-brand/30 hover:text-white'}`}
                          >
                            {active ? 'Selected ✓' : 'Select'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Team entries */}
              {individualSideEvents.length > 0 && teamSideEvents.length > 0 && <div className="border-t border-line my-5" />}
              {teamSideEvents.length > 0 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#e5e5e5]/30 mb-3">Team entries — partner required</p>
                  <div className="space-y-3">
                    {teamSideEvents.map(se => {
                      const active = selectedSlugs.has(se.slug)
                      const isDoubles = se.slug === 'doubles'
                      return (
                        <div key={se.slug} className={`rounded-xl border transition-all ${active ? 'border-brand/40 bg-brand/5' : 'border-line bg-base'}`}>
                          <div className="p-4 flex items-center justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <p className="text-white font-semibold text-sm">{se.name}</p>
                              {se.description && <p className="text-[#e5e5e5]/40 text-xs mt-0.5">{se.description}</p>}
                              <p className="text-brand font-black text-sm mt-1">{se.price > 0 ? dollars(se.price) : 'Included'}</p>
                            </div>
                            <button
                              onClick={() => toggleSideEvent(se.slug)}
                              className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-bold transition-all ${active ? 'bg-brand/15 border border-brand/40 text-brand' : 'bg-base border border-line text-[#e5e5e5]/50 hover:border-brand/30 hover:text-white'}`}
                            >
                              {active ? 'Selected ✓' : 'Select'}
                            </button>
                          </div>
                          {active && (
                            <div className="px-4 pb-4">
                              {isDoubles ? (
                                <DoublesSelector
                                  userId={user.id}
                                  eventYear={eventYear}
                                  record={doublesRecord}
                                  partnerProfileMap={partnerProfileMap}
                                  onUpdate={(rec, newProfs) => {
                                    setDoublesRecord(rec)
                                    if (newProfs) setPartnerProfileMap(prev => ({ ...prev, ...newProfs }))
                                  }}
                                />
                              ) : (
                                <TriplesSelector
                                  userId={user.id}
                                  eventYear={eventYear}
                                  record={triplesRecord}
                                  partnerProfileMap={partnerProfileMap}
                                  onUpdate={(rec, newProfs) => {
                                    setTriplesRecord(rec)
                                    if (newProfs) setPartnerProfileMap(prev => ({ ...prev, ...newProfs }))
                                  }}
                                />
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Confirm side events button */}
              <div className="mt-5 border-t border-line pt-5">
                <button
                  onClick={confirmSideEvents}
                  disabled={sideConfirmDisabled || savingConfirm}
                  className={`w-full font-bold py-2.5 rounded-xl text-sm transition-all ${sideConfirmDisabled ? 'bg-[#2D2D2D] border border-line text-[#e5e5e5]/30 cursor-default' : 'bg-brand hover:bg-brand-hover text-black'}`}
                >
                  {savingConfirm ? 'Saving…' : sideConfirmDisabled ? 'Selections confirmed ✓' : sideEventsConfirmed ? 'Update Side Event Selections' : 'Confirm Side Event Selections'}
                </button>
              </div>
            </div>
          )}

          {/* ── Extras ── */}
          {isRegistered && (
            <div className="bg-surface border border-line rounded-2xl p-5" id="extras">
              <h2 className="text-white font-bold mb-1">Extras</h2>
              <p className="text-[#e5e5e5]/40 text-xs mb-5">Optional additions to your ZLTAC experience</p>

              {/* Presentation Dinner Guests */}
              <div className="rounded-xl border border-line bg-base p-4 mb-5">
                <p className="text-white font-semibold text-sm mb-0.5">Presentation Dinner Guests</p>
                <p className="text-[#e5e5e5]/40 text-xs mb-1">All registered players are included in the presentation dinner. Add extra guests below.</p>
                {dinnerPrice > 0 && <p className="text-brand font-black text-sm mb-3">{dollars(dinnerPrice)} per guest</p>}
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setDinnerGuestsDraft(d => Math.max(0, d - 1))} className="w-8 h-8 rounded-lg bg-line hover:bg-[#374056] text-white font-bold transition-colors">−</button>
                  <span className="text-white font-bold w-6 text-center">{dinnerGuestsDraft}</span>
                  <button type="button" onClick={() => setDinnerGuestsDraft(d => Math.min(10, d + 1))} className="w-8 h-8 rounded-lg bg-line hover:bg-[#374056] text-white font-bold transition-colors">+</button>
                  {dinnerGuestsDraft > 0 && dinnerPrice > 0 && (
                    <span className="text-[#e5e5e5]/40 text-xs ml-1">{dinnerGuestsDraft} × {dollars(dinnerPrice)} = {dollars(dinnerGuestsDraft * dinnerPrice)}</span>
                  )}
                </div>
              </div>

              {/* Confirm extras button */}
              <button
                onClick={confirmExtras}
                disabled={extrasConfirmDisabled || savingExtrasConfirm}
                className={`w-full font-bold py-2.5 rounded-xl text-sm transition-all ${extrasConfirmDisabled ? 'bg-[#2D2D2D] border border-line text-[#e5e5e5]/30 cursor-default' : 'bg-brand hover:bg-brand-hover text-black'}`}
              >
                {savingExtrasConfirm ? 'Saving…' : extrasConfirmDisabled ? 'Extras confirmed ✓' : extrasConfirmed ? 'Update Extras' : 'Confirm Extras'}
              </button>
            </div>
          )}

          {/* ── Cost Breakdown ── */}
          {isRegistered && (
            <div className="bg-surface border border-line rounded-2xl p-5">
              <h2 className="text-white font-bold mb-4">Cost Breakdown</h2>
              <div className="space-y-2 mb-3">
                <div className="flex justify-between text-sm">
                  <span className="text-[#e5e5e5]/60">Player registration fee</span>
                  <span className="text-[#e5e5e5]/60">{mainFee > 0 ? dollars(mainFee) : 'TBC'}</span>
                </div>
                {selectedIndividualEvents.map(se => (
                  <div key={se.slug} className="flex justify-between text-sm">
                    <span className="text-[#e5e5e5]/60">{se.name}</span>
                    <span className="text-[#e5e5e5]/60">{dollars(se.price)}</span>
                  </div>
                ))}
                {doublesConfirmed && selectedSlugs.has('doubles') && doublesEvent && (
                  <div className="flex justify-between text-sm">
                    <span className="text-[#e5e5e5]/60">Doubles{doublesPartnerDisplay ? ` (with ${doublesPartnerDisplay})` : ''}</span>
                    <span className="text-[#e5e5e5]/60">{dollars(doublesEvent.price)}</span>
                  </div>
                )}
                {triplesConfirmed && selectedSlugs.has('triples') && triplesEvent && (
                  <div className="flex justify-between text-sm">
                    <span className="text-[#e5e5e5]/60">Triples</span>
                    <span className="text-[#e5e5e5]/60">{dollars(triplesEvent.price)}</span>
                  </div>
                )}
                {dinnerGuests > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-[#e5e5e5]/60">{dinnerGuests} dinner guest{dinnerGuests > 1 ? 's' : ''} × {dollars(dinnerPrice)}</span>
                    <span className="text-[#e5e5e5]/60">{dollars(dinnerGuests * dinnerPrice)}</span>
                  </div>
                )}
                {processingFee > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-[#e5e5e5]/40">Processing fee ({event.processing_fee_pct}%)</span>
                    <span className="text-[#e5e5e5]/40">{dollars(processingFee)}</span>
                  </div>
                )}
              </div>
              <div className="border-t border-line pt-3 space-y-1.5 mb-4">
                <div className="flex justify-between">
                  <span className="text-white font-bold text-sm">Total</span>
                  <span className="text-brand font-black text-lg">{dollars(total)}</span>
                </div>
                {amountPaid > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-[#e5e5e5]/40">Amount paid</span>
                    <span className="text-[#e5e5e5]/40">{dollars(amountPaid)}</span>
                  </div>
                )}
                {balanceOwing > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-[#e5e5e5]/60">Balance owing</span>
                    <span className="text-red-400 font-semibold">{dollars(balanceOwing)}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                {paymentStatus && (
                  <span className={`text-xs px-2.5 py-1 rounded-full border font-bold uppercase tracking-wide ${PAYMENT_STYLES[paymentStatus] ?? ''}`}>
                    {paymentStatus === 'paid' ? 'Paid in Full' : paymentStatus}
                  </span>
                )}
                <button disabled className="ml-auto bg-brand/10 border border-brand/20 text-brand/50 text-xs font-bold px-4 py-1.5 rounded-lg cursor-not-allowed">
                  Pay Now (coming soon)
                </button>
              </div>
            </div>
          )}

        </div>

        {/* ── Cancel registration ── */}
        {isRegistered && (
          <div className="mt-10 pt-6 border-t border-line text-center">
            <button
              onClick={() => { setCancelError(null); setCancelOpen(true) }}
              className="text-red-400/40 hover:text-red-400 text-xs transition-colors"
            >
              Cancel my registration for {event?.name ?? `ZLTAC ${eventYear}`}
            </button>
          </div>
        )}
      </div>
      <Footer />
    </div>
  )
}
