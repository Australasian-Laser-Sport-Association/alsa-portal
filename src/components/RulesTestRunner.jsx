import { useState } from 'react'
import { Link } from 'react-router-dom'
import Footer from './Footer'
import { ShieldAlert, BookOpen, ShieldCheck, AlertTriangle } from 'lucide-react'

// Single source of truth for the Rules Test taking experience — used by both
// the player route (src/pages/RefereeTest.jsx) and the admin preview overlay
// (src/pages/admin/AdminRefereeTest.jsx). Owns the phase machine
// (intro → safety-intro → running → general-intro → running → results),
// per-attempt question + option shuffling, per-section scoring and the themed
// banners. The host supplies data + side effects:
//
//   settings      — { safety_questions_per_test, safety_pass_score,
//                      general_questions_per_test, general_pass_score }
//   questionPool  — { safety: [...activeSafety], general: [...activeGeneral] }
//   onComplete    — async (result) => void   (player: POST result; preview: omit)
//   isPreview     — render preview-flavoured CTAs (no player-hub links / no save)
//   existingResult— { passed, score } | null  (player only; shown on intro)
//   onExit        — () => void  (preview: close overlay)

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Displayed option labels are positional (A/B/C/D by render order), NOT the
// question's canonical option letter — options are shuffled per question, so a
// fixed letter would be meaningless. Scoring matches the chosen option's
// original `letter` back to correct_answer, independent of displayed position.
const OPT_LABEL = ['A', 'B', 'C', 'D']

// Per-question, per-attempt option order. Each option keeps its original letter
// so scoring stays correct regardless of displayed position. Edge case: fewer
// than 4 distinct options (or duplicates) → warn but still shuffle gracefully.
function prepareQuestion(q) {
  const opts = ['a', 'b', 'c', 'd']
    .map(letter => ({ letter, text: q[`option_${letter}`] }))
    .filter(o => o.text != null && o.text !== '')
  const texts = opts.map(o => o.text)
  if (opts.length < 4 || new Set(texts).size !== texts.length) {
    console.warn(`[RulesTest] Question ${q.id} has fewer than 4 distinct options — shuffling what is present.`, q.question)
  }
  return { ...q, options: shuffle(opts) }
}

export default function RulesTestRunner({
  settings,
  questionPool,
  onComplete,
  isPreview = false,
  existingResult = null,
  onExit,
}) {
  // Normalise settings (admin inputs arrive as strings).
  const cfg = {
    safetyCount: parseInt(settings?.safety_questions_per_test) || 10,
    safetyPass: parseInt(settings?.safety_pass_score) || 100,
    generalCount: parseInt(settings?.general_questions_per_test) || 20,
    generalPass: parseInt(settings?.general_pass_score) || 70,
  }
  const safetyPool = questionPool?.safety ?? []
  const generalPool = questionPool?.general ?? []
  const hasAnyQuestions = safetyPool.length + generalPool.length > 0

  const [phase, setPhase] = useState('intro') // intro | safety-intro | running | safety-result | general-intro | results
  const [questions, setQuestions] = useState([]) // composed attempt (safety first, then general)
  const [idx, setIdx] = useState(0)
  const [selected, setSelected] = useState(null) // chosen option's original letter
  const [answered, setAnswered] = useState(false)
  const [answers, setAnswers] = useState([])
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState('')

  // Compose one attempt: a fresh sample of Safety questions, then a fresh sample
  // of General questions, each with freshly shuffled options. Pools smaller than
  // the requested count fall back to all available.
  function composeAttempt() {
    const sCount = Math.min(cfg.safetyCount, safetyPool.length)
    const gCount = Math.min(cfg.generalCount, generalPool.length)
    const safety = shuffle(safetyPool).slice(0, sCount).map(prepareQuestion)
    const general = shuffle(generalPool).slice(0, gCount).map(prepareQuestion)
    return [...safety, ...general]
  }

  function startTest() {
    const composed = composeAttempt()
    setQuestions(composed)
    setIdx(0)
    setSelected(null)
    setAnswered(false)
    setAnswers([])
    setSaveErr('')
    // Lead with the themed Safety intro; a general-only attempt (no active
    // Safety questions) skips straight to the General intro.
    setPhase(composed.some(q => q.section === 'safety') ? 'safety-intro' : 'general-intro')
  }

  function beginSafety() { setPhase('running') }
  function continueToGeneral() { setPhase('running') }

  // From the Safety result gate: passing players proceed to the General intro
  // (or straight to results if this attempt has no General questions).
  function continueAfterSafety() {
    const generalRemaining = questions.some(q => q.section !== 'safety')
    if (generalRemaining) setPhase('general-intro')
    else finishTest()
  }

  // Failing players retake Safety from scratch — a fresh composeAttempt()
  // reshuffles the sample, question order and option order, clears all answers,
  // and returns to the Safety intro as a clean reset moment. Failed attempts
  // are never saved; only the final successful run is posted at the end.
  function retakeSafety() {
    startTest()
  }

  async function finishTest() {
    setPhase('results')

    const safetyTotal    = questions.filter(q => q.section === 'safety').length
    const generalTotal   = questions.length - safetyTotal
    const safetyCorrect  = answers.filter(a => a.q.section === 'safety' && a.isCorrect).length
    const generalCorrect = answers.filter(a => a.q.section !== 'safety' && a.isCorrect).length

    const totalCorrect = safetyCorrect + generalCorrect
    const pct = questions.length > 0 ? Math.min(Math.round((totalCorrect / questions.length) * 100), 100) : 0

    const safetyPct     = safetyTotal > 0 ? Math.round((safetyCorrect / safetyTotal) * 100) : 100
    const safetyPassed  = safetyPct >= cfg.safetyPass
    const generalPct    = generalTotal > 0 ? Math.round((generalCorrect / generalTotal) * 100) : 100
    const generalPassed = generalPct >= cfg.generalPass
    const passed = safetyPassed && generalPassed

    if (onComplete) {
      setSaving(true)
      setSaveErr('')
      try {
        await onComplete({
          score: pct, passed,
          safety_correct: safetyCorrect, safety_total: safetyTotal,
          general_correct: generalCorrect, general_total: generalTotal,
          safety_passed: safetyPassed, general_passed: generalPassed,
        })
      } catch (err) {
        setSaveErr(err.message)
      } finally {
        setSaving(false)
      }
    }
  }

  function selectAnswer(letter) {
    if (answered) return
    const q = questions[idx]
    setSelected(letter)
    setAnswered(true)
    // No mid-test feedback — record the answer (matched by original letter) and
    // reveal nothing until the final results page.
    setAnswers(prev => [...prev, { q, selected: letter, isCorrect: letter === q.correct_answer }])
  }

  function next() {
    const nextIdx = idx + 1
    const safetyCount = questions.filter(q => q.section === 'safety').length
    // Just answered the last Safety question → the Safety result gate (the
    // player must pass before General). Checked before the end-of-test guard so
    // a safety-only attempt still gets the gate.
    if (safetyCount > 0 && nextIdx === safetyCount) {
      setIdx(nextIdx)
      setSelected(null)
      setAnswered(false)
      setPhase('safety-result')
      return
    }
    if (nextIdx >= questions.length) { finishTest(); return }
    setIdx(nextIdx)
    setSelected(null)
    setAnswered(false)
  }

  // ── Empty (no active questions) ────────────────────────────────────────────
  if (!hasAnyQuestions) {
    return (
      <div className="min-h-screen bg-base flex flex-col items-center justify-center text-center px-6">
        <p className="text-4xl mb-4">📋</p>
        <h1 className="text-2xl font-black text-white mb-2">{isPreview ? 'No Active Questions' : 'No Questions Available'}</h1>
        <p className="text-[#e5e5e5]/40 text-sm mb-6">
          {isPreview ? 'Add active questions before previewing the test.' : "The Rules Test hasn't been set up yet. Check back soon."}
        </p>
        {isPreview
          ? <button onClick={onExit} className="bg-brand hover:bg-brand-hover text-black font-bold px-6 py-3 rounded-xl text-sm transition-all">Exit Preview</button>
          : <Link to="/player-hub" className="text-brand text-sm font-semibold hover:underline">← Back to Player Hub</Link>}
      </div>
    )
  }

  // ── Derived per-render values ──────────────────────────────────────────────
  const currentQ = questions[idx]
  const safetyCount = questions.filter(q => q.section === 'safety').length
  const generalCount = questions.length - safetyCount
  const currentSection = idx < safetyCount ? 'safety' : 'general'
  const sectionTotal = currentSection === 'safety' ? safetyCount : generalCount
  const sectionPosition = currentSection === 'safety' ? idx + 1 : idx - safetyCount + 1
  const sectionProgress = sectionTotal > 0 ? (((sectionPosition - 1) + (answered ? 1 : 0)) / sectionTotal) * 100 : 0
  // Intro counts come from the pools (the attempt isn't composed until Start),
  // capped at the per-section sample size.
  const introSafetyCount = Math.min(cfg.safetyCount, safetyPool.length)
  const introGeneralCount = Math.min(cfg.generalCount, generalPool.length)
  const introTotal = introSafetyCount + introGeneralCount

  // ── Intro ────────────────────────────────────────────────────────────────
  if (phase === 'intro') {
    return (
      <div className="min-h-screen bg-base text-white">
        <div className="max-w-2xl mx-auto px-6 py-16">
          {!isPreview && (
            <Link to="/player-hub" className="text-[#e5e5e5]/40 hover:text-brand text-xs transition-colors mb-8 inline-block">
              ← Back to Player Hub
            </Link>
          )}

          {!isPreview && existingResult && (
            <div className={`rounded-xl border px-5 py-4 mb-6 ${existingResult.passed ? 'border-brand/30 bg-brand/5' : 'border-yellow-500/30 bg-yellow-500/5'}`}>
              <p className={`text-sm font-semibold ${existingResult.passed ? 'text-brand' : 'text-yellow-400'}`}>
                {existingResult.passed
                  ? `✓ You have already passed the Rules Test with ${existingResult.score}% — you can retake it below.`
                  : `✗ Your last attempt scored ${existingResult.score}% — retake below to pass.`}
              </p>
            </div>
          )}

          <div className="text-center mb-10">
            <div className="text-5xl mb-4">📋</div>
            <h1 className="text-3xl font-black text-white mb-2">Rules Test</h1>
            <p className="text-white text-base mb-8">
              Two sections, taken in order: <span className="font-semibold">Section 1 — Safety</span>, then
              <span className="font-semibold"> Section 2 — General Rules &amp; Regulations</span>. You must pass
              both. Results are shown at the end.
            </p>
          </div>

          <div className="bg-surface border border-line rounded-2xl p-6 mb-8 space-y-3">
            {[
              { label: 'Section 1 — Safety', value: `${introSafetyCount} questions · pass ${cfg.safetyPass}%` },
              { label: 'Section 2 — General', value: `${introGeneralCount} questions · pass ${cfg.generalPass}%` },
              { label: 'Total questions', value: introTotal },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-sm">
                <span className="text-[#e5e5e5]/40">{label}</span>
                <span className="text-white font-semibold">{value}</span>
              </div>
            ))}
          </div>

          <button
            onClick={startTest}
            className="w-full bg-brand hover:bg-brand-hover text-black font-bold py-4 rounded-xl text-base transition-all"
          >
            Start Test →
          </button>
        </div>
        <Footer />
      </div>
    )
  }

  // ── Section 1 intro — Safety (yellow themed) ───────────────────────────────
  if (phase === 'safety-intro') {
    return (
      <div className="min-h-screen bg-base text-white flex flex-col">
        <div className="flex-1 flex items-center justify-center px-5 py-12">
          <div className="w-full max-w-lg rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-7 sm:p-10 text-center">
            <ShieldAlert className="h-14 w-14 sm:h-16 sm:w-16 text-yellow-300 mx-auto mb-5" strokeWidth={1.75} />
            <p className="text-yellow-300/70 text-[11px] font-black uppercase tracking-widest mb-2">Section 1</p>
            <h1 className="text-2xl sm:text-3xl font-black text-white mb-3">Safety Section</h1>
            <p className="text-white text-sm sm:text-base font-semibold mb-4 leading-relaxed">
              The Safety Questions Section of This Test Requires {cfg.safetyPass}% Pass Rate
            </p>
            <p className="text-[#e5e5e5]/60 text-sm mb-8">
              {safetyCount} safety question{safetyCount === 1 ? '' : 's'}{cfg.safetyPass >= 100 ? ' — every answer must be correct' : ''}
            </p>
            <button
              onClick={beginSafety}
              className="w-full bg-yellow-400 hover:bg-yellow-300 text-black font-bold py-4 rounded-xl text-base transition-all"
            >
              Begin Safety Section →
            </button>
          </div>
        </div>
        <Footer />
      </div>
    )
  }

  // ── Safety result gate — player must pass Safety before General ────────────
  if (phase === 'safety-result') {
    const sTotal = safetyCount
    const sCorrect = answers.filter(a => a.q.section === 'safety' && a.isCorrect).length
    const sPct = sTotal > 0 ? Math.round((sCorrect / sTotal) * 100) : 100
    const sPassed = sPct >= cfg.safetyPass
    const hasGeneral = questions.some(q => q.section !== 'safety')
    return (
      <div className="min-h-screen bg-base text-white flex flex-col">
        <div className="flex-1 flex items-center justify-center px-5 py-12">
          <div className={`w-full max-w-lg rounded-2xl border p-7 sm:p-10 text-center ${sPassed ? 'border-yellow-500/30 bg-yellow-500/10' : 'border-red-400/40 bg-red-400/10'}`}>
            {sPassed
              ? <ShieldCheck className="h-14 w-14 sm:h-16 sm:w-16 text-yellow-300 mx-auto mb-5" strokeWidth={1.75} />
              : <AlertTriangle className="h-14 w-14 sm:h-16 sm:w-16 text-red-400 mx-auto mb-5" strokeWidth={1.75} />}
            <p className={`text-[11px] font-black uppercase tracking-widest mb-2 ${sPassed ? 'text-yellow-300/70' : 'text-red-400/80'}`}>Section 1 — Safety</p>
            <h1 className="text-2xl sm:text-3xl font-black text-white mb-3">
              {sPassed ? 'Safety Section Passed ✓' : 'Safety Section Not Passed'}
            </h1>
            <p className="text-white text-base font-semibold mb-1">{sCorrect} of {sTotal} correct ({sPct}%)</p>
            <p className="text-[#e5e5e5]/70 text-sm mb-8">
              {sPassed
                ? `Required: ${cfg.safetyPass}%`
                : `Required: ${cfg.safetyPass}% — please review and retake the safety section`}
            </p>
            {sPassed ? (
              <button
                onClick={continueAfterSafety}
                className="w-full bg-yellow-400 hover:bg-yellow-300 text-black font-bold py-4 rounded-xl text-base transition-all"
              >
                {hasGeneral ? 'Continue to General Rules Section →' : 'See Results →'}
              </button>
            ) : (
              <button
                onClick={retakeSafety}
                className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-4 rounded-xl text-base transition-all"
              >
                Retake Safety Section
              </button>
            )}
          </div>
        </div>
        <Footer />
      </div>
    )
  }

  // ── Section 2 intro — General Rules & Regulations (ALSA green themed) ───────
  if (phase === 'general-intro') {
    return (
      <div className="min-h-screen bg-base text-white flex flex-col">
        <div className="flex-1 flex items-center justify-center px-5 py-12">
          <div className="w-full max-w-lg rounded-2xl border border-brand/30 bg-brand/10 p-7 sm:p-10 text-center">
            <BookOpen className="h-14 w-14 sm:h-16 sm:w-16 text-brand mx-auto mb-5" strokeWidth={1.75} />
            <p className="text-brand/70 text-[11px] font-black uppercase tracking-widest mb-2">Section 2</p>
            <h1 className="text-2xl sm:text-3xl font-black text-white mb-3">General Rules &amp; Regulations</h1>
            <p className="text-[#e5e5e5]/60 text-sm mb-8">
              {generalCount} question{generalCount === 1 ? '' : 's'} — requires {cfg.generalPass}% to pass
            </p>
            <button
              onClick={continueToGeneral}
              className="w-full bg-brand hover:bg-brand-hover text-black font-bold py-4 rounded-xl text-base transition-all"
            >
              Continue to General Section →
            </button>
          </div>
        </div>
        <Footer />
      </div>
    )
  }

  // ── Running ──────────────────────────────────────────────────────────────
  if (phase === 'running' && currentQ) {
    return (
      <div className="min-h-screen bg-base text-white">
        <div className="max-w-2xl mx-auto px-6 py-10">

          {/* Persistent themed section banner — yellow for Safety, green for
              General — carries the section, its pass rule and the progress
              count. Wraps + scales on narrow viewports. */}
          <div className={`rounded-xl border px-3 sm:px-4 py-3 mb-4 flex items-center gap-3 ${
            currentSection === 'safety' ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-brand/10 border-brand/30'
          }`}>
            {currentSection === 'safety'
              ? <ShieldAlert className="h-5 w-5 text-yellow-300 flex-shrink-0" />
              : <BookOpen className="h-5 w-5 text-brand flex-shrink-0" />}
            <div className="min-w-0 flex-1">
              <p className={`text-xs sm:text-sm font-bold leading-snug ${currentSection === 'safety' ? 'text-yellow-300' : 'text-brand'}`}>
                {currentSection === 'safety'
                  ? `Safety Section — ${cfg.safetyPass}% pass required`
                  : `General Rules & Regulations — ${cfg.generalPass}% pass required`}
              </p>
              <p className="text-[#e5e5e5]/50 text-[11px] sm:text-xs mt-0.5">Question {sectionPosition} of {sectionTotal}</p>
            </div>
          </div>

          {/* Progress (within current section), themed to the section colour */}
          <div className="h-1.5 bg-line rounded-full mb-6 overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-300 ${currentSection === 'safety' ? 'bg-yellow-400' : 'bg-brand'}`} style={{ width: `${sectionProgress}%` }} />
          </div>

          {/* Category (contextual tag) */}
          <p className="text-[10px] text-[#e5e5e5]/30 font-bold uppercase tracking-widest mb-4">{currentQ.category}</p>

          {/* Question media — image and/or video, shown above the text.
              Aspect preserved (no crop), capped width, no autoplay. */}
          {currentQ.image_url && (
            <img src={currentQ.image_url} alt="" className="w-full max-w-[600px] h-auto rounded-xl border border-line mb-6" />
          )}
          {currentQ.video_url && (
            <video src={currentQ.video_url} controls className="w-full max-w-[600px] h-auto rounded-xl border border-line mb-6" />
          )}

          {/* Question */}
          <h2 className="text-xl font-bold text-white mb-8 leading-relaxed">{currentQ.question}</h2>

          {/* Options — shuffled per question. Selecting highlights the choice
              (no correct/wrong reveal). */}
          <div className="space-y-3 mb-8">
            {currentQ.options.map((opt, i) => {
              const isSelected = opt.letter === selected
              const cls = isSelected
                ? 'border-brand bg-brand/10 text-white'
                : answered
                  ? 'border-line bg-surface text-[#e5e5e5]/30 cursor-default'
                  : 'border-line bg-surface text-[#e5e5e5]/80 hover:border-brand/50 hover:text-white cursor-pointer'

              return (
                <button
                  key={opt.letter}
                  onClick={() => selectAnswer(opt.letter)}
                  disabled={answered}
                  className={`w-full flex items-center gap-4 px-5 py-4 rounded-xl border-2 text-left transition-all ${cls}`}
                >
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 border ${
                    isSelected ? 'bg-brand text-black border-brand' : 'border-current'
                  }`}>
                    {OPT_LABEL[i]}
                  </span>
                  <span className="text-sm font-medium leading-snug flex-1">{opt.text}</span>
                </button>
              )
            })}
          </div>

          {answered && (
            <button
              onClick={next}
              className="w-full bg-brand hover:bg-brand-hover text-black font-bold py-3.5 rounded-xl text-sm transition-all"
            >
              {(safetyCount > 0 && idx + 1 === safetyCount)
                ? 'Finish Safety Section →'
                : (idx + 1 >= questions.length ? 'See Results →' : 'Next Question →')}
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── Results ──────────────────────────────────────────────────────────────
  if (phase === 'results') {
    const finalAnswers = answers
    const resSafetyTotal    = questions.filter(q => q.section === 'safety').length
    const resGeneralTotal   = questions.length - resSafetyTotal
    const resSafetyCorrect  = finalAnswers.filter(a => a.q.section === 'safety' && a.isCorrect).length
    const resGeneralCorrect = finalAnswers.filter(a => a.q.section !== 'safety' && a.isCorrect).length
    const finalCorrect = resSafetyCorrect + resGeneralCorrect
    const finalPct = questions.length > 0 ? Math.min(Math.round((finalCorrect / questions.length) * 100), 100) : 0
    const safetyPct     = resSafetyTotal > 0 ? Math.round((resSafetyCorrect / resSafetyTotal) * 100) : 100
    const safetyPassed  = safetyPct >= cfg.safetyPass
    const generalPct    = resGeneralTotal > 0 ? Math.round((resGeneralCorrect / resGeneralTotal) * 100) : 100
    const generalPassed = generalPct >= cfg.generalPass
    const finalPassed = safetyPassed && generalPassed

    return (
      <div className="min-h-screen bg-base text-white">
        <div className="max-w-2xl mx-auto px-6 py-10">

          {/* Score card */}
          <div className={`rounded-2xl border-2 p-8 text-center mb-8 ${finalPassed ? 'border-brand/40 bg-brand/5' : 'border-red-400/40 bg-red-400/5'}`}>
            <p className={`text-6xl font-black mb-2`} style={{ color: finalPassed ? '#00E6FF' : '#f87171' }}>
              {finalCorrect}/{questions.length}
            </p>
            <p className="text-3xl font-black text-white mb-1">{finalPct}%</p>
            <span className={`inline-block text-sm font-black uppercase tracking-widest px-4 py-1.5 rounded-full mt-2 ${
              finalPassed ? 'bg-brand/20 text-brand' : 'bg-red-400/20 text-red-400'
            }`}>
              {finalPassed ? '✓ PASSED' : '✗ FAILED'}
            </span>
            {!isPreview && saving && <p className="text-[#e5e5e5]/40 text-xs mt-2">Saving result…</p>}
            {!isPreview && saveErr && <p className="text-red-400 text-xs mt-2">Error saving: {saveErr}</p>}
            {isPreview && <p className="text-[#e5e5e5]/30 text-xs mt-3">Preview only — this result is not saved.</p>}
          </div>

          {/* Section breakdown — each section uses its own configured pass rate. */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            {[
              { label: 'Safety', correct: resSafetyCorrect, total: resSafetyTotal, passed: safetyPassed, rule: `pass ${cfg.safetyPass}%` },
              { label: 'General Rules', correct: resGeneralCorrect, total: resGeneralTotal, passed: generalPassed, rule: `pass ${cfg.generalPass}%` },
            ].map(s => (
              <div key={s.label} className={`rounded-xl border p-4 ${s.passed ? 'border-brand/30 bg-brand/5' : 'border-red-400/30 bg-red-400/5'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#e5e5e5]/50">{s.label}</span>
                  <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${s.passed ? 'bg-brand/20 text-brand' : 'bg-red-400/20 text-red-400'}`}>
                    {s.passed ? 'Pass' : 'Fail'}
                  </span>
                </div>
                <p className="text-white font-black text-lg">{s.correct}/{s.total}</p>
                <p className="text-[#e5e5e5]/35 text-[10px] mt-0.5">{s.rule}</p>
              </div>
            ))}
          </div>

          {!finalPassed && (
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-5 py-4 mb-6">
              <p className="text-yellow-400 text-sm font-semibold">
                {!safetyPassed && !generalPassed
                  ? `You need ${cfg.safetyPass}% on Safety and ${cfg.generalPass}% on General. Retake below.`
                  : !safetyPassed
                    ? `You need ${cfg.safetyPass}% on the Safety section. Retake below.`
                    : `You need ${cfg.generalPass}% on the General section. Retake below.`}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 mb-8">
            {isPreview ? (
              <>
                <button
                  onClick={onExit}
                  className="flex-1 py-3 rounded-xl border border-line text-[#e5e5e5]/60 hover:text-white font-bold text-sm text-center transition-colors"
                >
                  Exit Preview
                </button>
                <button
                  onClick={startTest}
                  className="flex-1 py-3 rounded-xl bg-brand hover:bg-brand-hover text-black font-bold text-sm transition-all"
                >
                  Run Again
                </button>
              </>
            ) : (
              <>
                <Link
                  to="/player-hub"
                  className="flex-1 py-3 rounded-xl border border-line text-[#e5e5e5]/60 hover:text-white font-bold text-sm text-center transition-colors"
                >
                  Back to Player Hub
                </Link>
                {!finalPassed && (
                  <button
                    onClick={startTest}
                    className="flex-1 py-3 rounded-xl bg-brand hover:bg-brand-hover text-black font-bold text-sm transition-all"
                  >
                    Retake Test
                  </button>
                )}
              </>
            )}
          </div>

          {/* Breakdown — first reveal of answers. Option letters are omitted
              because options were shuffled during the test; the text is shown. */}
          <h3 className="text-white font-bold text-base mb-4">Question Breakdown</h3>
          <div className="space-y-3">
            {finalAnswers.map((a, i) => {
              const selText = a.q[`option_${a.selected}`]
              const corrText = a.q[`option_${a.q.correct_answer}`]
              return (
                <div key={i} className={`rounded-xl border p-4 ${a.isCorrect ? 'border-brand/20 bg-brand/5' : 'border-red-400/20 bg-red-400/5'}`}>
                  <div className="flex items-start gap-2 mb-2">
                    <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-black mt-0.5 ${a.isCorrect ? 'bg-brand text-black' : 'bg-red-400 text-white'}`}>
                      {a.isCorrect ? '✓' : '✗'}
                    </span>
                    <div>
                      <p className="text-white text-sm font-medium leading-snug">{a.q.question}</p>
                      <span className="text-[10px] text-[#e5e5e5]/30 font-bold uppercase tracking-wider">
                        {a.q.section === 'safety' ? 'Safety' : 'General'}
                      </span>
                    </div>
                  </div>
                  {!a.isCorrect && (
                    <div className="ml-7 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-red-400/60 w-24 flex-shrink-0">Your answer:</span>
                        <span className="text-xs text-red-400 font-medium bg-red-400/10 px-2 py-0.5 rounded">{selText}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-brand/60 w-24 flex-shrink-0">Correct:</span>
                        <span className="text-xs text-brand font-medium bg-brand/10 px-2 py-0.5 rounded">{corrText}</span>
                      </div>
                    </div>
                  )}
                  {a.isCorrect && (
                    <p className="ml-7 text-xs text-brand/60">{selText}</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        <Footer />
      </div>
    )
  }

  return null
}
