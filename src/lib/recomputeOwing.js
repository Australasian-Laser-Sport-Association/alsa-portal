import { apiFetch } from './apiFetch.js'

// Fire-and-forget recompute of amount_owing on the server.
// Returns the new amount on success, null on failure (logged but not thrown —
// the caller's primary save has already succeeded).
export async function recomputeOwing(registrationId) {
  if (!registrationId) return null
  try {
    const { amountOwing } = await apiFetch('/api/player?resource=registration', {
      method: 'POST',
      body: JSON.stringify({ action: 'recompute-owing', registrationId }),
    })
    return amountOwing
  } catch (err) {
    console.error('[recomputeOwing] failed:', err)
    return null
  }
}
