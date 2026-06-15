import { useState, useMemo, useId } from 'react'
import { apiFetch } from '../lib/apiFetch.js'
import Dialog from './Dialog'

// Admin-only modal for creating a "placeholder" registration: a player who has
// no portal account yet. It posts create-placeholder-registration to
// /api/admin/event?resource=registrations, which inserts a profile
// (is_placeholder=true) plus a zltac_registrations row and any partner pairings.
//
// The form mirrors the player self-service registration field set
// (src/pages/PlayerRegister.jsx) and reuses the partner-picker shape from
// RegistrationEditModal. Only first name and alias are required here (admins
// often register a player from a paper form with partial details).
//
// User-facing copy intentionally avoids em-dashes and en-dashes.

const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NZ']

function displayName(p) {
  if (!p) return 'Unknown'
  const full = [p.first_name, p.last_name].filter(Boolean).join(' ')
  return full || p.alias || 'Unknown'
}

export default function AddPlaceholderRegistrationModal({
  eventYear,
  enabledSideEvents, // [{ slug, name, ... }, ...]
  teams,             // [{ id, name }, ...]  approved teams only
  allPlayers,        // [{ user_id, profile: {...} }, ...]  partner candidates
  onClose,
  onCreated,         // (result: { registration, profile, payment_reference }) => void
}) {
  const uid = useId()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [alias, setAlias] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [stateVal, setStateVal] = useState('')
  const [dob, setDob] = useState('')
  const [ecName, setEcName] = useState('')
  const [ecPhone, setEcPhone] = useState('')

  const [selectedSlugs, setSelectedSlugs] = useState(() => new Set())
  const [teamId, setTeamId] = useState('')
  const [dinnerGuests, setDinnerGuests] = useState(0)

  const [doublesPartnerId, setDoublesPartnerId] = useState('')
  const [triplesP2, setTriplesP2] = useState('')
  const [triplesP3, setTriplesP3] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Every registered player is a valid partner candidate, sorted by name.
  // Uniqueness conflicts are resolved server side by clear-and-replace.
  const partnerOptions = useMemo(() => {
    return (allPlayers ?? [])
      .filter(p => p.user_id)
      .map(p => ({ id: p.user_id, name: displayName(p.profile), alias: p.profile?.alias }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [allPlayers])

  const enabledSlugs = (enabledSideEvents ?? []).filter(se => se.slug !== 'presentation-dinner')

  function toggleSlug(slug) {
    setSelectedSlugs(prev => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  function addSlug(slug) {
    setSelectedSlugs(prev => (prev.has(slug) ? prev : new Set(prev).add(slug)))
  }

  // Selecting a partner implies the player is in that side event, so pre-check
  // the matching box for transparency. The server also enforces this on save.
  function pickDoubles(value) {
    setDoublesPartnerId(value)
    if (value) addSlug('doubles')
  }
  function pickTriples(setter, value) {
    setter(value)
    if (value) addSlug('triples')
  }

  async function save() {
    setError('')
    if (!firstName.trim()) { setError('First name is required.'); return }
    if (!alias.trim()) { setError('Alias is required.'); return }

    setSaving(true)
    try {
      const result = await apiFetch('/api/admin/event?resource=registrations', {
        method: 'POST',
        body: JSON.stringify({
          action: 'create-placeholder-registration',
          event_year: eventYear,
          first_name: firstName.trim(),
          last_name: lastName.trim() || null,
          alias: alias.trim(),
          email: email.trim() || null,
          phone: phone.trim() || null,
          state: stateVal || null,
          dob: dob || null,
          emergency_contact_name: ecName.trim() || null,
          emergency_contact_phone: ecPhone.trim() || null,
          side_events: [...selectedSlugs],
          team_id: teamId || null,
          dinner_guests: parseInt(dinnerGuests) || 0,
          doubles_partner_id: doublesPartnerId || null,
          triples_partner_ids: [triplesP2 || null, triplesP3 || null],
        }),
      })
      onCreated(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white placeholder-[#e5e5e5]/25 focus:outline-none focus:border-brand'
  const labelCls = 'block text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-1.5'

  return (
    <Dialog open onClose={onClose} variant="scroll" size="2xl" closeOnBackdrop>
        <div className="p-6 border-b border-line flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Dialog.Title className="text-white font-bold text-lg">Add manual registration</Dialog.Title>
            <p className="text-[#e5e5e5]/60 text-sm mt-0.5">
              Creates a player profile and registration for ZLTAC {eventYear} without a portal account.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-[#e5e5e5]/60 hover:text-white text-2xl leading-none">×</button>
        </div>

        {error && (
          <div role="alert" className="mx-6 mt-4 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-red-400 text-xs">
            {error}
          </div>
        )}

        <div className="p-6 space-y-5">
          {/* Player details */}
          <div>
            <p className="text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-3">Player details</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={`${uid}-first-name`} className={labelCls}>First name *</label>
                <input id={`${uid}-first-name`} type="text" value={firstName} onChange={e => setFirstName(e.target.value)} className={inputCls} placeholder="First name" />
              </div>
              <div>
                <label htmlFor={`${uid}-last-name`} className={labelCls}>Last name</label>
                <input id={`${uid}-last-name`} type="text" value={lastName} onChange={e => setLastName(e.target.value)} className={inputCls} placeholder="Last name" />
              </div>
              <div>
                <label htmlFor={`${uid}-alias`} className={labelCls}>Alias *</label>
                <input id={`${uid}-alias`} type="text" value={alias} onChange={e => setAlias(e.target.value)} className={inputCls} placeholder="In game name" />
              </div>
              <div>
                <label htmlFor={`${uid}-state`} className={labelCls}>State</label>
                <select id={`${uid}-state`} value={stateVal} onChange={e => setStateVal(e.target.value)} className={inputCls}>
                  <option value="">Select</option>
                  {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor={`${uid}-dob`} className={labelCls}>Date of birth</label>
                <input id={`${uid}-dob`} type="date" value={dob} onChange={e => setDob(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label htmlFor={`${uid}-phone`} className={labelCls}>Phone</label>
                <input id={`${uid}-phone`} type="tel" value={phone} onChange={e => setPhone(e.target.value)} className={inputCls} placeholder="04XX XXX XXX" />
              </div>
            </div>
            <div className="mt-3">
              <label htmlFor={`${uid}-email`} className={labelCls}>Email</label>
              <input id={`${uid}-email`} type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} placeholder="player@example.com" />
              <p className="text-[10px] text-[#e5e5e5]/60 mt-1">Optional. Recommended so this player can claim their registration if they sign up later.</p>
            </div>
          </div>

          <div className="border-t border-line" />

          {/* Emergency contact */}
          <div>
            <p className="text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-3">Emergency contact <span className="text-[#e5e5e5]/60 font-normal normal-case">(optional)</span></p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={`${uid}-ec-name`} className={labelCls}>Name</label>
                <input id={`${uid}-ec-name`} type="text" value={ecName} onChange={e => setEcName(e.target.value)} className={inputCls} placeholder="Full name" />
              </div>
              <div>
                <label htmlFor={`${uid}-ec-phone`} className={labelCls}>Phone</label>
                <input id={`${uid}-ec-phone`} type="text" value={ecPhone} onChange={e => setEcPhone(e.target.value)} className={inputCls} placeholder="04XX XXX XXX" />
              </div>
            </div>
          </div>

          <div className="border-t border-line" />

          {/* Registration */}
          <div>
            <p className="text-xs text-[#e5e5e5]/60 font-bold uppercase tracking-wider mb-3">Registration</p>

            <label className={labelCls}>Side events</label>
            {enabledSlugs.length === 0 ? (
              <p className="text-[#e5e5e5]/60 text-xs italic">No side events configured for this event.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {enabledSlugs.map(se => (
                  <label key={se.slug} className="flex items-center gap-2 cursor-pointer bg-base border border-line rounded-lg px-3 py-2">
                    <input type="checkbox" checked={selectedSlugs.has(se.slug)} onChange={() => toggleSlug(se.slug)} className="w-4 h-4 accent-brand" />
                    <span className="text-sm text-white truncate">{se.name ?? se.slug}</span>
                  </label>
                ))}
              </div>
            )}

            <div className="mt-4">
              <label htmlFor={`${uid}-team`} className={labelCls}>Team</label>
              <select id={`${uid}-team`} value={teamId} onChange={e => setTeamId(e.target.value)} className={inputCls}>
                <option value="">No team (side events only)</option>
                {(teams ?? []).map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            <div className="mt-4">
              <label htmlFor={`${uid}-doubles`} className={labelCls}>Doubles partner</label>
              <select id={`${uid}-doubles`} value={doublesPartnerId} onChange={e => pickDoubles(e.target.value)} className={inputCls}>
                <option value="">No doubles partner</option>
                {partnerOptions.map(p => (
                  <option key={p.id} value={p.id}>{p.name}{p.alias ? ` (${p.alias})` : ''}</option>
                ))}
              </select>
              <p className="text-[10px] text-[#e5e5e5]/60 mt-1">Selecting a partner clears any existing pairing for either player and is confirmed automatically.</p>
            </div>

            <div className="mt-4">
              <label className={labelCls}>Triples partners</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: triplesP2, set: setTriplesP2, label: 'Player 2' },
                  { value: triplesP3, set: setTriplesP3, label: 'Player 3' },
                ].map(({ value, set, label }) => (
                  <div key={label}>
                    <p className="text-[10px] text-[#e5e5e5]/60 mb-1">{label}</p>
                    <select value={value} onChange={e => pickTriples(set, e.target.value)} className={inputCls}>
                      <option value="">None</option>
                      {partnerOptions.map(p => (
                        <option key={p.id} value={p.id}>{p.name}{p.alias ? ` (${p.alias})` : ''}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 w-40">
              <label htmlFor={`${uid}-dinner-guests`} className={labelCls}>Dinner guests</label>
              <input id={`${uid}-dinner-guests`} type="number" min={0} value={dinnerGuests} onChange={e => setDinnerGuests(e.target.value)} className={inputCls} />
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-line flex items-center justify-end gap-3">
          <button onClick={onClose} className="text-sm text-[#e5e5e5]/60 hover:text-white px-3 py-2">Cancel</button>
          <button
            onClick={save}
            disabled={saving}
            className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-5 py-2 rounded-xl text-sm transition-colors"
          >
            {saving ? 'Creating...' : 'Create registration'}
          </button>
        </div>
    </Dialog>
  )
}
