import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react'
import { apiFetch } from '../lib/apiFetch.js'

// Chunk 2 placeholder-claim banner + modal, shared by PlayerHub (post-
// registration view) and PlayerRegister (pre-registration view). Each instance
// fetches its own matches from /api/player?resource=claimable on mount and
// filters per-device dismissals out of the list.
//
// Imperative API (via ref):
//   openForPlaceholder(id) — opens the modal focused on a specific placeholder
//   (used when the server precheck returns 'placeholder_exists' so we can
//   surface the relevant match even if the user previously dismissed it).
//
// Dismissals are keyed by (userId, placeholderId) in localStorage. Cross-device
// re-prompt is accepted for v1.

const PlaceholderClaimPrompt = forwardRef(function PlaceholderClaimPrompt(
  { userId, onClaimed },
  ref,
) {
  const [matches, setMatches] = useState([])
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(null)
  const [working, setWorking] = useState(null)   // placeholder id being submitted
  const [focusId, setFocusId] = useState(null)   // pre-selected placeholder id

  const dismissKey = useCallback(
    (phId) => `placeholder_dismissed_${userId}_${phId}`,
    [userId],
  )

  const refresh = useCallback(async ({ extraIds = [] } = {}) => {
    try {
      const { matches: data } = await apiFetch('/api/player?resource=claimable')
      const visible = (data ?? []).filter(m => {
        if (extraIds.includes(m.placeholder.id)) return true
        return !localStorage.getItem(dismissKey(m.placeholder.id))
      })
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

  useImperativeHandle(ref, () => ({
    async openForPlaceholder(phId) {
      // Clear any prior dismissal for this id and refetch so the placeholder
      // shows in the list even if the user previously hit "Not me".
      try { localStorage.removeItem(dismissKey(phId)) } catch { /* private mode */ }
      const visible = await refresh({ extraIds: [phId] })
      setFocusId(phId)
      setError(null)
      // Only open if we actually have a match to show; otherwise the modal
      // would render an empty state which is confusing.
      if (visible.some(m => m.placeholder.id === phId)) {
        setOpen(true)
      }
    },
  }))

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

  // Order so that any focused placeholder (from openForPlaceholder) renders
  // first in the modal list.
  const orderedMatches = focusId
    ? [...matches].sort((a, b) => (a.placeholder.id === focusId ? -1 : b.placeholder.id === focusId ? 1 : 0))
    : matches

  return (
    <>
      <div className="bg-surface border border-brand/30 rounded-2xl p-5 mb-5">
        <p className="text-white font-bold mb-1">
          We found {matches.length} registration{matches.length === 1 ? '' : 's'} that might be yours
        </p>
        <p className="text-white text-sm mb-4 leading-relaxed">
          The committee created {matches.length === 1 ? 'a placeholder profile' : 'placeholder profiles'} that match your alias or email.
          Review the details and claim {matches.length === 1 ? 'it' : 'them'} if {matches.length === 1 ? "it's" : "they're"} yours.
        </p>
        <button
          type="button"
          onClick={() => { setError(null); setFocusId(null); setOpen(true) }}
          className="bg-brand hover:bg-brand-hover text-black font-bold px-4 py-2 rounded-xl text-sm transition-all"
        >
          Review and claim
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4">
          <div className="bg-surface border border-line rounded-2xl p-6 max-w-xl w-full max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-white font-bold text-lg">Claim a registration</p>
                <p className="text-white text-xs mt-1">
                  Each match is a placeholder profile that shares your alias or email. Claim only the ones that are actually you.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-white text-xl leading-none px-2"
              >×</button>
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2 mb-4">
                <p className="text-red-400 text-xs">{error}</p>
              </div>
            )}

            <div className="space-y-3">
              {orderedMatches.map(m => {
                const ph = m.placeholder
                const fullName = [ph.first_name, ph.last_name].filter(Boolean).join(' ')
                const isFocused = ph.id === focusId
                return (
                  <div
                    key={ph.id}
                    className={`bg-base border rounded-xl p-4 ${isFocused ? 'border-brand/60' : 'border-line'}`}
                  >
                    <div className="mb-2">
                      <p className="text-white font-semibold text-sm">
                        {fullName || ph.alias || 'Unnamed placeholder'}
                        {ph.alias && <span className="text-brand ml-2">"{ph.alias}"</span>}
                      </p>
                      {ph.placeholder_email && (
                        <p className="text-white text-xs mt-0.5">Email on file: {ph.placeholder_email}</p>
                      )}
                    </div>
                    {m.registrations.length > 0 ? (
                      <div className="bg-surface border border-line rounded-lg p-3 mb-3">
                        <p className="text-white text-[10px] font-bold uppercase tracking-wider mb-1.5">Registrations</p>
                        <ul className="space-y-1">
                          {m.registrations.map(r => (
                            <li key={`${ph.id}_${r.year}`} className="text-white text-xs">
                              <span className="font-semibold">ZLTAC {r.year}</span>
                              {r.payment_reference && (
                                <span className="font-mono ml-2">{r.payment_reference}</span>
                              )}
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
          </div>
        </div>
      )}
    </>
  )
})

export default PlaceholderClaimPrompt
