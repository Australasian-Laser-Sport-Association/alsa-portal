import { COMMITTEE_EMAIL } from '../lib/eventPhase'

// Inline yellow "locked" informational block rendered in place of a disabled
// action button (Confirm Side Events, Confirm Extras, Add Players, Disband
// Team, …) once an event is past its registration lock. Matches the
// LockedRegistrationBanner palette and is deliberately non-clickable — only
// the committee email inside it is a link.
//
// `email` is the event's committee_email; falls back to the app-level
// COMMITTEE_EMAIL constant when unset. The parent already has the event row,
// so it passes the value down — this component never fetches it.
export default function LockedNotice({ email, className = '' }) {
  const committeeEmail = email || COMMITTEE_EMAIL
  return (
    <div className={`w-full rounded-xl px-4 py-2.5 text-sm font-semibold bg-yellow-500/10 border border-yellow-500/30 text-yellow-300 flex items-center justify-center gap-2 cursor-default ${className}`}>
      <span aria-hidden>🔒</span>
      <span>
        Locked — Contact{' '}
        <a href={`mailto:${committeeEmail}`} className="underline hover:text-yellow-100">{committeeEmail}</a>
        {' '}for changes
      </span>
    </div>
  )
}
