import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../lib/apiFetch.js'
import { InlineAlert } from '../../components/Feedback'

function playerName(profile) {
  return [profile?.first_name, profile?.last_name].filter(Boolean).join(' ')
    || profile?.alias
    || 'Unknown player'
}

export default function AdminEmergencyContacts() {
  const [event, setEvent] = useState(null)
  const [contacts, setContacts] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    async function load() {
      setLoading(true)
      setError('')
      try {
        const eventResult = await apiFetch('/api/admin/event?resource=event')
        if (!active) return
        setEvent(eventResult.event ?? null)
        if (!eventResult.event?.year) {
          setContacts([])
          return
        }

        const result = await apiFetch(
          `/api/admin/event?resource=emergency-contacts&year=${eventResult.event.year}`,
        )
        if (active) setContacts(result.contacts ?? [])
      } catch (loadError) {
        if (active) setError(loadError?.message || 'Could not load emergency contacts.')
      } finally {
        if (active) setLoading(false)
      }
    }

    load()
    return () => { active = false }
  }, [])

  const filteredContacts = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return contacts
    return contacts.filter(contact => {
      const profile = contact.profiles ?? {}
      const teamName = contact.teams?.name ?? ''
      const haystack = [
        profile.first_name,
        profile.last_name,
        profile.alias,
        teamName,
        contact.emergency_contact_name,
        contact.emergency_contact_phone,
      ].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [contacts, search])

  const providedCount = contacts.filter(
    contact => contact.emergency_contact_name || contact.emergency_contact_phone,
  ).length

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-black text-white">Emergency Contacts</h1>
        <p className="text-[#e5e5e5]/60 text-sm mt-1">
          Event-specific details supplied by registered players and captains.
        </p>
      </div>

      <InlineAlert className="mb-5">{error}</InlineAlert>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !event ? (
        <div className="bg-surface border border-line rounded-2xl p-6 text-[#e5e5e5]/60 text-sm">
          No current ZLTAC event was found.
        </div>
      ) : (
        <div className="space-y-5">
          <div className="bg-surface border border-line rounded-2xl p-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-white font-bold">{event.name || `ZLTAC ${event.year}`}</p>
                <p className="text-[#e5e5e5]/60 text-xs mt-1">
                  {providedCount} of {contacts.length} registrations have provided contact details.
                </p>
              </div>
              <p className="text-[#e5e5e5]/60 text-xs max-w-md">
                Visible to committee for this ZLTAC event only. Use these details only when required for player safety.
              </p>
            </div>
            <input
              type="search"
              value={search}
              onChange={changeEvent => setSearch(changeEvent.target.value)}
              placeholder="Search player, alias, team, contact or phone"
              className="w-full mt-4 bg-base border border-line rounded-xl px-4 py-3 text-sm text-white placeholder-[#e5e5e5]/30 focus:outline-none focus:border-brand"
            />
          </div>

          <div className="bg-surface border border-line rounded-2xl overflow-hidden">
            {filteredContacts.length === 0 ? (
              <p className="px-5 py-8 text-center text-[#e5e5e5]/60 text-sm">
                No registered players match this search.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left">
                  <thead className="bg-base/70 border-b border-line">
                    <tr className="text-[10px] text-[#e5e5e5]/60 uppercase tracking-wider">
                      <th className="px-4 py-3">Player</th>
                      <th className="px-4 py-3">Team</th>
                      <th className="px-4 py-3">Emergency contact</th>
                      <th className="px-4 py-3">Phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredContacts.map(contact => {
                      const profile = contact.profiles ?? {}
                      return (
                        <tr key={contact.id} className="border-b border-line/50 last:border-0">
                          <td className="px-4 py-3">
                            <p className="text-white text-sm font-semibold">{playerName(profile)}</p>
                            {profile.alias && (
                              <p className="text-brand text-xs mt-0.5">"{profile.alias}"</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-[#e5e5e5]/70 text-sm">
                            {contact.teams?.name || 'No team'}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <span className={contact.emergency_contact_name ? 'text-white' : 'text-[#e5e5e5]/40 italic'}>
                              {contact.emergency_contact_name || 'Not provided'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {contact.emergency_contact_phone ? (
                              <a
                                href={`tel:${contact.emergency_contact_phone}`}
                                className="text-brand hover:underline"
                              >
                                {contact.emergency_contact_phone}
                              </a>
                            ) : (
                              <span className="text-[#e5e5e5]/40 italic">Not provided</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
