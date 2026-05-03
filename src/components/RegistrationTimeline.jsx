import { Link } from 'react-router-dom'

// Educational mode steps — shown to anonymous visitors and logged-in-but-not-registered users.
// These describe the journey without referencing personal completion state.
const EDUCATIONAL_STEPS = [
  { label: 'Register as a player', description: 'Create your ALSA account and sign up for the event.' },
  { label: 'Join or create a team', description: 'Use a captain\'s invite code, or start a new team and invite others.' },
  { label: 'Sign the Code of Conduct', description: 'Agree to the ALSA Code of Conduct before the event.' },
  { label: 'Sign the Media Release', description: 'Confirm consent for event photos and footage.' },
  { label: 'Confirm side events', description: 'Choose your side events (Solos, Doubles, Triples, etc.).' },
  { label: 'Pay your fees', description: 'Settle your registration and side event fees.' },
]

function StepCircle({ index, status }) {
  const base = 'relative w-12 h-12 rounded-full flex items-center justify-center text-base flex-shrink-0'

  if (status === 'done') {
    return (
      <div className={`${base} bg-brand border-2 border-brand text-black font-black`}>
        ✓
      </div>
    )
  }
  if (status === 'current') {
    return (
      <div className={`${base} bg-base border-2 border-brand text-brand font-bold shadow-[0_0_20px_rgba(0,255,65,0.4)]`}>
        {index + 1}
      </div>
    )
  }
  // 'future' (personalized) or 'educational'
  const numberColor = status === 'future' ? 'text-[#e5e5e5]/30' : 'text-[#e5e5e5]/40'
  return (
    <div className={`${base} bg-base border-2 border-line ${numberColor} font-bold`}>
      {index + 1}
    </div>
  )
}

function OptionalPill() {
  return (
    <span className="mt-2 inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-amber-400/10 text-amber-300 border border-amber-400/30">
      Optional
    </span>
  )
}

export default function RegistrationTimeline({ mode, steps, eventName }) {
  const isPersonalized = mode === 'personalized'
  const renderSteps = isPersonalized ? steps : EDUCATIONAL_STEPS.map(s => ({ ...s, done: false }))

  if (!renderSteps?.length) return null

  const doneCount = isPersonalized ? renderSteps.filter(s => s.done).length : 0
  // First non-done step in personalized mode is "current".
  const currentIdx = isPersonalized ? renderSteps.findIndex(s => !s.done) : -1

  function statusFor(i, step) {
    if (!isPersonalized) return 'educational'
    if (step.done) return 'done'
    if (i === currentIdx) return 'current'
    return 'future'
  }

  // Segment N (between step N and step N+1) is brand-green when step N is done
  // AND step N+1 has reached at least the current state (done or current).
  function segmentDone(i) {
    if (!isPersonalized) return false
    const a = renderSteps[i]
    const b = renderSteps[i + 1]
    if (!a || !b) return false
    return a.done && (b.done || i + 1 === currentIdx)
  }

  function labelColor(status) {
    return status === 'done' || status === 'current' ? 'text-white' : 'text-[#e5e5e5]/60'
  }

  return (
    <section className="max-w-6xl mx-auto px-6 py-12">
      <div className="text-center mb-10">
        <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3">How it works</p>
        <h2 className="text-2xl md:text-3xl font-black text-white mb-2">
          {isPersonalized
            ? `Your ${eventName ?? 'event'} progress`
            : `Path to ${eventName ?? 'the event'}`}
        </h2>
        {isPersonalized && (
          <p className="text-brand text-sm font-semibold">
            {doneCount} of {renderSteps.length} complete
          </p>
        )}
      </div>

      {/* Desktop: horizontal numbered timeline */}
      <div
        className="hidden md:grid gap-2"
        style={{ gridTemplateColumns: `repeat(${renderSteps.length}, minmax(0, 1fr))` }}
      >
        {renderSteps.map((step, i) => {
          const status = statusFor(i, step)
          const showLine = i < renderSteps.length - 1
          const lineGreen = segmentDone(i)

          const inner = (
            <div className="relative flex flex-col items-center text-center px-2 h-full">
              {showLine && (
                <div
                  aria-hidden
                  className={`absolute h-0.5 ${lineGreen ? 'bg-brand' : 'bg-line'}`}
                  style={{ top: '23px', left: 'calc(50% + 24px)', width: 'calc(100% - 48px)' }}
                />
              )}
              <StepCircle index={i} status={status} />
              <p className={`mt-3 text-sm font-bold leading-snug ${labelColor(status)}`}>
                {step.label}
              </p>
              {step.description && (
                <p className="mt-1 text-xs text-[#e5e5e5]/40 leading-snug">
                  {step.description}
                </p>
              )}
              {step.optional && <OptionalPill />}
            </div>
          )

          if (isPersonalized && step.href && !step.done) {
            return (
              <Link key={i} to={step.href} className="hover:opacity-80 transition-opacity">
                {inner}
              </Link>
            )
          }
          return <div key={i}>{inner}</div>
        })}
      </div>

      {/* Mobile: vertical numbered timeline */}
      <div className="md:hidden">
        {renderSteps.map((step, i) => {
          const status = statusFor(i, step)
          const isLast = i === renderSteps.length - 1
          const lineGreen = segmentDone(i)

          const inner = (
            <div className="flex items-stretch gap-4">
              <div className="flex flex-col items-center">
                <StepCircle index={i} status={status} />
                {!isLast && (
                  <div
                    aria-hidden
                    className={`w-0.5 flex-1 my-2 min-h-[24px] ${lineGreen ? 'bg-brand' : 'bg-line'}`}
                  />
                )}
              </div>
              <div className={`flex-1 min-w-0 pt-2.5 ${isLast ? '' : 'pb-6'}`}>
                <p className={`text-sm font-bold leading-snug ${labelColor(status)}`}>
                  {step.label}
                </p>
                {step.description && (
                  <p className="text-xs text-[#e5e5e5]/40 mt-0.5 leading-snug">
                    {step.description}
                  </p>
                )}
                {step.optional && <OptionalPill />}
              </div>
            </div>
          )

          if (isPersonalized && step.href && !step.done) {
            return (
              <Link key={i} to={step.href} className="block hover:opacity-80 transition-opacity">
                {inner}
              </Link>
            )
          }
          return <div key={i}>{inner}</div>
        })}
      </div>
    </section>
  )
}
