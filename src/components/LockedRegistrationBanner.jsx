import { COMMITTEE_EMAIL } from '../lib/eventPhase'

// Banner shown on PlayerHub / EventPage / any registration-edit view when
// the event phase is 'locked' or 'closed'. Communicates that self-service
// edits are disabled and points the player at the committee email.
//
// Use the `phase` prop ('locked' | 'closed') to vary the copy. Renders
// nothing for 'open'.
export default function LockedRegistrationBanner({ phase, className = '' }) {
  if (phase !== 'locked' && phase !== 'closed') return null

  const headline = phase === 'closed'
    ? 'Registration is closed'
    : 'Registration is locked'

  const subline = phase === 'closed'
    ? 'All registration changes (including payments) must now go via the committee.'
    : 'No further self-service changes. Contact the committee for any roster, side-event, or partner changes.'

  return (
    <div className={`bg-yellow-500/10 border border-yellow-500/30 rounded-xl px-4 py-3 flex items-start gap-3 ${className}`}>
      <span className="text-lg flex-shrink-0 leading-none mt-0.5" aria-hidden>🔒</span>
      <div className="min-w-0 text-sm">
        <p className="text-yellow-300 font-semibold">{headline}</p>
        <p className="text-yellow-200/80 mt-1 leading-relaxed">
          {subline}{' '}
          <a
            href={`mailto:${COMMITTEE_EMAIL}`}
            className="underline hover:text-yellow-100"
          >
            {COMMITTEE_EMAIL}
          </a>
        </p>
      </div>
    </div>
  )
}
