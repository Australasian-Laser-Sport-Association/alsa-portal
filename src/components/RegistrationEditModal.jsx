import { useState, useMemo } from 'react'
import { apiFetch } from '../lib/apiFetch.js'
import { dollars } from '../lib/pricing.js'

// Admin-only modal for editing a single zltac_registrations row. Bypasses
// the player-side phase guard (admin can edit in any phase). Supports:
//   - side event slug selections (checkbox grid)
//   - team membership (dropdown of approved teams + "no team")
//   - doubles partner (dropdown of other registered players)
//   - triples partners (two dropdowns)
//   - admin_note textarea
//
// On save, calls PATCH /api/admin/registrations and surfaces the new
// balance in the success toast.

function displayName(p) {
  if (!p) return 'Unknown'
  const full = [p.first_name, p.last_name].filter(Boolean).join(' ')
  return full || p.alias || 'Unknown'
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
  // Side event selections
  const [selectedSlugs, setSelectedSlugs] = useState(
    () => new Set(registration.side_events ?? [])
  )
  const [teamId, setTeamId] = useState(registration.team_id ?? '')
  const [adminNote, setAdminNote] = useState(registration.admin_note ?? '')

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
        side_events: [...selectedSlugs],
        team_id: teamId || null,
        doubles_partner_id: doublesPartnerId || null,
        triples_partner_ids: [triplesP2 || null, triplesP3 || null],
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
          {/* Side events */}
          <div>
            <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-2">Side events</label>
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
          </div>

          {/* Team */}
          <div>
            <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">Team</label>
            <select
              value={teamId}
              onChange={e => setTeamId(e.target.value)}
              className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
            >
              <option value="">No team (side events only)</option>
              {(teams ?? []).map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Doubles partner */}
          <div>
            <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">Doubles partner</label>
            <select
              value={doublesPartnerId}
              onChange={e => setDoublesPartnerId(e.target.value)}
              className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
            >
              <option value="">No doubles partner</option>
              {partnerOptions.map(p => (
                <option key={p.id} value={p.id}>{p.name}{p.alias ? ` (${p.alias})` : ''}</option>
              ))}
            </select>
            <p className="text-[10px] text-[#e5e5e5]/30 mt-1">Replacing a partnership will clear any existing pairing for either player.</p>
          </div>

          {/* Triples partners */}
          <div>
            <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">Triples partners</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: triplesP2, set: setTriplesP2, label: 'Player 2' },
                { value: triplesP3, set: setTriplesP3, label: 'Player 3' },
              ].map(({ value, set, label }) => (
                <div key={label}>
                  <p className="text-[10px] text-[#e5e5e5]/35 mb-1">{label}</p>
                  <select
                    value={value}
                    onChange={e => set(e.target.value)}
                    className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand"
                  >
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

          {/* Admin note */}
          <div>
            <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">Reason for change (optional)</label>
            <textarea
              rows={2}
              value={adminNote}
              onChange={e => setAdminNote(e.target.value)}
              placeholder="e.g. Partner withdrew, swapped at player's request"
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
