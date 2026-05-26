import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../lib/useAuth'
import { apiFetch } from '../../lib/apiFetch.js'

// Manager Hub — landing page for /manage.
//   Lists every competition the caller manages (non-archived only).
//   Each card links to /manage/competitions/:slug.
//   Empty state asks them to contact a superadmin.

function formatDateRange(start, end) {
  if (!start || !end) return '-'
  const opts = { day: '2-digit', month: 'short', year: 'numeric' }
  const s = new Date(start).toLocaleDateString('en-AU', opts)
  const e = new Date(end).toLocaleDateString('en-AU', opts)
  return s === e ? s : `${s} to ${e}`
}

function registrationWindowStatus(comp) {
  const now = new Date()
  const open = comp.registration_open_at ? new Date(comp.registration_open_at) : null
  const close = comp.registration_close_at ? new Date(comp.registration_close_at) : null
  if (!open && !close) return { label: 'Not scheduled', tone: 'grey' }
  if (open && now < open) return { label: 'Not yet open', tone: 'amber' }
  if (close && now > close) return { label: 'Closed', tone: 'grey' }
  return { label: 'Open', tone: 'green' }
}

const TONE = {
  green: 'bg-green-500/15 text-green-400 border-green-500/30',
  amber: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  grey:  'bg-[#374056] text-white border-line',
}

function Pill({ tone, children }) {
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border whitespace-nowrap ${TONE[tone]}`}>
      {children}
    </span>
  )
}

export default function ManagerHub() {
  const { profile } = useAuth()
  const [comps, setComps] = useState(null) // null = loading
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const list = await apiFetch('/api/superadmin/my-competitions')
      setComps(list)
      setError(null)
    } catch (err) {
      setError(err.message || 'Could not load your competitions.')
      setComps([])
    }
  }, [])

  useEffect(() => {
    // See AdminCompetitions for the queueMicrotask + set-state-in-effect note.
    queueMicrotask(load)
  }, [load])

  const displayName = profile?.alias || profile?.first_name || 'Manager'

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-black text-white">Manager Hub</h1>
        <p className="text-white opacity-60 text-sm mt-1">Welcome, <span className="text-brand font-semibold">{displayName}</span>.</p>
      </div>

      {error && (
        <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
          <p className="text-red-400 text-sm"><strong>Error:</strong> {error}</p>
        </div>
      )}

      {comps === null ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : comps.length === 0 ? (
        <div className="bg-surface border border-line rounded-2xl px-6 py-12 text-center">
          <p className="text-white text-base font-semibold mb-2">No competitions assigned yet</p>
          <p className="text-white text-sm opacity-70">
            Contact an ALSA superadmin to be granted manager access to a competition.
          </p>
        </div>
      ) : (
        <>
          <p className="text-white opacity-70 text-sm mb-3">You manage the following competitions:</p>
          <div className="space-y-3">
            {comps.map(c => {
              const win = registrationWindowStatus(c)
              return (
                <Link
                  key={c.id}
                  to={`/manage/competitions/${c.slug}`}
                  className="block bg-surface border border-line hover:border-brand/40 rounded-2xl p-5 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-white text-lg font-bold">{c.name}</p>
                      <p className="text-white opacity-40 text-[11px] font-mono mt-0.5">/competitions/{c.slug}</p>
                      <p className="text-white opacity-70 text-xs mt-2">{formatDateRange(c.start_date, c.end_date)}</p>
                    </div>
                    <Pill tone={win.tone}>{win.label}</Pill>
                  </div>
                </Link>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
