import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../lib/apiFetch.js'
import Dialog from './Dialog'

// Placeholder-claim banner + modal, shared by PlayerHub and PlayerRegister.
// The server returns only records tied to the account's verified Auth email;
// this component filters per-device dismissals out of that authorized list.
//
// Dismissals are keyed by (userId, placeholderId) in localStorage. Cross-device
// re-prompt is accepted for v1.

export default function PlaceholderClaimPrompt({ userId, onClaimed }) {
  const [matches, setMatches] = useState([])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(null)
  const [working, setWorking] = useState(null)   // placeholder id being submitted

  const dismissKey = useCallback(
    (phId) => `placeholder_dismissed_${userId}_${phId}`,
    [userId],
  )

  const refresh = useCallback(async () => {
    try {
      const { matches: data } = await apiFetch('/api/player?resource=claimable')
      const visible = (data ?? []).filter(
        match => !localStorage.getItem(dismissKey(match.placeholder.id)),
      )
      setMatches(visible)
      return visible
    } catch (err) {
      console.error('[PlaceholderClaimPrompt] fetch failed:', err)
      return []
    }
  }, [dismissKey])

  useEffect(() => {
    if (!userId) return
    refresh()
  }, [userId, refresh])

  async function claim(phId) {
    setWorking(phId)
    setError(null)
    try {
      const result = await apiFetch('/api/player?resource=claim', {
        method: 'POST',
        body: JSON.stringify({ placeholder_id: phId }),
      })
      if (result?.ok === false) {
        setError(result.error || 'Could not claim this registration.')
        return
      }
      setMatches(prev => prev.filter(m => m.placeholder.id !== phId))
      if (onClaimed) onClaimed({ placeholderId: phId })
    } catch (err) {
      setError(err.message || 'Could not claim this registration.')
    } finally {
      setWorking(null)
    }
  }

  function dismiss(phId) {
    try { localStorage.setItem(dismissKey(phId), '1') } catch { /* private mode */ }
    setMatches(prev => prev.filter(m => m.placeholder.id !== phId))
  }

  if (matches.length === 0) return null

  return (
    <>
      <div className="bg-surface border border-brand/30 rounded-2xl p-5 mb-5">
        <p className="text-white font-bold mb-1">
          We found {matches.length} registration{matches.length === 1 ? '' : 's'} that might be yours
        </p>
        <p className="text-white text-sm mb-4 leading-relaxed">
          The committee created {matches.length === 1 ? 'a registration' : 'registrations'} using your verified account email.
          Review the details and claim {matches.length === 1 ? 'it' : 'them'} if {matches.length === 1 ? "it's" : "they're"} yours.
        </p>
        <button
          type="button"
          onClick={() => { setError(null); setOpen(true) }}
          className="bg-brand hover:bg-brand-hover text-black font-bold px-4 py-2 rounded-xl text-sm transition-all"
        >
          Review and claim
        </button>
      </div>

      {open && (
        <Dialog open onClose={() => setOpen(false)} variant="center" size="xl" className="p-6 max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <Dialog.Title as="p" className="text-white font-bold text-lg">Claim a registration</Dialog.Title>
                <p className="text-white text-xs mt-1">
                  Each match was recorded against your verified account email. Claim only registrations that are actually yours.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Dismiss"
                className="text-white text-xl leading-none px-2"
              >x</button>
            </div>

            {error && (
              <div role="alert" className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 mb-4">
                <p className="text-red-400 text-xs">{error}</p>
              </div>
            )}

            <div className="space-y-3">
              {matches.map(m => {
                const ph = m.placeholder
                return (
                  <div
                    key={ph.id}
                    className="bg-base border border-line rounded-xl p-4"
                  >
                    <div className="mb-2">
                      <p className="text-white font-semibold text-sm">
                        {ph.alias ? <>Alias: <span className="text-brand">{ph.alias}</span></> : 'Committee-created registration'}
                      </p>
                    </div>
                    {m.registrations.length > 0 ? (
                      <div className="bg-surface border border-line rounded-lg p-3 mb-3">
                        <p className="text-white text-[10px] font-bold uppercase tracking-wider mb-1.5">Registrations</p>
                        <ul className="space-y-1">
                          {m.registrations.map(r => (
                            <li key={`${ph.id}_${r.year}`} className="text-white text-xs">
                              <span className="font-semibold">ZLTAC {r.year}</span>
                              {r.side_events && r.side_events.length > 0 && (
                                <span className="ml-2">side events: {r.side_events.join(', ')}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="text-white text-xs mb-3 italic">No registrations recorded for this placeholder.</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => claim(ph.id)}
                        disabled={working === ph.id}
                        className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-4 py-2 rounded-lg text-xs transition-colors"
                      >
                        {working === ph.id ? 'Claiming...' : 'Claim this'}
                      </button>
                      <button
                        type="button"
                        onClick={() => dismiss(ph.id)}
                        disabled={working === ph.id}
                        className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 font-bold px-4 py-2 rounded-lg text-xs transition-colors"
                      >
                        Not me
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
        </Dialog>
      )}
    </>
  )
}
