import {
  PersonIcon,
  TeamShieldIcon,
  CocDocumentIcon,
  CameraIcon,
  SideEventsIcon,
  PaymentIcon,
  TargetIcon,
} from './icons.jsx'

// Static "How it works" illustration shown to everyone on the EventPage.
// No personalized progress state — purely educational.

function StepCircle({ Icon, isFinal }) {
  const base = 'relative w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0'
  if (isFinal) {
    return (
      <div className={`${base} bg-brand/10 border-2 border-brand/60 shadow-[0_0_20px_rgba(0,255,65,0.25)]`}>
        <Icon />
      </div>
    )
  }
  return (
    <div className={`${base} bg-base border-2 border-line shadow-[inset_0_0_12px_rgba(0,255,65,0.08)]`}>
      <Icon />
    </div>
  )
}

export default function RegistrationTimeline({ eventName }) {
  const safeName = eventName ?? 'the event'
  const steps = [
    { Icon: PersonIcon, label: 'Register as a player', description: 'Create your ALSA account and sign up for the event.' },
    { Icon: TeamShieldIcon, label: 'Join or create a team', description: 'Use a captain\'s invite code, or start a new team and invite others.' },
    { Icon: CocDocumentIcon, label: 'Sign the Code of Conduct', description: 'Agree to the ALSA Code of Conduct before the event.' },
    { Icon: CameraIcon, label: 'Sign the Media Release', description: 'Confirm consent for event photos and footage.' },
    { Icon: SideEventsIcon, label: 'Confirm side events', description: 'Choose your side events (Solos, Doubles, Triples, etc.).' },
    { Icon: PaymentIcon, label: 'Pay your fees', description: 'Settle your registration and side event fees.' },
    { Icon: TargetIcon, label: 'All done!', description: `Fully registered for ${safeName}.`, isFinal: true },
  ]

  return (
    <section className="max-w-6xl mx-auto px-6 py-12">
      <div className="text-center mb-10">
        <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3">How it works</p>
        <h2 className="text-2xl md:text-3xl font-black text-white">
          Register for {safeName}
        </h2>
      </div>

      {/* Desktop: horizontal */}
      <div
        className="hidden md:grid gap-2"
        style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      >
        {steps.map((step, i) => {
          const showLine = i < steps.length - 1
          return (
            <div key={i} className="relative flex flex-col items-center text-center px-2 h-full">
              {showLine && (
                <div
                  aria-hidden
                  className="absolute h-0.5 bg-line"
                  style={{ top: '27px', left: 'calc(50% + 28px)', width: 'calc(100% - 56px)' }}
                />
              )}
              <StepCircle Icon={step.Icon} isFinal={step.isFinal} />
              <p className={`mt-3 text-sm font-bold leading-snug ${step.isFinal ? 'text-brand' : 'text-white'}`}>
                {step.label}
              </p>
              {step.description && (
                <p className="mt-1 text-xs text-[#e5e5e5]/40 leading-snug">
                  {step.description}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {/* Mobile: vertical */}
      <div className="md:hidden">
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1
          return (
            <div key={i} className="flex items-stretch gap-4">
              <div className="flex flex-col items-center">
                <StepCircle Icon={step.Icon} isFinal={step.isFinal} />
                {!isLast && (
                  <div aria-hidden className="w-0.5 flex-1 my-2 min-h-[24px] bg-line" />
                )}
              </div>
              <div className={`flex-1 min-w-0 pt-3.5 ${isLast ? '' : 'pb-6'}`}>
                <p className={`text-sm font-bold leading-snug ${step.isFinal ? 'text-brand' : 'text-white'}`}>
                  {step.label}
                </p>
                {step.description && (
                  <p className="text-xs text-[#e5e5e5]/40 mt-0.5 leading-snug">
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
