import {
  PersonIcon,
  TeamShieldIcon,
  CocDocumentIcon,
  RefTestIcon,
  CameraIcon,
  SideEventsIcon,
  PaymentIcon,
  TargetIcon,
} from './icons.jsx'

// Personalized status timeline for PlayerHub. Mirrors the shape of the
// EventPage RegistrationTimeline but per-step state changes by checklist
// completion.

function StepCircle({ Icon, status }) {
  const base = 'relative w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0'
  if (status === 'done') {
    return (
      <div className={`${base} bg-brand border-2 border-brand text-black text-2xl font-black`}>
        ✓
      </div>
    )
  }
  if (status === 'celebration') {
    return (
      <div className={`${base} bg-brand/10 border-2 border-brand/60 shadow-[0_0_20px_rgba(0,255,65,0.25)]`}>
        <Icon />
      </div>
    )
  }
  if (status === 'current') {
    return (
      <div className={`${base} bg-base border-2 border-brand shadow-[0_0_20px_rgba(0,255,65,0.4)]`}>
        <Icon />
      </div>
    )
  }
  if (status === 'pending') {
    return (
      <div className={`${base} bg-yellow-500/10 border-2 border-yellow-400/60 text-yellow-300 text-xl font-black`}>
        …
      </div>
    )
  }
  // future
  return (
    <div className={`${base} bg-base border-2 border-line opacity-40`}>
      <Icon />
    </div>
  )
}

export default function PlayerHubProgress({
  eventName,
  readiness,
}) {
  const safeName = eventName ?? 'the event'
  const checks = readiness?.checks ?? {}
  const status = key => checks[key]?.status
  const eventDone = key => status(key) === 'satisfied' || status(key) === 'not_required'
  const playerDone = key => eventDone(key) || status(key) === 'pending_review'
  const include = key => status(key) !== 'not_required'

  const baseSteps = [
    { key: 'identity', Icon: PersonIcon, label: 'Register as a player', description: 'Your current-event identity details are recorded.' },
    ...(include('team') ? [{ key: 'team', Icon: TeamShieldIcon, label: 'Join or create a team', description: 'Join a team and wait for committee approval if required.' }] : []),
    ...(include('code_of_conduct') ? [{ key: 'code_of_conduct', Icon: CocDocumentIcon, label: 'Agree to the Code of Conduct', description: 'Review and accept the current version.' }] : []),
    ...(include('referee_test') ? [{ key: 'referee_test', Icon: RefTestIcon, label: 'Pass the Rules Test', description: 'Complete the rules knowledge test.' }] : []),
    ...(include('media_release') ? [{ key: 'media_release', Icon: CameraIcon, label: 'Confirm Media Consent', description: 'Review the current release and record your consent.' }] : []),
    ...(include('side_events') ? [{ key: 'side_events', Icon: SideEventsIcon, label: 'Confirm side events', description: 'Confirm selections and any required partner rosters.' }] : []),
    ...(include('extras') ? [{ key: 'extras', Icon: SideEventsIcon, label: 'Confirm extras', description: 'Confirm dinner guests and other event extras.' }] : []),
    ...(include('under_18') ? [{ key: 'under_18', Icon: CocDocumentIcon, label: 'Under-18 approval', description: 'Submit the current form and wait for committee approval.' }] : []),
    ...(include('payment') ? [{ key: 'payment', Icon: PaymentIcon, label: 'Pay your fees', description: 'Pay the full outstanding balance.' }] : []),
  ].map(step => ({
    ...step,
    done: eventDone(step.key),
    playerDone: playerDone(step.key),
    pendingReview: status(step.key) === 'pending_review',
  }))

  const allDone = readiness?.overall?.event_ready === true
  const doneCount = baseSteps.filter(s => s.playerDone).length

  const steps = [
    ...baseSteps,
    {
      Icon: TargetIcon,
      label: 'All done!',
      description: `Fully registered for ${safeName}. See you on the day.`,
      isFinal: true,
      done: allDone,
      playerDone: allDone,
    },
  ]

  // First non-done step is the "current" step.
  const currentIdx = steps.findIndex(s => !s.playerDone)

  function statusFor(i, step) {
    if (step.isFinal) return allDone ? 'celebration' : 'future'
    if (step.pendingReview) return 'pending'
    if (step.done) return 'done'
    if (i === currentIdx) return 'current'
    return 'future'
  }

  function labelColor(status) {
    if (status === 'celebration') return 'text-brand'
    if (status === 'done' || status === 'current') return 'text-white'
    if (status === 'pending') return 'text-yellow-300'
    return 'text-[#e5e5e5]/60'
  }

  // Segment N is brand-green when step N is done AND step N+1 has reached
  // at least the current state.
  function segmentDone(i) {
    const a = steps[i]
    const b = steps[i + 1]
    if (!a || !b) return false
    return a.playerDone && (b.playerDone || i + 1 === currentIdx)
  }

  return (
    <section className="py-8">
      <div className="text-center mb-8">
        <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3">Your progress</p>
        <h2 className="text-2xl md:text-3xl font-black text-white mb-2">
          {allDone
            ? `You're all set for ${safeName}`
            : readiness?.overall?.awaiting_committee
              ? 'Your actions are complete. Committee review is pending.'
              : `Your path to ${safeName}`}
        </h2>
        <p className="text-brand text-sm font-semibold">
          {doneCount} of {baseSteps.length} player actions complete
        </p>
      </div>

      {/* Desktop: horizontal */}
      <div
        className="hidden md:grid gap-2"
        style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      >
        {steps.map((step, i) => {
          const status = statusFor(i, step)
          const showLine = i < steps.length - 1
          const lineGreen = segmentDone(i)
          return (
            <div key={i} className="relative flex flex-col items-center text-center px-1 h-full">
              {showLine && (
                <div
                  aria-hidden
                  className={`absolute h-0.5 ${lineGreen ? 'bg-brand' : 'bg-line'}`}
                  style={{ top: '27px', left: 'calc(50% + 28px)', width: 'calc(100% - 56px)' }}
                />
              )}
              <StepCircle Icon={step.Icon} status={status} />
              <p className={`mt-3 text-xs font-bold leading-snug ${labelColor(status)}`}>
                {step.label}
              </p>
            </div>
          )
        })}
      </div>

      {/* Mobile: vertical */}
      <div className="md:hidden">
        {steps.map((step, i) => {
          const status = statusFor(i, step)
          const isLast = i === steps.length - 1
          const lineGreen = segmentDone(i)
          return (
            <div key={i} className="flex items-stretch gap-4">
              <div className="flex flex-col items-center">
                <StepCircle Icon={step.Icon} status={status} />
                {!isLast && (
                  <div aria-hidden className={`w-0.5 flex-1 my-2 min-h-[24px] ${lineGreen ? 'bg-brand' : 'bg-line'}`} />
                )}
              </div>
              <div className={`flex-1 min-w-0 pt-3.5 ${isLast ? '' : 'pb-6'}`}>
                <p className={`text-sm font-bold leading-snug ${labelColor(status)}`}>
                  {step.label}
                </p>
                {step.description && (
                  <p className="text-xs text-[#e5e5e5]/60 mt-0.5 leading-snug">
                    {step.description}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
