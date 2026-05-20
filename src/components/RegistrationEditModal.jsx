import { useState, useMemo } from 'react'
import { apiFetch } from '../lib/apiFetch.js'
import { dollars } from '../lib/pricing.js'

// Admin-only modal for editing a single zltac_registrations row (plus a couple
// of profile fields). Bypasses the player-side phase guard — admin can edit in
// any phase. Organised into sections:
//   - Player identity:   alias, state (profiles), emergency contact (reg)
//   - Registration:      side events, team, doubles/triples partners,
//                        dinner guests, status
//   - Manual overrides:  CoC / Media / Ref Test / U18 — "committee verified
//                        outside the system" fast-path (see migration
//                        20260520050000). Reads satisfied as normalCheck||override.
//   - Confirmation flags: has_confirmed_side_events / _extras
//   - Admin note:        free-text audit trail
//
// On save, calls PATCH /api/admin/registrations (which recomputes amount_owing
// and writes the profile fields) and surfaces the new balance in the toast.

const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NZ']

function displayName(p) {
  if (!p) return 'Unknown'
  const full = [p.first_name, p.last_name].filter(Boolean).join(' ')
  return full || p.alias || 'Unknown'
}

function SectionHeader({ children }) {
  return (
    <p className="text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-3 pt-1">{children}</p>
  )
}

function CheckRow({ checked, onChange, label, hint }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer bg-base border border-line rounded-lg px-3 py-2.5">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="w-4 h-4 accent-brand mt-0.5" />
      <span className="min-w-0">
        <span className="text-sm text-white block">{label}</span>
        {hint && <span className="text-[10px] text-[#e5e5e5]/35 block mt-0.5">{hint}</span>}
      </span>
    </label>
  )
}

export default function RegistrationEditModal({
  registration,
  profile,
  enabledSideEvents,   // [{ slug, name, ... }, ...]
  teams,               // [{ id, name }, ...]  approved teams only
  allPlayers,          // [{ user_id, profile: {...} }, ...]  candidates for partner picks
  existingDoublesPair, // doubles_pairs row containing this user, or null
  existingTriplesTeam, // triples_teams row containing this user, or null
  onClose,
  onSaved,             // (summary: { amountOwing, amountPaid, balance }) => void
}) {
  // Player identity (alias/state live on profiles; emergency contact on the reg)
  const [alias, setAlias] = useState(profile?.alias ?? '')
  const [stateVal, setStateVal] = useState(profile?.state ?? '')
  const [ecName, setEcName] = useState(registration.emergency_contact_name ?? '')
  const [ecPhone, setEcPhone] = useState(registration.emergency_contact_phone ?? '')

  // Registration
  const [selectedSlugs, setSelectedSlugs] = useState(
    () => new Set(registration.side_events ?? [])
  )
  const [teamId, setTeamId] = useState(registration.team_id ?? '')
  const [dinnerGuests, setDinnerGuests] = useState(registration.dinner_guests ?? 0)
  const [status, setStatus] = useState(registration.status ?? 'pending')

  // Doubles partner — initialised to whichever player in the pair ISN'T this user.
  const initialDoublesPartner = (() => {
    if (!existingDoublesPair) return ''
    return existingDoublesPair.player1_id === registration.user_id
      ? (existingDoublesPair.player2_id ?? '')
      : (existingDoublesPair.player1_id ?? '')
  })()
  const [doublesPartnerId, setDoublesPartnerId] = useState(initialDoublesPartner)

  // Triples partners — preserve the other two slot ids.
  const initialTriplesPartners = (() => {
    if (!existingTriplesTeam) return ['', '']
    const slots = [existingTriplesTeam.player1_id, existingTriplesTeam.player2_id, existingTriplesTeam.player3_id]
    const others = slots.filter(id => id && id !== registration.user_id)
    return [others[0] ?? '', others[1] ?? '']
  })()
  const [triplesP2, setTriplesP2] = useState(initialTriplesPartners[0])
  const [triplesP3, setTriplesP3] = useState(initialTriplesPartners[1])

  // Manual overrides
  const [ovCoc, setOvCoc] = useState(!!registration.admin_override_coc)
  const [ovMedia, setOvMedia] = useState(!!registration.admin_override_media)
  const [ovRef, setOvRef] = useState(!!registration.admin_override_ref_test)
  const [ovU18, setOvU18] = useState(!!registration.admin_override_u18)

  // Confirmation flags (player self-attestation; committee can flip)
  const [confirmedSide, setConfirmedSide] = useState(!!registration.has_confirmed_side_events)
  const [confirmedExtras, setConfirmedExtras] = useState(!!registration.has_confirmed_extras)

  const [adminNote, setAdminNote] = useState(registration.admin_note ?? '')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Candidate dropdown options — every registered player except this one,
  // sorted by name. The admin can pick anyone; uniqueness conflicts get
  // resolved by the server's clear-and-replace logic.
  const partnerOptions = useMemo(() => {
    return (allPlayers ?? [])
      .filter(p => p.user_id && p.user_id !== registration.user_id)
      .map(p => ({ id: p.user_id, name: displayName(p.profile), alias: p.profile?.alias }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [allPlayers, registration.user_id])

  function toggleSlug(slug) {
    setSelectedSlugs(prev => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  async function save() {
    setError('')
    setSaving(true)
    try {
      const body = {
        registrationId: registration.id,
        // identity
        alias: alias.trim() || null,
        state: stateVal || null,
        emergency_contact_name: ecName.trim() || null,
        emergency_contact_phone: ecPhone.trim() || null,
        // registration
        side_events: [...selectedSlugs],
        team_id: teamId || null,
        doubles_partner_id: doublesPartnerId || null,
        triples_partner_ids: [triplesP2 || null, triplesP3 || null],
        dinner_guests: parseInt(dinnerGuests) || 0,
        status,
        // confirmation flags
        has_confirmed_side_events: confirmedSide,
        has_confirmed_extras: confirmedExtras,
        // manual overrides
        admin_override_coc: ovCoc,
        admin_override_media: ovMedia,
        admin_override_ref_test: ovRef,
        admin_override_u18: ovU18,
        // audit
        admin_note: adminNote.trim() || null,
      }
      const result = await apiFetch('/api/admin/registrations', {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      onSaved(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const playerName = displayName(profile)
  const enabledSlugs = (enabledSideEvents ?? []).filter(se => se.slug !== 'presentation-dinner')

  const inputCls = 'w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand'
  const labelCls = 'block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5'

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center px-4 py-8 overflow-y-auto" onClick={onClose}>
      <div className="bg-surface border border-line rounded-2xl w-full max-w-2xl my-auto" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-line flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-white font-bold text-lg">Edit registration</h2>
            <p className="text-[#e5e5e5]/50 text-sm mt-0.5 truncate">
              {playerName}{profile?.alias && <span className="text-brand"> ({profile.alias})</span>}
              <span className="text-[#e5e5e5]/30"> · ZLTAC {registration.year}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-[#e5e5e5]/40 hover:text-white text-2xl leading-none">×</button>
        </div>

        {error && (
          <div className="mx-6 mt-4 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-400 text-xs">
            {error}
          </div>
        )}

        <div className="p-6 space-y-5">
          {/* ── Player identity ── */}
          <div>
            <SectionHeader>Player identity</SectionHeader>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Alias</label>
                <input type="text" value={alias} onChange={e => setAlias(e.target.value)} className={inputCls} placeholder="—" />
              </div>
              <div>
                <label className={labelCls}>State</label>
                <select value={stateVal} onChange={e => setStateVal(e.target.value)} className={inputCls}>
                  <option value="">—</option>
                  {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Emergency contact name</label>
                <input type="text" value={ecName} onChange={e => setEcName(e.target.value)} className={inputCls} placeholder="—" />
              </div>
              <div>
                <label className={labelCls}>Emergency contact phone</label>
                <input type="text" value={ecPhone} onChange={e => setEcPhone(e.target.value)} className={inputCls} placeholder="—" />
              </div>
            </div>
            <p className="text-[10px] text-[#e5e5e5]/30 mt-1">Alias and state are saved to the player's profile.</p>
          </div>

          <div className="border-t border-line" />

          {/* ── Registration ── */}
          <div>
            <SectionHeader>Registration</SectionHeader>

            {/* Side events */}
            <label className={labelCls}>Side events</label>
            {enabledSlugs.length === 0 ? (
              <p className="text-[#e5e5e5]/40 text-xs italic">No side events configured for this event.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {enabledSlugs.map(se => (
                  <label key={se.slug} className="flex items-center gap-2 cursor-pointer bg-base border border-line rounded-lg px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selectedSlugs.has(se.slug)}
                      onChange={() => toggleSlug(se.slug)}
                      className="w-4 h-4 accent-brand"
                    />
                    <span className="text-sm text-white truncate">{se.name ?? se.slug}</span>
                  </label>
                ))}
              </div>
            )}

            {/* Team */}
            <div className="mt-4">
              <label className={labelCls}>Team</label>
              <select value={teamId} onChange={e => setTeamId(e.target.value)} className={inputCls}>
                <option value="">No team (side events only)</option>
                {(teams ?? []).map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            {/* Doubles partner */}
            <div className="mt-4">
              <label className={labelCls}>Doubles partner</label>
              <select value={doublesPartnerId} onChange={e => setDoublesPartnerId(e.target.value)} className={inputCls}>
                <option value="">No doubles partner</option>
                {partnerOptions.map(p => (
                  <option key={p.id} value={p.id}>{p.name}{p.alias ? ` (${p.alias})` : ''}</option>
                ))}
              </select>
              <p className="text-[10px] text-[#e5e5e5]/30 mt-1">Replacing a partnership will clear any existing pairing for either player.</p>
            </div>

            {/* Triples partners */}
            <div className="mt-4">
              <label className={labelCls}>Triples partners</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: triplesP2, set: setTriplesP2, label: 'Player 2' },
                  { value: triplesP3, set: setTriplesP3, label: 'Player 3' },
                ].map(({ value, set, label }) => (
                  <div key={label}>
                    <p className="text-[10px] text-[#e5e5e5]/35 mb-1">{label}</p>
                    <select value={value} onChange={e => set(e.target.value)} className={inputCls}>
                      <option value="">—</option>
                      {partnerOptions.map(p => (
                        <option key={p.id} value={p.id}>{p.name}{p.alias ? ` (${p.alias})` : ''}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-[#e5e5e5]/30 mt-1">Editing the triples team will clear any existing team containing this player.</p>
            </div>

            {/* Dinner guests + status */}
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div>
                <label className={labelCls}>Dinner guests</label>
                <input type="number" min={0} value={dinnerGuests}
                  onChange={e => setDinnerGuests(e.target.value)} className={inputCls} />
                <p className="text-[10px] text-[#e5e5e5]/30 mt-1">Affects amount owing — recomputed on save.</p>
              </div>
              <div>
                <label className={labelCls}>Status</label>
                <select value={status} onChange={e => setStatus(e.target.value)} className={inputCls}>
                  <option value="pending">Pending</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
            </div>
          </div>

          <div className="border-t border-line" />

          {/* ── Manual overrides ── */}
          <div>
            <SectionHeader>Manual overrides</SectionHeader>
            <p className="text-[10px] text-[#e5e5e5]/40 mb-3 leading-relaxed">
              Use when the committee has verified a requirement outside the system. An override
              marks the concern satisfied without creating a (player-signed) record — record the
              reason in the admin note below.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <CheckRow checked={ovCoc}   onChange={setOvCoc}   label="Code of Conduct" />
              <CheckRow checked={ovMedia} onChange={setOvMedia} label="Media Release" />
              <CheckRow checked={ovRef}   onChange={setOvRef}   label="Referee Test" />
              <CheckRow checked={ovU18}   onChange={setOvU18}   label="Under-18 Approval" />
            </div>
          </div>

          <div className="border-t border-line" />

          {/* ── Confirmation flags ── */}
          <div>
            <SectionHeader>Confirmation flags</SectionHeader>
            <div className="grid grid-cols-2 gap-2">
              <CheckRow checked={confirmedSide}   onChange={setConfirmedSide}
                label="Side events confirmed" hint="Player self-attestation" />
              <CheckRow checked={confirmedExtras} onChange={setConfirmedExtras}
                label="Extras confirmed" hint="Player self-attestation" />
            </div>
          </div>

          <div className="border-t border-line" />

          {/* ── Admin note ── */}
          <div>
            <SectionHeader>Admin note</SectionHeader>
            <textarea
              rows={2}
              value={adminNote}
              onChange={e => setAdminNote(e.target.value)}
              placeholder="Reason for any change or override — e.g. CoC signed on paper at venue, partner withdrew"
              className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white placeholder-[#e5e5e5]/25 focus:outline-none focus:border-brand resize-none"
            />
            <p className="text-[10px] text-[#e5e5e5]/30 mt-1">Stored on the registration as audit trail; never shown to the player.</p>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-line flex items-center justify-between gap-3">
          <p className="text-xs text-[#e5e5e5]/40">
            Current owing: <span className="text-white">{dollars(registration.amount_owing ?? 0)}</span>
          </p>
          <div className="flex gap-3">
            <button onClick={onClose} className="text-sm text-[#e5e5e5]/60 hover:text-white px-3 py-2">Cancel</button>
            <button
              onClick={save}
              disabled={saving}
              className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-5 py-2 rounded-xl text-sm transition-colors"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
