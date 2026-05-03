// Static "How it works" illustration shown to everyone on the EventPage.
// No personalized progress state — purely educational.

const ICON_PROPS = {
  width: 28,
  height: 28,
  viewBox: '0 0 32 32',
  fill: 'none',
  stroke: '#00FF41',
  strokeWidth: 2.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

const PersonIcon = () => (
  <svg {...ICON_PROPS}>
    <circle cx="16" cy="11" r="5" />
    <path d="M5 28 C5 20 9 17 16 17 C23 17 27 20 27 28" />
  </svg>
)

const TeamShieldIcon = () => (
  <svg {...ICON_PROPS}>
    <path d="M16 4 L27 8 V16 C27 22 22 27 16 29 C10 27 5 22 5 16 V8 Z" />
    <circle cx="12" cy="14" r="1.5" fill="#00FF41" stroke="none" />
    <circle cx="20" cy="14" r="1.5" fill="#00FF41" stroke="none" />
    <circle cx="16" cy="20" r="1.5" fill="#00FF41" stroke="none" />
  </svg>
)

const CocDocumentIcon = () => (
  <svg {...ICON_PROPS}>
    <path d="M9 4 H20 L24 8 V28 H9 Z" />
    <line x1="13" y1="13" x2="21" y2="13" />
    <line x1="13" y1="18" x2="21" y2="18" />
    <line x1="13" y1="23" x2="19" y2="23" />
  </svg>
)

const CameraIcon = () => (
  <svg {...ICON_PROPS}>
    <path d="M11 9 L13 6 H19 L21 9" />
    <rect x="4" y="9" width="24" height="17" rx="2" />
    <circle cx="16" cy="17" r="5" />
  </svg>
)

const SideEventsIcon = () => (
  <svg {...ICON_PROPS}>
    <circle cx="11" cy="11" r="5" />
    <circle cx="21" cy="13" r="5" />
    <circle cx="14" cy="22" r="5" />
  </svg>
)

const PaymentIcon = () => (
  <svg {...ICON_PROPS}>
    <rect x="4" y="8" width="24" height="16" rx="2" />
    <line x1="4" y1="13" x2="28" y2="13" />
    <line x1="9" y1="19" x2="13" y2="19" />
  </svg>
)

const TargetIcon = () => (
  <svg {...ICON_PROPS}>
    <circle cx="16" cy="16" r="11" />
    <circle cx="16" cy="16" r="7" />
    <circle cx="16" cy="16" r="3" fill="#00FF41" stroke="none" />
  </svg>
)

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
    { Icon: TargetIcon, label: 'All done!', description: `Fully registered for ${safeName}. See you on the day.`, isFinal: true },
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
