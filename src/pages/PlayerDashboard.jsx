import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { formatDate } from '../lib/dateFormat'
import { isCommittee, ROLE_ORDER } from '../lib/roles'

const STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NZ']

const STATUS_BADGE = {
  pending:  'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  approved: 'bg-brand/10 text-brand border-brand/30',
  confirmed:'bg-brand/10 text-brand border-brand/30',
  rejected: 'bg-red-500/15 text-red-400 border-red-500/30',
}

function Field({ label, value, green }) {
  return (
    <div>
      <p className="text-[#e5e5e5]/40 text-xs uppercase tracking-wider mb-0.5">{label}</p>
      <p className={`text-sm font-medium ${green ? 'text-brand' : 'text-white'}`}>{value || <span className="text-[#e5e5e5]/25 font-normal">Not set</span>}</p>
    </div>
  )
}

function Input({ label, type = 'text', value, onChange, placeholder }) {
  return (
    <div>
      <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-base border border-line rounded-xl px-4 py-2.5 text-sm text-white placeholder-[#e5e5e5]/25 focus:outline-none focus:border-brand transition-colors"
      />
    </div>
  )
}

// ── Profile Card ─────────────────────────────────────────────────────────────
function ProfileCard({ profile, userId, userEmail, onUpdated }) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const [avatarUploading, setAvatarUploading] = useState(false)

  // Edit form state
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName]   = useState('')
  const [alias, setAlias]         = useState('')
  const [dob, setDob]             = useState('')
  const [state, setState]         = useState('')
  const [homeArena, setHomeArena] = useState('')
  const [phone, setPhone]         = useState('')
  const [ecName, setEcName]       = useState('')
  const [ecPhone, setEcPhone]     = useState('')

  function startEdit() {
    setFirstName(profile?.first_name ?? '')
    setLastName(profile?.last_name ?? '')
    setAlias(profile?.alias ?? '')
    setDob(profile?.dob ?? '')
    setState(profile?.state ?? '')
    setHomeArena(profile?.home_arena ?? '')
    setPhone(profile?.phone ?? '')
    setEcName(profile?.emergency_contact_name ?? '')
    setEcPhone(profile?.emergency_contact_phone ?? '')
    setMsg(null)
    setEditing(true)
  }

  async function handleAvatarUpload(file) {
    if (!file) return
    setAvatarUploading(true)
    const ext = file.name.split('.').pop()
    const { error } = await supabase.storage.from('avatars').upload(`${userId}/avatar.${ext}`, file, { upsert: true })
    if (!error) {
      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(`${userId}/avatar.${ext}`)
      await supabase.from('profiles').update({ avatar_url: urlData.publicUrl }).eq('id', userId)
      onUpdated()
    }
    setAvatarUploading(false)
  }

  async function save() {
    setSaving(true)
    setMsg(null)
    const { error } = await supabase.from('profiles').update({
      first_name: firstName.trim() || null,
      last_name: lastName.trim() || null,
      alias: alias.trim() || null,
      dob: dob || null,
      state: state || null,
      home_arena: homeArena.trim() || null,
      phone: phone.trim() || null,
      emergency_contact_name: ecName.trim() || null,
      emergency_contact_phone: ecPhone.trim() || null,
    }).eq('id', userId)
    setSaving(false)
    if (error) { setMsg({ type: 'error', text: error.message }); return }
    setMsg({ type: 'ok', text: 'Profile updated.' })
    onUpdated()
    setTimeout(() => setEditing(false), 800)
  }

  const avatarUrl = profile?.avatar_url
  const initials = [profile?.first_name, profile?.last_name].filter(Boolean).map(n => n[0]).join('').toUpperCase() || '?'

  return (
    <div className="bg-surface border border-line rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-line flex items-center justify-between">
        <h2 className="text-white font-bold text-base">My Profile</h2>
        {!editing && (
          <button onClick={startEdit} className="text-xs text-[#e5e5e5]/50 hover:text-white border border-line hover:border-[#374056] px-3 py-1.5 rounded-lg transition-colors">
            Edit Profile
          </button>
        )}
      </div>

      <div className="px-6 py-6">
        {/* Avatar row */}
        <div className="flex items-center gap-5 mb-6">
          <div className="relative flex-shrink-0">
            {avatarUrl
              ? <img src={avatarUrl} alt="avatar" className="w-16 h-16 rounded-full object-cover border-2 border-line" />
              : <div className="w-16 h-16 rounded-full bg-brand/20 border-2 border-brand/30 flex items-center justify-center text-brand font-black text-xl">{initials}</div>
            }
            {editing && (
              <label className="absolute inset-0 rounded-full flex items-center justify-center bg-black/60 cursor-pointer text-white text-xs font-bold">
                {avatarUploading ? '…' : 'Change'}
                <input type="file" accept="image/*" className="hidden" onChange={e => handleAvatarUpload(e.target.files[0])} />
              </label>
            )}
          </div>
          <div>
            <p className="text-white font-bold text-lg">{[profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || '—'}</p>
            {profile?.alias && <p className="text-brand text-sm font-medium">{profile.alias}</p>}
            {(profile?.roles?.length > 0) && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {ROLE_ORDER.filter(r => (profile.roles ?? []).includes(r)).map(r => {
                  const m = ROLE_PILL_META[r]
                  return (
                    <span key={r} className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border ${m.cls}`}>
                      {m.label}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {editing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input label="First Name" value={firstName} onChange={setFirstName} />
              <Input label="Last Name" value={lastName} onChange={setLastName} />
            </div>
            <Input label="Alias (in-game name)" value={alias} onChange={setAlias} placeholder="e.g. DarkShot" />
            <div className="grid grid-cols-2 gap-4">
              <Input label="Date of Birth" type="date" value={dob} onChange={setDob} />
              <div>
                <label className="block text-xs text-[#e5e5e5]/50 font-bold uppercase tracking-wider mb-1.5">State / Territory</label>
                <select value={state} onChange={e => setState(e.target.value)} className="w-full bg-base border border-line rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-brand transition-colors">
                  <option value="">Select…</option>
                  {STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <Input label="Home Arena" value={homeArena} onChange={setHomeArena} placeholder="e.g. Zone Laser Force Sydney" />
            <Input label="Phone" type="tel" value={phone} onChange={setPhone} placeholder="04XX XXX XXX" />
            <div className="grid grid-cols-2 gap-4">
              <Input label="Emergency Contact Name" value={ecName} onChange={setEcName} placeholder="Full name" />
              <Input label="Emergency Contact Phone" value={ecPhone} onChange={setEcPhone} placeholder="04XX XXX XXX" />
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button onClick={save} disabled={saving} className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-6 py-2.5 rounded-xl text-sm transition-all">
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              <button onClick={() => setEditing(false)} className="border border-line text-[#e5e5e5]/60 hover:text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors">
                Cancel
              </button>
              {msg && <span className={`text-sm ${msg.type === 'ok' ? 'text-brand' : 'text-red-400'}`}>{msg.text}</span>}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-4">
            <Field label="First Name" value={profile?.first_name} />
            <Field label="Last Name" value={profile?.last_name} />
            <Field label="Alias" value={profile?.alias} green />
            <Field label="Date of Birth" value={formatDate(profile?.dob) || null} />
            <Field label="State / Territory" value={profile?.state} />
            <Field label="Home Arena" value={profile?.home_arena} />
            <Field label="Email" value={userEmail} />
            <Field label="Phone" value={profile?.phone} />
            <Field label="Emergency Contact" value={profile?.emergency_contact_name ? `${profile.emergency_contact_name}${profile.emergency_contact_phone ? ` · ${profile.emergency_contact_phone}` : ''}` : null} />
            <Field label="Member Since" value={formatDate(profile?.created_at, 'monthYear') || null} />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Registration Card ─────────────────────────────────────────────────────────
function RegistrationCard({ registration, openEvent }) {
  if (registration) {
    const statusClass = STATUS_BADGE[registration.status] ?? STATUS_BADGE.pending
    const teamName = registration.teams?.name ?? (registration.team_id ? '—' : 'Side events only')
    return (
      <div className="bg-surface border border-line rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-line">
          <h2 className="text-white font-bold text-base">My ZLTAC Registration</h2>
        </div>
        <div className="px-6 py-5 flex flex-wrap items-center gap-6">
          <div>
            <p className="text-[#e5e5e5]/40 text-xs uppercase tracking-wider mb-0.5">Event</p>
            <p className="text-white font-semibold">ZLTAC {registration.year}</p>
          </div>
          <div>
            <p className="text-[#e5e5e5]/40 text-xs uppercase tracking-wider mb-0.5">Team</p>
            <p className="text-white font-semibold">{teamName}</p>
          </div>
          <div>
            <p className="text-[#e5e5e5]/40 text-xs uppercase tracking-wider mb-0.5">Status</p>
            <span className={`inline-block text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full border ${statusClass}`}>
              {registration.status ?? 'Pending'}
            </span>
          </div>
          <Link to="/player-hub" className="ml-auto text-sm text-brand font-semibold hover:underline">
            View in Player Hub →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-surface border border-line rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-line">
        <h2 className="text-white font-bold text-base">My ZLTAC Registration</h2>
      </div>
      <div className="px-6 py-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <p className="text-[#e5e5e5]/50 text-sm">You are not registered for any upcoming ZLTAC event.</p>
        {openEvent && (
          <Link
            to={`/events/${openEvent.year}/player-register`}
            className="flex-shrink-0 bg-brand hover:bg-brand-hover text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-all"
          >
            Register for {openEvent.name}
          </Link>
        )}
      </div>
    </div>
  )
}

// ── Hub Card ──────────────────────────────────────────────────────────────────
function HubCard({ color, title, description, buttonLabel, to }) {
  return (
    <div className="bg-surface border border-line rounded-2xl p-6 flex flex-col gap-4">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${color}20` }}>
        <div className="w-4 h-4 rounded-full" style={{ backgroundColor: color }} />
      </div>
      <div className="flex-1">
        <p className="text-white font-bold text-base mb-1">{title}</p>
        <p className="text-[#e5e5e5]/50 text-sm leading-relaxed">{description}</p>
      </div>
      <Link
        to={to}
        className="inline-block text-center text-white text-sm font-bold py-2.5 px-5 rounded-xl transition-opacity hover:opacity-85"
        style={{ backgroundColor: color }}
      >
        {buttonLabel}
      </Link>
    </div>
  )
}

const ROLE_PILL_META = {
  superadmin:      { label: 'Superadmin',      cls: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
  alsa_committee:  { label: 'ALSA Committee',  cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
  zltac_committee: { label: 'ZLTAC Committee', cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
  advisor:         { label: 'Advisor',         cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  captain:         { label: 'Captain',         cls: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
  player:          { label: 'Player',          cls: 'bg-line text-[#e5e5e5]/40 border-transparent' },
}
// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function PlayerDashboard() {
  const { user, userRoles } = useAuth()
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState(null)
  const [openEvent, setOpenEvent] = useState(null)
  const [registration, setRegistration] = useState(null)

  useEffect(() => {
    if (!user) return
    load()
  }, [user]) // eslint-disable-line

  async function load() {
    const [{ data: prof }, { data: ev }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', user.id).single(),
      supabase.from('zltac_events').select('name, year').eq('status', 'open').maybeSingle(),
    ])
    setProfile(prof)
    setOpenEvent(ev)

    if (ev?.year) {
      const { data: reg } = await supabase
        .from('zltac_registrations')
        .select('id, year, status, team_id, teams(name)')
        .eq('user_id', user.id)
        .eq('year', ev.year)
        .maybeSingle()
      setRegistration(reg)
    }
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const displayName = profile?.alias || profile?.first_name || 'Player'
  const alsaId = `ALSA #${user.id.split('-')[0].toUpperCase()}`

  const showPlayerHub = !!registration
  const showTeamHub   = userRoles.includes('captain') || isCommittee(profile)
  const showAdminHub  = isCommittee(profile)
  const showAnyHub    = showPlayerHub || showTeamHub || showAdminHub

  return (
    <div className="min-h-screen bg-base">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">

        {/* Welcome header */}
        <div>
          <h1 className="text-3xl font-black text-white">
            Welcome Back, <span className="text-brand">{displayName}</span>
          </h1>
          <p className="text-[#e5e5e5]/35 text-sm mt-1">{alsaId}</p>
        </div>

        {/* Profile card */}
        <ProfileCard
          profile={profile}
          userId={user.id}
          userEmail={user.email}
          onUpdated={load}
        />

        {/* Registration card */}
        <RegistrationCard registration={registration} openEvent={openEvent} />

        {/* Hubs */}
        <div>
          <h2 className="text-white font-bold text-base mb-4">My Hubs</h2>
          {showAnyHub ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {showPlayerHub && (
                <HubCard
                  color="#FF6B00"
                  title="Player Hub"
                  description="Manage your ZLTAC registration, complete your forms, side events and payment."
                  buttonLabel="Go to Player Hub"
                  to="/player-hub"
                />
              )}
              {showTeamHub && (
                <HubCard
                  color="#E24B4A"
                  title="Team Hub"
                  description="Manage your team roster, view player completion status and team settings."
                  buttonLabel="Go to Team Hub"
                  to="/captain-hub"
                />
              )}
              {showAdminHub && (
                <HubCard
                  color="#7C3AED"
                  title="Admin Hub"
                  description="Full ALSA and ZLTAC management including current event, registrations, users and settings."
                  buttonLabel="Go to Admin Hub"
                  to="/admin"
                />
              )}
            </div>
          ) : (
            <div className="bg-surface border border-line rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="text-white font-bold text-base mb-1">Get Started with ZLTAC</p>
                <p className="text-[#e5e5e5]/50 text-sm">Register for the current ZLTAC event to get started.</p>
              </div>
              <Link
                to={openEvent ? `/events/${openEvent.year}` : '/zltac'}
                className="flex-shrink-0 bg-brand hover:bg-brand-hover text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-all"
              >
                View Current Event
              </Link>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
