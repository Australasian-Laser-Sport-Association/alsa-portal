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

function StepDot({ done }) {
  if (done) {
    return (
      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-brand text-black text-sm font-black">
        ✓
      </div>
    )
  }
  return (
    <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-[#191919] border-2 border-line text-[#e5e5e5]/40 text-xs font-bold">
      ·
    </div>
  )
}

export default function RegistrationTimeline({ mode, steps, eventName }) {
  const isPersonalized = mode === 'personalized'
  const renderSteps = isPersonalized ? steps : EDUCATIONAL_STEPS.map(s => ({ ...s, done: false }))

  if (!renderSteps?.length) return null

  const doneCount = isPersonalized ? renderSteps.filter(s => s.done).length : 0

  return (
    <section className="max-w-2xl mx-auto px-6 py-12">
      <div className="text-center mb-8">
        <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3">How it works</p>
        <h2 className="text-2xl md:text-3xl font-black text-white mb-2">
          {isPersonalized
            ? `Your ${eventName ?? 'event'} progress`
            : `Path to ${eventName ?? 'the event'}`}
        </h2>
        {isPersonalized && (
          <p className="text-[#e5e5e5]/40 text-sm">
            {doneCount} of {renderSteps.length} steps complete
          </p>
        )}
      </div>

      <div className="bg-surface border border-line rounded-2xl divide-y divide-line">
        {renderSteps.map((step, i) => {
          const content = (
            <div className={`flex items-start gap-4 px-5 py-4 ${step.href && !step.done ? 'hover:bg-line/30 transition-colors' : ''}`}>
              <StepDot done={step.done} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className={`text-sm font-semibold ${step.done ? 'text-white' : 'text-[#e5e5e5]/70'}`}>
                    {step.label}
                  </p>
                  {step.optional && (
                    <span className="text-[10px] bg-[#191919] text-[#e5e5e5]/40 border border-line px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">
                      If applicable
                    </span>
                  )}
                </div>
                {step.description && (
                  <p className="text-xs text-[#e5e5e5]/35 mt-0.5">{step.description}</p>
                )}
              </div>
            </div>
          )

          if (isPersonalized && step.href && !step.done) {
            return <Link key={i} to={step.href} className="block">{content}</Link>
          }
          return <div key={i}>{content}</div>
        })}
      </div>
    </section>
  )
}
