import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/apiFetch.js'
import { recomputeOwing } from '../lib/recomputeOwing'
import { formatDate } from '../lib/dateFormat'
import { formatInEventTz } from '../lib/eventTimezone'
import Footer from '../components/Footer'
import PlayerHubProgress from '../components/PlayerHubProgress'
import CommitteeBadge from '../components/CommitteeBadge'
import LockedRegistrationBanner from '../components/LockedRegistrationBanner'
import LockedNotice from '../components/LockedNotice'
import VolunteerSection from '../components/VolunteerSection'
import CollapsibleSection from '../components/CollapsibleSection'
import EventLifecycleCountdown from '../components/EventLifecycleCountdown'
import { eventPhase } from '../lib/eventPhase'
import { arePaymentsOpen } from '../lib/payments'
import { isRefTestRequired, isCocRequired, isPaymentRequired } from '../lib/eventSettings'
import { DashboardGridIcon } from '../components/icons.jsx'
import { ClipboardCheck, Trophy, Sparkles, HeartHandshake, CreditCard } from 'lucide-react'

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

const STAT_TONES = {
  neutral: 'bg-base border-line text-white',
  red: 'bg-red-500/10 border-red-500/30 text-red-400',
  green: 'bg-brand/10 border-brand/30 text-brand',
  blue: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
}

function Stat({ label, value, tone = 'neutral', prefix = '' }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${STAT_TONES[tone] ?? STAT_TONES.neutral}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-60">{label}</p>
      <p className="font-black text-sm mt-0.5">{prefix}{value}</p>
    </div>
  )
}

function Field({ label, value, className = '' }) {
  return (
    <div className={className}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-[#e5e5e5]/40">{label}</p>
      <p className="text-white font-mono text-sm mt-0.5 break-all select-all">{value}</p>
    </div>
  )
}

function CopyableReference({ value }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(err => console.error('[CopyableReference] clipboard write failed:', err))
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="w-full text-left bg-brand/5 border border-brand/30 hover:border-brand/60 rounded-xl px-4 py-3 transition-colors group"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-brand font-mono font-black text-base tracking-wide select-all">{value}</span>
        <span className={`text-[10px] font-bold uppercase tracking-wider transition-colors ${copied ? 'text-brand' : 'text-[#e5e5e5]/40 group-hover:text-brand'}`}>
          {copied ? 'Copied!' : 'Click to copy'}
        </span>
      </div>
    </button>
  )
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

// ── Helpers shared by legal-doc panels ─────────────────────────────────────
const LEGAL_BUCKET = 'legal-documents'
function legalDocUrl(filePath) {
  if (!filePath) return null
  return supabase.storage.from(LEGAL_BUCKET).getPublicUrl(filePath).data.publicUrl
}
const DOC_LABELS = {
  code_of_conduct: 'Code of Conduct',
  media_release:   'Media Release',
  under_18_form:   'Under 18 Parental Consent Form',
}

function PdfLink({ doc, label = 'View PDF' }) {
  if (!doc?.file_path) return null
  return (
    <a
      href={legalDocUrl(doc.file_path)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs text-brand hover:text-brand-hover font-medium"
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      {label} ↗
    </a>
  )
}

// ── CoC Panel ───────────────────────────────────────────────────────────────
function CoCPanel({ userId, eventYear, activeDoc, stale, onAccepted }) {
  const [agreed, setAgreed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!activeDoc) {
    return (
      <p className="text-[#e5e5e5]/50 italic text-xs">
        Code of Conduct is not yet available — contact the committee.
      </p>
    )
  }

  async function sign() {
    if (!agreed) return
    setSaving(true)
    const { error: insErr } = await supabase.from('legal_acceptances').insert({
      user_id: userId,
      document_id: activeDoc.id,
      event_year: eventYear,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    })
    setSaving(false)
    if (insErr) { setError(insErr.message); return }
    onAccepted()
  }

  return (
    <div className="space-y-3">
      {stale && (
        <div className="bg-amber-500/5 border border-amber-500/30 text-amber-400/80 rounded-lg px-3 py-2 text-xs">
          The Code of Conduct has been updated. Please review and re-accept.
        </div>
      )}
      <div className="bg-base border border-line rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-[#e5e5e5]/60">
          <p className="font-bold text-white">{activeDoc.original_filename}</p>
          <p className="mt-0.5">
            v{activeDoc.version} · Effective {formatDate(activeDoc.effective_date)}
          </p>
        </div>
        <PdfLink doc={activeDoc} />
      </div>
      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5 accent-[#00FF41]" />
        <span className="text-[#e5e5e5]/70 text-xs leading-relaxed">
          I have read and agree to the {DOC_LABELS.code_of_conduct} dated {formatDate(activeDoc.effective_date)}.
        </span>
      </label>
      {error && <p className="text-red-400 text-xs">{error}</p>}
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
// New model: player downloads the PDF, fills it out offline, emails it to
// committee, and clicks "I've emailed the form" to flag the submission.
// Committee then reviews and changes status to approved / rejected via the
// AdminUnder18Approvals page.
function Under18Panel({ userId, eventYear, activeDoc, approval, onSubmitted }) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function flagSubmitted() {
    setSaving(true)
    setError('')
    const nowIso = new Date().toISOString()
    const { error: upErr } = await supabase.from('under_18_approvals').upsert({
      user_id: userId,
      event_year: eventYear,
      status: 'pending',
      submitted_at: nowIso,
    }, { onConflict: 'user_id,event_year' })
    setSaving(false)
    if (upErr) { setError(upErr.message); return }
    onSubmitted()
  }

  const status = approval?.status ?? null
  const statusMeta = {
    pending:  { label: 'Pending committee review', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
    approved: { label: 'Approved',                 cls: 'bg-brand/15 text-brand border-brand/30' },
    rejected: { label: 'Rejected',                 cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
  }
  const meta = statusMeta[status]

  return (
    <div className="space-y-3">
      {activeDoc ? (
        <div className="bg-base border border-line rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-[#e5e5e5]/60">
            <p className="font-bold text-white">{activeDoc.original_filename}</p>
            <p className="mt-0.5">
              v{activeDoc.version} · Effective {formatDate(activeDoc.effective_date)}
            </p>
          </div>
          <PdfLink doc={activeDoc} label="Download form" />
        </div>
      ) : (
        <p className="text-[#e5e5e5]/50 italic text-xs">
          Under 18 form is not yet available — contact the committee.
        </p>
      )}

      <div className="text-xs text-[#e5e5e5]/55 leading-relaxed bg-base border border-line rounded-xl px-4 py-3">
        <p className="font-bold text-white/80 mb-1">How to submit</p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>Download the form above and have your parent/guardian complete it.</li>
          <li>Email the signed form to the ALSA committee.</li>
          <li>Click <em>I&rsquo;ve emailed the form</em> below to flag your submission for review.</li>
        </ol>
      </div>

      {meta && (
        <div className="flex items-center gap-2 text-xs">
          <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${meta.cls}`}>
            {meta.label}
          </span>
          {approval?.submitted_at && (
            <span className="text-[#e5e5e5]/40">flagged {formatDate(approval.submitted_at)}</span>
          )}
          {approval?.approved_at && status === 'approved' && (
            <span className="text-[#e5e5e5]/40">approved {formatDate(approval.approved_at)}</span>
          )}
        </div>
      )}

      {error && <p className="text-red-400 text-xs">{error}</p>}

      {status !== 'approved' && (
        <button
          onClick={flagSubmitted}
          disabled={saving}
          className="bg-brand hover:bg-brand-hover disabled:opacity-40 text-black font-bold px-5 py-2 rounded-lg text-xs transition-colors"
        >
          {saving ? 'Saving…' : status ? 'Re-flag — I\'ve emailed the form again' : 'I\'ve emailed the form'}
        </button>
      )}
    </div>
  )
}

// ── Media Release Panel ─────────────────────────────────────────────────────
function MediaReleasePanel({ userId, eventYear, activeDoc, stale, onAccepted }) {
  const [agreed, setAgreed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  if (!activeDoc) {
    return (
      <p className="text-[#e5e5e5]/50 italic text-xs">
        Media Release is not yet available — contact the committee.
      </p>
    )
  }

  async function submit() {
    if (!agreed) return
    setSaving(true)
    const { error: insErr } = await supabase.from('legal_acceptances').insert({
      user_id: userId,
      document_id: activeDoc.id,
      event_year: eventYear,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    })
    setSaving(false)
    if (insErr) { setError(insErr.message); return }
    onAccepted()
  }

  return (
    <div className="space-y-3">
      {stale && (
        <div className="bg-amber-500/5 border border-amber-500/30 text-amber-400/80 rounded-lg px-3 py-2 text-xs">
          The Media Release has been updated. Please review and re-accept.
        </div>
      )}
      <div className="bg-base border border-line rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-[#e5e5e5]/60">
          <p className="font-bold text-white">{activeDoc.original_filename}</p>
          <p className="mt-0.5">
            v{activeDoc.version} · Effective {formatDate(activeDoc.effective_date)}
          </p>
        </div>
        <PdfLink doc={activeDoc} />
      </div>
      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5 accent-[#00FF41]" />
        <span className="text-[#e5e5e5]/70 text-xs leading-relaxed">
          I have read and agree to the {DOC_LABELS.media_release} dated {formatDate(activeDoc.effective_date)}.
        </span>
      </label>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <button
        onClick={submit}
        disabled={!agreed || saving}
        className="bg-brand hover:bg-brand-hover disabled:opacity-40 text-black font-bold px-5 py-2 rounded-lg text-xs transition-colors"
      >
        {saving ? 'Submitting…' : 'Submit Media Release'}
      </button>
    </div>
  )
}

// ── Doubles Partner Selector ─────────────────────────────────────────────────
function DoublesSelector({ userId, eventYear, record, partnerProfileMap, onUpdate, locked }) {
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
      const { results: res } = await apiFetch('/api/player?resource=doubles', {
        method: 'POST',
        body: JSON.stringify({ action: 'search', eventYear, term: q.trim() }),
      })
      setResults(res ?? [])
    } finally { setSearching(false) }
  }

  async function invite(pid) {
    setSaving(true); setError('')
    try {
      const { record: rec } = await apiFetch('/api/player?resource=doubles', {
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
    await apiFetch('/api/player?resource=doubles', {
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
              <CommitteeBadge roles={partnerProfile?.roles} size="xs" className="ml-1.5" />
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
          {results.map(p => {
            // After lock, you can only pair with someone already registered for
            // Doubles — inviting otherwise would raise their owing. Grey them out.
            const ineligible = locked && !(p.sideEvents ?? []).includes('doubles')
            return (
            <div key={p.id} className={`flex items-center gap-3 bg-surface rounded-lg px-3 py-2.5 border border-line ${ineligible ? 'opacity-50' : ''}`}>
              <div className="w-7 h-7 rounded-full bg-brand/10 flex items-center justify-center text-brand text-[10px] font-black flex-shrink-0">
                {((p.first_name?.[0] ?? '') + (p.last_name?.[0] ?? '')).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-semibold">
                  {p.first_name} {p.last_name}
                  {p.alias && <span className="text-brand ml-1">"{p.alias}"</span>}
                  <CommitteeBadge roles={p.roles} size="xs" className="ml-1.5" />
                  {ineligible && <span className="text-[#e5e5e5]/40 font-normal ml-1.5">(not in Doubles)</span>}
                </p>
                <p className="text-[#e5e5e5]/35 text-[10px] mt-0.5">
                  {p.teamName ?? 'No team'}
                  {p.state && <span className="ml-2 text-brand/60">{p.state}</span>}
                </p>
              </div>
              <button onClick={() => invite(p.id)} disabled={saving || ineligible}
                className="text-xs bg-brand hover:bg-brand-hover text-black font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-default flex-shrink-0">
                Invite
              </button>
            </div>
            )
          })}
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
function TriplesSelector({ userId, eventYear, record, partnerProfileMap, onUpdate, locked }) {
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
      const { results: res } = await apiFetch('/api/player?resource=triples', {
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
      const { record: rec } = await apiFetch('/api/player?resource=triples', {
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
      const { record: rec } = await apiFetch('/api/player?resource=triples', {
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
    await apiFetch('/api/player?resource=triples', {
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
            {!isMe && <CommitteeBadge roles={p?.roles} size="xs" className="ml-1.5" />}
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
          {results.map(p => {
            // After lock, you can only add someone already registered for
            // Triples — adding otherwise would raise their owing. Grey them out.
            const ineligible = locked && !(p.sideEvents ?? []).includes('triples')
            return (
            <div key={p.id} className={`flex items-center gap-3 bg-surface rounded-lg px-3 py-2.5 border border-line ${ineligible ? 'opacity-50' : ''}`}>
              <div className="w-7 h-7 rounded-full bg-brand/10 flex items-center justify-center text-brand text-[10px] font-black flex-shrink-0">
                {((p.first_name?.[0] ?? '') + (p.last_name?.[0] ?? '')).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-semibold">
                  {p.first_name} {p.last_name}
                  {p.alias && <span className="text-brand ml-1">"{p.alias}"</span>}
                  <CommitteeBadge roles={p.roles} size="xs" className="ml-1.5" />
                  {ineligible && <span className="text-[#e5e5e5]/40 font-normal ml-1.5">(not in Triples)</span>}
                </p>
                <p className="text-[#e5e5e5]/35 text-[10px] mt-0.5">
                  {p.teamName ?? 'No team'}
                  {p.state && <span className="ml-2 text-brand/60">{p.state}</span>}
                </p>
              </div>
              <button onClick={() => inviteToSlot(searchSlot, p.id)} disabled={saving || ineligible}
                className="text-xs bg-brand hover:bg-brand-hover text-black font-bold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-default flex-shrink-0">
                Invite
              </button>
            </div>
            )
          })}
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
  // Legal documents (PDF model). One active document per type; one acceptance
  // per (user, document, event_year). Phase 3 swap: replaces the old
  // code_of_conduct_versions / code_of_conduct_signatures / media_release_* /
  // under18_* tables.
  const [activeDocs, setActiveDocs] = useState({})       // { code_of_conduct: row, media_release: row, under_18_form: row }
  const [acceptances, setAcceptances] = useState({})     // { code_of_conduct: acceptanceRowWithJoinedDoc, media_release: ... }
  const [u18Approval, setU18Approval] = useState(null)   // approval row or null
  const [testResult, setTestResult] = useState(null)
  const [testSettings, setTestSettings] = useState(null) // referee_test_settings (null = loading)
  const [paymentRecords, setPaymentRecords] = useState([])

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

  // Collapsible hub sections. All collapsed on load. Controlled here (rather
  // than inside CollapsibleSection) so an in-page hash link can open a section.
  const [openSections, setOpenSections] = useState({
    'side-events': false,
    extras: false,
    volunteering: false,
    'payment-details': false,
  })
  function toggleSection(id) {
    setOpenSections(prev => ({ ...prev, [id]: !prev[id] }))
  }

  useEffect(() => {
    if (!authLoading && !user) { navigate('/login'); return }
    if (!user) return
    load()
  }, [authLoading, user, navigate])

  // Refetch when the tab regains focus/visibility so committee-side changes
  // (status, admin overrides, etc.) appear without a manual reload. Preserves
  // in-progress edit drafts (side-event selections, dinner guests).
  useEffect(() => {
    function refetch() { if (user && !document.hidden) load({ preserveDrafts: true }) }
    window.addEventListener('focus', refetch)
    document.addEventListener('visibilitychange', refetch)
    return () => {
      window.removeEventListener('focus', refetch)
      document.removeEventListener('visibilitychange', refetch)
    }
  }, [user]) // eslint-disable-line

  // Open a section when its anchor is targeted, so the checklist links
  // (#side-events, #extras) and any deep link land on expanded content.
  useEffect(() => {
    const SECTION_IDS = ['side-events', 'extras', 'volunteering', 'payment-details']
    function openFromHash() {
      const id = window.location.hash.replace('#', '')
      if (SECTION_IDS.includes(id)) {
        setOpenSections(prev => ({ ...prev, [id]: true }))
      }
    }
    openFromHash()
    window.addEventListener('hashchange', openFromHash)
    return () => window.removeEventListener('hashchange', openFromHash)
  }, [])

  async function load(opts) {
    const preserveDrafts = opts?.preserveDrafts === true
    // 1. Get active event
    const { data: ev } = await supabase
      .from('zltac_events')
      .select('id, name, year, status, side_events, main_fee, team_fee, processing_fee_pct, dinner_guest_price, reg_open_date, reg_close_date, event_starts_at, require_ref_test, require_coc, require_payment, bank_bsb, bank_account_number, bank_account_name, committee_email, payments_override, timezone')
      .eq('status', 'open')
      .maybeSingle()

    setEvent(ev)
    const eventYear = ev?.year

    if (!eventYear) { setLoading(false); return }

    const [
      { data: prof },
      { data: reg },
      { data: docs, error: docsErr },
      { data: accs, error: accsErr },
      { data: testData },
      { data: u18ApprovalData },
      { data: settingsData },
    ] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('zltac_registrations')
        .select('*, teams(id, name, captain_id, logo_url, state, status, home_venue, profiles!teams_captain_id_fkey(first_name, last_name))')
        .eq('user_id', user.id).eq('year', eventYear).maybeSingle(),
      supabase.from('legal_documents')
        .select('id, document_type, version, file_path, original_filename, effective_date, requires_reacceptance')
        .eq('is_active', true)
        .in('document_type', ['code_of_conduct', 'media_release', 'under_18_form']),
      supabase.from('legal_acceptances')
        .select('id, document_id, accepted_at, document:legal_documents!document_id(id, document_type, version, requires_reacceptance, file_path, original_filename, effective_date)')
        .eq('user_id', user.id)
        .eq('event_year', eventYear)
        .order('accepted_at', { ascending: false }),
      supabase.from('referee_test_results').select('passed, score, taken_at').eq('user_id', user.id).maybeSingle(),
      supabase.from('under_18_approvals')
        .select('id, status, submitted_at, approved_at, notes')
        .eq('user_id', user.id)
        .eq('event_year', eventYear)
        .maybeSingle(),
      supabase.from('referee_test_settings').select('*').limit(1).maybeSingle(),
    ])

    if (docsErr) console.error('PlayerHub: legal_documents query failed:', docsErr)
    if (accsErr) console.error('PlayerHub: legal_acceptances query failed:', accsErr)

    setProfile(prof)
    setRegistration(reg)
    if (reg?.teams) setTeam(reg.teams)

    // Index active docs by type
    const activeMap = {}
    for (const d of (docs ?? [])) activeMap[d.document_type] = d
    setActiveDocs(activeMap)

    // Group acceptances by document_type; keep the most recent per type
    // (.order accepted_at desc already arranged this).
    const accMap = {}
    for (const a of (accs ?? [])) {
      const t = a.document?.document_type
      if (t && !accMap[t]) accMap[t] = a
    }
    setAcceptances(accMap)

    setU18Approval(u18ApprovalData ?? null)
    setTestResult(testData ?? null)
    setTestSettings(settingsData ?? {})

    // Skip on a draft-preserving refresh so an in-progress edit isn't clobbered.
    if (reg && !preserveDrafts) {
      setSelectedSlugs(new Set(reg.side_events ?? []))
      setDinnerGuests(reg.dinner_guests ?? 0)
      setDinnerGuestsDraft(reg.dinner_guests ?? 0)
    }

    // Fetch payment records for this registration (depends on reg.id).
    // recorded_by is intentionally not selected — that's admin-only context.
    if (reg?.id) {
      const { data: prData, error: prErr } = await supabase
        .from('payment_records')
        .select('id, amount, recorded_at, bank_reference, notes')
        .eq('registration_id', reg.id)
        .order('recorded_at', { ascending: false })
      if (prErr) console.error('PlayerHub: payment_records query failed:', prErr)
      setPaymentRecords(prData ?? [])
    } else {
      setPaymentRecords([])
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
        apiFetch('/api/player?resource=doubles', {
          method: 'POST',
          body: JSON.stringify({ action: 'delete', id: doublesRecord.id }),
        }).then(() => setDoublesRecord(null))
      }
      if (slug === 'triples' && triplesRecord) {
        apiFetch('/api/player?resource=triples', {
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
    if (updated) {
      await recomputeOwing(updated.id)
      const { data: reread } = await supabase.from('zltac_registrations')
        .select('*, teams(id, name, captain_id, logo_url, state, status, home_venue, profiles!teams_captain_id_fkey(first_name, last_name))')
        .eq('id', updated.id).maybeSingle()
      setRegistration(reread ?? updated)
    }
    setSavingConfirm(false)
  }

  async function confirmExtras() {
    if (!event || !registration) return
    setSavingExtrasConfirm(true)
    const { data: updated } = await supabase.from('zltac_registrations')
      .update({ dinner_guests: dinnerGuestsDraft, has_confirmed_extras: true })
      .eq('user_id', user.id).eq('year', event.year).select().single()
    if (updated) {
      await recomputeOwing(updated.id)
      const { data: reread } = await supabase.from('zltac_registrations')
        .select('*, teams(id, name, captain_id, logo_url, state, status, home_venue, profiles!teams_captain_id_fkey(first_name, last_name))')
        .eq('id', updated.id).maybeSingle()
      setRegistration(reread ?? updated)
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
      const res = await fetch('/api/player?resource=registration', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ action: 'cancel', year: event.year }),
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
  // Phase gates the price-bearing self-service edits. When 'locked' or
  // 'closed', the side-event Select toggles, the Extras dinner stepper, and
  // the Confirm-Side-Events / Confirm-Extras buttons all disable, and the
  // locked banner pins above the checklist — these change amount_owing, so
  // they're frozen to protect price stability. Partner pickers
  // (doubles/triples) stay editable after lock: shuffling partners within
  // already-committed events doesn't change anyone's owing, so api/player.js
  // allows them. Team membership (join/leave) is still blocked server-side
  // via the phase guard in api/captain.js — it affects team_fee.
  const phase = eventPhase(event)
  const locked = phase !== 'open'
  const firstName = profile?.first_name ?? 'Player'
  const lastName = profile?.last_name ?? ''
  const aliasDisplay = profile?.alias
  const isRegistered = !!registration
  const u18Required = isUnder18(profile?.dob, eventYear)
  const memberId = user.id.split('-')[0].toUpperCase()

  // Legal-doc status per type. Returns 'current' (accepted active version,
  // or accepted an earlier version where neither side requires re-acceptance),
  // 'stale' (accepted older version that needs re-accept), or 'none'.
  function legalStatus(docType) {
    const active = activeDocs[docType]
    const acc = acceptances[docType]
    if (!acc) return 'none'
    if (!active) return acc ? 'current' : 'none'
    if (acc.document_id === active.id) return 'current'
    const oldVersionDoc = acc.document
    const requiresReaccept = !!(active.requires_reacceptance || oldVersionDoc?.requires_reacceptance)
    return requiresReaccept ? 'stale' : 'current'
  }

  const cocStatus = legalStatus('code_of_conduct')
  const mediaStatus = legalStatus('media_release')
  const cocSigned = cocStatus === 'current'
  const mediaSubmitted = mediaStatus === 'current'
  const u18Submitted = !!u18Approval && u18Approval.status !== 'rejected'

  // Committee manual overrides (from zltac_registrations). A concern reads
  // satisfied when the normal check passes OR its override is set — the same
  // rule used in CaptainHub / AdminRegistrations / AdminHome.
  const ovCoc = registration?.admin_override_coc === true
  const ovMedia = registration?.admin_override_media === true
  const ovRef = registration?.admin_override_ref_test === true
  const ovU18 = registration?.admin_override_u18 === true
  const cocSatisfied = cocSigned || ovCoc
  const mediaSatisfied = mediaSubmitted || ovMedia
  const refSatisfied = !!testResult?.passed || ovRef
  const u18Satisfied = u18Submitted || ovU18

  // Side events from event JSONB
  const enabledSideEvents = (event.side_events ?? []).filter(se => se.enabled && se.slug !== 'presentation-dinner')
  const individualSideEvents = enabledSideEvents.filter(se => ['lord-of-the-rings', 'solos'].includes(se.slug))
  const teamSideEvents = enabledSideEvents.filter(se => ['doubles', 'triples'].includes(se.slug))

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

  // Itemised cost (informational — for the Payment section breakdown).
  // Mirrors the computeAmountOwing server helper exactly so the itemisation
  // always reconciles to amount_owing (the registration row stays the source
  // of truth). Side events: every enabled non-dinner slug saved on the
  // registration, no confirmation gating, no live UI-selection state.
  const mainFee = event.main_fee ?? 0
  const teamFee = hasTeam ? (event.team_fee ?? 0) : 0
  const dinnerPrice = event.dinner_guest_price ?? 0
  const billedSideEvents = (() => {
    const config = new Map(
      (event.side_events ?? [])
        .filter(se => se.enabled && se.slug !== 'presentation-dinner')
        .map(se => [se.slug, se])
    )
    return (registration?.side_events ?? [])
      .map(slug => config.get(slug))
      .filter(Boolean)
  })()
  const sideTotal = billedSideEvents.reduce((s, se) => s + (se.price ?? 0), 0)
  const subtotal = mainFee + teamFee + sideTotal + dinnerGuests * dinnerPrice
  const processingFee = Math.round(subtotal * (event.processing_fee_pct ?? 0) / 100)

  // Decorative partner annotations for the doubles/triples itemisation rows.
  // Does not affect pricing — billedSideEvents already reconciles to amount_owing.
  const partnerName = (id) => {
    const p = partnerProfileMap[id]
    return p ? (p.alias || p.first_name || null) : null
  }
  const sideEventAnnotations = {
    doubles: doublesRecord?.confirmed
      ? `with ${partnerName(doublesRecord.player1_id === user.id ? doublesRecord.player2_id : doublesRecord.player1_id) ?? 'partner'}`
      : 'pending partner',
    triples: triplesRecord?.confirmed
      ? `with ${[triplesRecord.player1_id, triplesRecord.player2_id, triplesRecord.player3_id]
          .filter(id => id && id !== user.id)
          .map(partnerName).filter(Boolean).join(', ') || 'partners'}`
      : 'pending partner',
  }

  // Source of truth for billing: registration.amount_owing + payment_records ledger.
  const amountOwing = registration?.amount_owing ?? 0
  const amountPaid = paymentRecords.reduce((s, p) => s + (p.amount ?? 0), 0)
  const balance = amountOwing - amountPaid
  const isPaidInFull = isRegistered && balance <= 0
  const balanceTone = balance > 0 ? 'red' : balance === 0 ? 'green' : 'blue'
  const balanceLabel = balance < 0 ? 'overpaid ' : ''

  const hasBankDetails = !!(event.bank_bsb && event.bank_account_number && event.bank_account_name)
  const paymentRef = registration?.payment_reference ?? ''
  // Committee-controlled gate on the bank details. payment_reference and
  // amount_owing are never gated by this — only the account info to send money.
  const paymentState = arePaymentsOpen(event)

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

        {/* Event lifecycle countdown */}
        <EventLifecycleCountdown event={event} className="mb-8" />

        {/* Header */}
        <div className="mb-8">
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-1">ZLTAC {eventYear} · Player Hub</p>
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <h1 className="text-3xl font-black text-white flex flex-wrap items-center gap-2">
                <span>
                  {firstName} {lastName}
                  {aliasDisplay && <span className="text-brand ml-2 text-2xl">"{aliasDisplay}"</span>}
                </span>
                <CommitteeBadge roles={profile?.roles} size="sm" />
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
                <CommitteeBadge roles={inviter?.roles} size="xs" className="ml-1.5" />
                {' '}has invited you to be their Doubles partner. Do you accept?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    const { record } = await apiFetch('/api/player?resource=doubles', {
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
                    await apiFetch('/api/player?resource=doubles', {
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
                <CommitteeBadge roles={inviter?.roles} size="xs" className="ml-1.5" />
                {' '}has invited you to join their Triples team. Do you accept?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={async () => {
                    const { record } = await apiFetch('/api/player?resource=triples', {
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
                    await apiFetch('/api/player?resource=triples', {
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
            cocRequired={isCocRequired(event)}
            cocSigned={cocSatisfied}
            refRequired={isRefTestRequired(event)}
            refPassed={refSatisfied}
            mediaSubmitted={mediaSatisfied}
            paymentRequired={isPaymentRequired(event)}
            paid={isPaidInFull}
            sideEventsConfirmed={sideEventsConfirmed}
            extrasConfirmed={extrasConfirmed}
            u18Required={u18Required}
            u18Submitted={u18Satisfied}
          />
        )}

        <div className="space-y-5">

          {/* ── Team CTA (registered, not yet on a team) ── */}
          {isRegistered && !hasTeam && (
            <div className="bg-surface border border-line rounded-2xl p-10 text-center" style={{ borderTopColor: '#00FF41', borderTopWidth: '3px' }}>
              <h3 className="text-white font-black text-2xl mb-3 leading-tight">Captains: Create your team</h3>
              <p className="text-white text-sm leading-relaxed mb-6 max-w-md mx-auto">
                Are you a Captain? Create your team now and invite your players.
              </p>
              <Link
                to={`/events/${eventYear}/captain-register`}
                className="inline-block bg-brand hover:bg-brand-hover text-black font-bold py-3 px-8 rounded-xl text-sm text-center transition-all hover:shadow-[0_0_20px_rgba(0,255,65,0.4)]"
              >
                Create Team
              </Link>
              <p className="text-[#a0a0a0] text-sm leading-relaxed mt-6 max-w-md mx-auto">
                If you are a player, get your captain to create a team and invite you to it.
              </p>
            </div>
          )}

          {/* Phase banner — visible to player when registration is locked or
              fully closed. */}
          {locked && (
            <LockedRegistrationBanner
              phase={phase}
              email={event.committee_email}
              className="mb-2"
              lockedSubline="You can still find or change partners for side events you're already in. Contact the committee for any other changes."
            />
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

            {/* CoC row is hidden entirely when the event's require_coc
                toggle is off. */}
            {isCocRequired(event) && (
              <ChecklistItem
                status={!isRegistered ? 'pending' : cocSatisfied ? 'done' : 'error'}
                label={
                  cocStatus === 'current'
                    ? `Code of Conduct — signed ${formatDate(acceptances.code_of_conduct?.accepted_at)}`
                    : ovCoc
                      ? 'Code of Conduct — recorded by committee'
                      : cocStatus === 'stale'
                        ? 'Code of Conduct — updated, please re-accept'
                        : 'Code of Conduct — not yet signed'
                }
              >
                {isRegistered && cocStatus !== 'current' && !ovCoc && (
                  <CoCPanel
                    userId={user.id}
                    eventYear={eventYear}
                    activeDoc={activeDocs.code_of_conduct}
                    stale={cocStatus === 'stale'}
                    onAccepted={load}
                  />
                )}
              </ChecklistItem>
            )}

            {/* Ref-test row is hidden entirely when the event's require_ref_test
                toggle is off. Otherwise behaves as before. */}
            {isRefTestRequired(event) && (
              testSettings == null ? (
                /* Settings still loading — skeleton, never "undefined questions". */
                <div className="rounded-2xl border border-line bg-surface p-5 animate-pulse">
                  <div className="h-5 w-40 bg-line rounded mb-3" />
                  <div className="h-3 w-56 bg-line rounded mb-2" />
                  <div className="h-3 w-52 bg-line rounded mb-4" />
                  <div className="h-9 w-32 bg-line rounded-xl" />
                </div>
              ) : (() => {
                // Card-style Rules Test CTA. Status from testResult / override;
                // breakdown from referee_test_settings (same source as the test).
                const safetyQ = testSettings.safety_questions_per_test ?? 10
                const safetyP = testSettings.safety_pass_score ?? 100
                const generalQ = testSettings.general_questions_per_test ?? 20
                const generalP = testSettings.general_pass_score ?? 70
                // Passed players are locked (no retake); others who can act get the button.
                const showButton = isRegistered && !testResult?.passed && !ovRef
                return (
                  <div className="rounded-2xl border border-brand/30 bg-brand/[0.04] p-5">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-xl bg-brand/10 border border-brand/20 flex items-center justify-center flex-shrink-0">
                        <ClipboardCheck className="h-5 w-5 text-brand" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          <h3 className="text-white font-bold">Take Rules Test</h3>
                          {testResult?.passed
                            ? <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-brand/15 text-brand border border-brand/30">✓ Passed ({testResult.score}%)</span>
                            : ovRef
                              ? <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-brand/15 text-brand border border-brand/30">✓ Recorded by committee</span>
                              : testResult
                                ? <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/30">✗ Failed</span>
                                : null}
                        </div>
                        <p className="text-[#e5e5e5]/70 text-xs leading-relaxed">Safety: {safetyQ} question{safetyQ === 1 ? '' : 's'}, {safetyP}% pass required</p>
                        <p className="text-[#e5e5e5]/70 text-xs leading-relaxed">General: {generalQ} question{generalQ === 1 ? '' : 's'}, {generalP}% pass required</p>
                        {testResult?.passed ? (
                          <p className="mt-3 text-brand text-sm font-semibold">✓ Passed on {formatDate(testResult.taken_at)}</p>
                        ) : showButton && (
                          <Link to="/referee-test" className="inline-block mt-3 bg-brand hover:bg-brand-hover text-black font-bold px-4 py-2 rounded-xl text-sm transition-all">
                            {testResult ? 'Retake Test →' : 'Begin Test →'}
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })()
            )}

            <ChecklistItem
              status={!isRegistered ? 'pending' : mediaSatisfied ? 'done' : 'error'}
              label={
                mediaStatus === 'current'
                  ? `Media Release — signed ${formatDate(acceptances.media_release?.accepted_at)}`
                  : ovMedia
                    ? 'Media Release — recorded by committee'
                    : mediaStatus === 'stale'
                      ? 'Media Release — updated, please re-accept'
                      : 'Media Release — not yet submitted'
              }
            >
              {isRegistered && mediaStatus !== 'current' && !ovMedia && (
                <MediaReleasePanel
                  userId={user.id}
                  eventYear={eventYear}
                  activeDoc={activeDocs.media_release}
                  stale={mediaStatus === 'stale'}
                  onAccepted={load}
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
                status={
                  !isRegistered ? 'pending'
                    : (u18Approval?.status === 'approved' || ovU18) ? 'done'
                    : u18Approval ? 'error'
                    : 'error'
                }
                label={
                  u18Approval?.status === 'approved'
                    ? `Under 18 Parental Consent — approved ${formatDate(u18Approval.approved_at)}`
                    : ovU18
                      ? 'Under 18 Parental Consent — recorded by committee'
                      : u18Approval?.status === 'pending'
                        ? `Under 18 Parental Consent — submitted ${formatDate(u18Approval.submitted_at)} (awaiting committee)`
                        : u18Approval?.status === 'rejected'
                          ? 'Under 18 Parental Consent — rejected, contact committee'
                          : 'Under 18 Parental Consent — not yet submitted'
                }
              >
                {isRegistered && u18Approval?.status !== 'approved' && !ovU18 && (
                  <Under18Panel
                    userId={user.id}
                    eventYear={eventYear}
                    activeDoc={activeDocs.under_18_form}
                    approval={u18Approval}
                    onSubmitted={load}
                  />
                )}
              </ChecklistItem>
            )}

            {/* Payment row is hidden entirely when the event's
                require_payment toggle is off. */}
            {isPaymentRequired(event) && (
              <ChecklistItem
                status={!isRegistered ? 'pending' : isPaidInFull ? 'done' : 'error'}
                label={
                  !isRegistered
                    ? 'Payment'
                    : isPaidInFull
                      ? `Payment — Paid${balance < 0 ? ' (overpaid)' : ''}`
                      : `Payment — ${dollars(balance)} outstanding`
                }
              />
            )}
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
                            <CommitteeBadge roles={p.roles} size="xs" className="ml-1.5" />
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
            <CollapsibleSection
              id="side-events"
              icon={Trophy}
              title="Side Events"
              open={openSections['side-events']}
              onToggle={() => toggleSection('side-events')}
            >
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
                            disabled={locked}
                            className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-bold transition-all ${active ? 'bg-brand/15 border border-brand/40 text-brand' : 'bg-base border border-line text-[#e5e5e5]/50'} ${locked ? 'cursor-default' : (active ? '' : 'hover:border-brand/30 hover:text-white')}`}
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
                              disabled={locked}
                              className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-bold transition-all ${active ? 'bg-brand/15 border border-brand/40 text-brand' : 'bg-base border border-line text-[#e5e5e5]/50'} ${locked ? 'cursor-default' : (active ? '' : 'hover:border-brand/30 hover:text-white')}`}
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
                                  locked={locked}
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
                                  locked={locked}
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
                {locked ? (
                  <LockedNotice email={event.committee_email} />
                ) : (
                  <button
                    onClick={confirmSideEvents}
                    disabled={sideConfirmDisabled || savingConfirm}
                    className={`w-full font-bold py-2.5 rounded-xl text-sm transition-all ${sideConfirmDisabled ? 'bg-[#2D2D2D] border border-line text-[#e5e5e5]/30 cursor-default' : 'bg-brand hover:bg-brand-hover text-black'}`}
                  >
                    {savingConfirm ? 'Saving…' : sideConfirmDisabled ? 'Selections confirmed ✓' : sideEventsConfirmed ? 'Update Side Event Selections' : 'Confirm Side Event Selections'}
                  </button>
                )}
              </div>
            </CollapsibleSection>
          )}

          {/* ── Extras ── */}
          {isRegistered && (
            <CollapsibleSection
              id="extras"
              icon={Sparkles}
              title="Extras"
              open={openSections.extras}
              onToggle={() => toggleSection('extras')}
            >
              <p className="text-[#e5e5e5]/40 text-xs mb-5">Optional additions to your ZLTAC experience</p>

              {/* Presentation Dinner Guests */}
              <div className="rounded-xl border border-line bg-base p-4 mb-5">
                <p className="text-white font-semibold text-sm mb-0.5">Presentation Dinner Guests</p>
                <p className="text-[#e5e5e5]/40 text-xs mb-1">All registered players are included in the presentation dinner. Add extra guests below.</p>
                {dinnerPrice > 0 && <p className="text-brand font-black text-sm mb-3">{dollars(dinnerPrice)} per guest</p>}
                <div className="flex items-center gap-3">
                  <button type="button" onClick={() => setDinnerGuestsDraft(d => Math.max(0, d - 1))} disabled={locked} className={`w-8 h-8 rounded-lg bg-line text-white font-bold transition-colors ${locked ? 'cursor-default opacity-50' : 'hover:bg-[#374056]'}`}>−</button>
                  <span className="text-white font-bold w-6 text-center">{dinnerGuestsDraft}</span>
                  <button type="button" onClick={() => setDinnerGuestsDraft(d => Math.min(10, d + 1))} disabled={locked} className={`w-8 h-8 rounded-lg bg-line text-white font-bold transition-colors ${locked ? 'cursor-default opacity-50' : 'hover:bg-[#374056]'}`}>+</button>
                  {dinnerGuestsDraft > 0 && dinnerPrice > 0 && (
                    <span className="text-[#e5e5e5]/40 text-xs ml-1">{dinnerGuestsDraft} × {dollars(dinnerPrice)} = {dollars(dinnerGuestsDraft * dinnerPrice)}</span>
                  )}
                </div>
              </div>

              {/* Confirm extras button */}
              {locked ? (
                <LockedNotice email={event.committee_email} />
              ) : (
                <button
                  onClick={confirmExtras}
                  disabled={extrasConfirmDisabled || savingExtrasConfirm}
                  className={`w-full font-bold py-2.5 rounded-xl text-sm transition-all ${extrasConfirmDisabled ? 'bg-[#2D2D2D] border border-line text-[#e5e5e5]/30 cursor-default' : 'bg-brand hover:bg-brand-hover text-black'}`}
                >
                  {savingExtrasConfirm ? 'Saving…' : extrasConfirmDisabled ? 'Extras confirmed ✓' : extrasConfirmed ? 'Update Extras' : 'Confirm Extras'}
                </button>
              )}
            </CollapsibleSection>
          )}

          {/* ── Volunteering ── */}
          {isRegistered && (
            <CollapsibleSection
              id="volunteering"
              icon={HeartHandshake}
              title="Volunteering"
              open={openSections.volunteering}
              onToggle={() => toggleSection('volunteering')}
            >
              <VolunteerSection
                mode="hub"
                bare
                eventId={event.id}
                registrationId={registration.id}
                teamId={registration.team_id ?? null}
              />
            </CollapsibleSection>
          )}

          {/* ── Payment Details ── */}
          {/* When require_payment is off AND the event phase is locked,
              hide this section in PlayerHub — there's nothing the player
              can action and the breakdown adds clutter. Admin views still
              show payment details because manual records may still be
              recorded server-side. While the event is open we keep the
              section visible so players who *want* to pay still can. */}
          {isRegistered && !(!isPaymentRequired(event) && locked) && (
            <CollapsibleSection
              id="payment-details"
              icon={CreditCard}
              title="Payment Details"
              open={openSections['payment-details']}
              onToggle={() => toggleSection('payment-details')}
            >
              <p className="text-[#e5e5e5]/40 text-xs mb-5">Your event fees and how to pay</p>

              {/* Itemised breakdown — informational, computed live from event pricing */}
              <div className="bg-base border border-line rounded-xl p-4 mb-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#e5e5e5]/40 mb-3">Cost breakdown</p>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-[#e5e5e5]/50">Player registration fee</span>
                    <span className="text-[#e5e5e5]/50">{mainFee > 0 ? dollars(mainFee) : 'TBC'}</span>
                  </div>
                  {hasTeam && (
                    <div className="flex justify-between text-xs">
                      <span className="text-[#e5e5e5]/50">Team registration fee (per player)</span>
                      <span className="text-[#e5e5e5]/50">{dollars(teamFee)}</span>
                    </div>
                  )}
                  {billedSideEvents.map(se => (
                    <div key={se.slug} className="flex justify-between text-xs">
                      <span className="text-[#e5e5e5]/50">
                        {se.name}
                        {sideEventAnnotations[se.slug] && (
                          <span className="text-[#e5e5e5]/30"> ({sideEventAnnotations[se.slug]})</span>
                        )}
                      </span>
                      <span className="text-[#e5e5e5]/50">{dollars(se.price ?? 0)}</span>
                    </div>
                  ))}
                  {dinnerGuests > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-[#e5e5e5]/50">{dinnerGuests} dinner guest{dinnerGuests > 1 ? 's' : ''} × {dollars(dinnerPrice)}</span>
                      <span className="text-[#e5e5e5]/50">{dollars(dinnerGuests * dinnerPrice)}</span>
                    </div>
                  )}
                  {processingFee > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-[#e5e5e5]/40">Processing fee ({event.processing_fee_pct}%)</span>
                      <span className="text-[#e5e5e5]/40">{dollars(processingFee)}</span>
                    </div>
                  )}
                </div>
                <div className="border-t border-line mt-3 pt-3 flex justify-between">
                  <span className="text-white font-bold text-sm">Amount billed</span>
                  <span className="text-brand font-black text-sm">{dollars(amountOwing)}</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-4">
                <Stat label="Amount owing" value={dollars(amountOwing)} />
                <Stat label="Amount paid" value={dollars(amountPaid)} />
                <Stat label="Balance" value={dollars(Math.abs(balance))} tone={balanceTone} prefix={balanceLabel} />
              </div>

              {paymentRecords.length > 0 && (
                <div className="bg-base border border-line rounded-xl p-4 mb-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#e5e5e5]/40 mb-3">Payment History</p>
                  <div className="divide-y divide-line">
                    {paymentRecords.map(rec => (
                      <div key={rec.id} className="py-2 first:pt-0 last:pb-0">
                        <div className="flex justify-between items-baseline gap-3">
                          <span className="text-[#e5e5e5]/50 text-xs">{formatDate(rec.recorded_at, 'long')}</span>
                          <span className={`text-xs font-semibold ${rec.amount < 0 ? 'text-red-400' : 'text-brand'}`}>
                            {dollars(rec.amount)}
                          </span>
                        </div>
                        {rec.bank_reference && (
                          <p className="text-[#e5e5e5]/30 text-[11px] mt-0.5">Ref: {rec.bank_reference}</p>
                        )}
                        {rec.notes && (
                          <p className="text-[#e5e5e5]/30 text-[11px] mt-0.5 break-words">{rec.notes}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isPaidInFull ? (
                <div className="bg-brand/10 border border-brand/30 rounded-xl p-4">
                  <p className="text-brand font-semibold text-sm">Payment received — thanks!</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Bank details are gated by the committee payment-availability
                      state. The payment reference below is identity-tied and is
                      never gated — it always renders alongside amount owing. */}
                  {paymentState.open ? (
                    hasBankDetails ? (
                      <div className="bg-base border border-line rounded-xl p-4 space-y-4">
                        <p className="text-white font-semibold text-sm">Pay the balance to:</p>
                        <div className="grid grid-cols-2 gap-3">
                          <Field label="BSB" value={event.bank_bsb} />
                          <Field label="Account Number" value={event.bank_account_number} />
                          <Field label="Account Name" value={event.bank_account_name} className="col-span-2" />
                        </div>
                      </div>
                    ) : (
                      <div className="bg-base border border-line rounded-xl p-4">
                        <p className="text-[#e5e5e5]/60 text-sm">Bank details will be released soon.</p>
                      </div>
                    )
                  ) : paymentState.reason === 'auto_closed' ? (
                    <div className="bg-base border border-line rounded-xl p-4">
                      <p className="text-[#e5e5e5]/60 text-sm">Payment information will be available on {formatInEventTz(paymentState.opensAt, event.timezone, 'longWithTime')}.</p>
                    </div>
                  ) : (
                    <div className="bg-base border border-line rounded-xl p-4">
                      <p className="text-[#e5e5e5]/60 text-sm">Payments are temporarily closed. Contact the committee for assistance.</p>
                    </div>
                  )}

                  {paymentRef && (
                    <div className="bg-base border border-line rounded-xl p-4">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#e5e5e5]/40 mb-1.5">Reference</p>
                      <CopyableReference value={paymentRef} />
                      <p className="text-[#e5e5e5]/40 text-xs mt-2">Include this exact reference so we can match your payment.</p>
                    </div>
                  )}
                </div>
              )}
            </CollapsibleSection>
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
