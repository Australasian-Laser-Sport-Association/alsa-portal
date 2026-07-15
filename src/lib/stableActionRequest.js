// Returns one UUID for repeated submissions of an identical action payload.
// A successful caller clears ref.current; a materially changed payload gets a
// fresh UUID automatically. Keeping this tiny and pure makes lost-response
// retry behaviour directly testable without rendering a modal.
export function stableActionRequestId(ref, payload, makeUuid = () => crypto.randomUUID()) {
  const fingerprint = JSON.stringify(payload)
  if (!ref.current || ref.current.fingerprint !== fingerprint) {
    ref.current = { fingerprint, requestId: makeUuid() }
  }
  return ref.current.requestId
}
