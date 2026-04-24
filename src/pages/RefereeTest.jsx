import { useState, useEffect, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/apiFetch.js'
import Footer from '../components/Footer'

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const OPT_LABEL = { a: 'A', b: 'B', c: 'C', d: 'D' }

export default function RefereeTest() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [phase, setPhase] = useState('loading') // loading | intro | running | results | error
  const [questions, setQuestions] = useState([])
  const [settings, setSettings] = useState({ pass_score: 70, time_limit_minutes: 30, questions_per_test: 20 })
  const [existingResult, setExistingResult] = useState(null)

  // Quiz state
  const [idx, setIdx] = useState(0)
  const [selected, setSelected] = useState(null)
  const [answered, setAnswered] = useState(false)
  const [answers, setAnswers] = useState([])
  const [timeLeft, setTimeLeft] = useState(null)
  const timerRef = useRef(null)

  // Results state
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState('')

  useEffect(() => {
    if (!authLoading && !user) { navigate('/login'); return }
    if (!user) return
    loadData()
  }, [authLoading, user]) // eslint-disable-line

  async function loadData() {
    const [{ data: qData }, { data: sData }] = await Promise.all([
      supabase.from('referee_questions').select('*').eq('active', true),
      supabase.from('referee_test_settings').select('*').limit(1).maybeSingle(),
    ])

    if (sData) setSettings({ pass_score: sData.pass_score ?? 70, time_limit_minutes: sData.time_limit_minutes ?? 30, questions_per_test: sData.questions_per_test ?? 20 })

    if (user) {
      const { data: existing } = await supabase
        .from('referee_test_results')
        .select('passed, score')
        .eq('user_id', user.id)
        .maybeSingle()
      setExistingResult(existing ?? null)
    }

    const active = qData ?? []
    if (active.length === 0) { setPhase('error'); return }

    const count = Math.min(sData?.questions_per_test ?? 20, active.length)
    setQuestions(shuffle(active).slice(0, count))
    setPhase('intro')
  }

  function startTest() {
    setIdx(0)
    setSelected(null)
    setAnswered(false)
    setAnswers([])
    const tl = settings.time_limit_minutes
    if (tl > 0) setTimeLeft(tl * 60)
    else setTimeLeft(null)
    setPhase('running')
  }

  async function finishTest() {
    clearTimeout(timerRef.current)
    setPhase('results')

    const correct = answers.filter(a => a.isCorrect).length
    const pct = questions.length > 0 ? Math.min(Math.round((correct / questions.length) * 100), 100) : 0
    const passed = pct >= settings.pass_score

    if (user) {
      setSaving(true)
      try {
        await apiFetch('/api/referee-test', {
          method: 'POST',
          body: JSON.stringify({ score: pct, passed, taken_at: new Date().toISOString() }),
        })
      } catch (err) {
        setSaveErr(err.message)
      }
      setSaving(false)
      setExistingResult({ passed, score: pct })
    }
  }

  // Ref tracks the latest finishTest so the timer effect invokes the current
  // closure (with up-to-date answers) at fire time. Adding finishTest to the
  // timer's deps would restart the countdown on every recorded answer; the
  // previous code masked this with an eslint-disable and relied on
  // per-tick re-runs to refresh the closure — brittle under React Compiler
  // or any future deps change.
  const finishTestRef = useRef(finishTest)
  useEffect(() => { finishTestRef.current = finishTest })

  // Timer
  useEffect(() => {
    if (phase !== 'running' || timeLeft === null) return
    if (timeLeft <= 0) { finishTestRef.current(); return }
    timerRef.current = setTimeout(() => setTimeLeft(t => t - 1), 1000)
    return () => clearTimeout(timerRef.current)
  }, [timeLeft, phase])

  function selectAnswer(opt) {
    if (answered) return
    const q = questions[idx]
    setSelected(opt)
    setAnswered(true)
    setAnswers(prev => [...prev, { q, selected: opt, isCorrect: opt === q.correct_answer }])
  }

  function next() {
    if (idx + 1 >= questions.length) { finishTest(); return }
    setIdx(i => i + 1)
    setSelected(null)
    setAnswered(false)
  }

  function fmtTime(s) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (authLoading || phase === 'loading') {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // ── Error (no questions) ─────────────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div className="min-h-screen bg-base flex flex-col items-center justify-center text-center px-6">
        <p className="text-4xl mb-4">📋</p>
        <h1 className="text-2xl font-black text-white mb-2">No Questions Available</h1>
        <p className="text-[#e5e5e5]/40 text-sm mb-6">The Referee Test hasn't been set up yet. Check back soon.</p>
        <Link to="/player-hub" className="text-brand text-sm font-semibold hover:underline">← Back to Player Hub</Link>
      </div>
    )
  }

  const correctCount = answers.filter(a => a.isCorrect).length
  const progress = questions.length > 0 ? ((idx + (answered ? 1 : 0)) / questions.length) * 100 : 0
  const currentQ = questions[idx]

  // ── Intro ────────────────────────────────────────────────────────────────
  if (phase === 'intro') {
    return (
      <div className="min-h-screen bg-base text-white">
        <div className="max-w-2xl mx-auto px-6 py-16">
          <Link to="/player-hub" className="text-[#e5e5e5]/40 hover:text-brand text-xs transition-colors mb-8 inline-block">
            ← Back to Player Hub
          </Link>

          {existingResult && (
            <div className={`rounded-xl border px-5 py-4 mb-6 ${existingResult.passed ? 'border-brand/30 bg-brand/5' : 'border-yellow-500/30 bg-yellow-500/5'}`}>
              <p className={`text-sm font-semibold ${existingResult.passed ? 'text-brand' : 'text-yellow-400'}`}>
                {existingResult.passed
                  ? `✓ You have already passed the Referee Test with ${existingResult.score}% — you can retake it below.`
                  : `✗ Your last attempt scored ${existingResult.score}% (pass mark: ${settings.pass_score}%) — retake below to pass.`}
              </p>
            </div>
          )}

          <div className="text-center mb-10">
            <div className="text-5xl mb-4">📋</div>
            <h1 className="text-3xl font-black text-white mb-2">Referee Test</h1>
            <p className="text-[#e5e5e5]/50 text-base mb-8">
              Test your knowledge of ZLTAC rules and refereeing standards.
            </p>
          </div>

          <div className="bg-surface border border-line rounded-2xl p-6 mb-8 space-y-3">
            {[
              { label: 'Questions', value: questions.length },
              { label: 'Pass mark', value: `${settings.pass_score}%` },
              { label: 'Time limit', value: settings.time_limit_minutes > 0 ? `${settings.time_limit_minutes} minutes` : 'No limit' },
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

  // ── Running ──────────────────────────────────────────────────────────────
  if (phase === 'running' && currentQ) {
    return (
      <div className="min-h-screen bg-base text-white">
        <div className="max-w-2xl mx-auto px-6 py-10">

          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-[#e5e5e5]/50 text-sm">
              Question {idx + 1} of {questions.length}
            </span>
            <div className="flex items-center gap-4">
              <span className="text-brand text-sm font-bold">{correctCount} correct</span>
              {timeLeft !== null && (
                <span className={`text-sm font-black tabular-nums ${timeLeft <= 60 ? 'text-red-400' : 'text-[#e5e5e5]/60'}`}>
                  ⏱ {fmtTime(timeLeft)}
                </span>
              )}
            </div>
          </div>

          {/* Progress */}
          <div className="h-1.5 bg-line rounded-full mb-8 overflow-hidden">
            <div className="h-full bg-brand rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>

          {/* Category */}
          <p className="text-xs text-[#e5e5e5]/30 font-bold uppercase tracking-widest mb-4">
            {currentQ.category}
          </p>

          {/* Question */}
          <h2 className="text-xl font-bold text-white mb-8 leading-relaxed">{currentQ.question}</h2>

          {/* Options */}
          <div className="space-y-3 mb-8">
            {['a', 'b', 'c', 'd'].map(opt => {
              const optText = currentQ[`option_${opt}`]
              if (!optText) return null
              const isCorrect = opt === currentQ.correct_answer
              const isSelected = opt === selected

              let cls = 'border-line bg-surface text-[#e5e5e5]/80 hover:border-brand/50 hover:text-white cursor-pointer'
              if (answered) {
                if (isCorrect) cls = 'border-brand/60 bg-brand/10 text-brand cursor-default'
                else if (isSelected) cls = 'border-red-400/60 bg-red-400/10 text-red-400 cursor-default'
                else cls = 'border-line bg-surface text-[#e5e5e5]/30 cursor-default'
              }

              return (
                <button
                  key={opt}
                  onClick={() => selectAnswer(opt)}
                  disabled={answered}
                  className={`w-full flex items-center gap-4 px-5 py-4 rounded-xl border-2 text-left transition-all ${cls}`}
                >
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-black flex-shrink-0 border ${
                    answered && isCorrect ? 'bg-brand text-black border-brand' :
                    answered && isSelected && !isCorrect ? 'bg-red-400 text-white border-red-400' :
                    'border-current'
                  }`}>
                    {OPT_LABEL[opt]}
                  </span>
                  <span className="text-sm font-medium leading-snug flex-1">{optText}</span>
                  {answered && isCorrect && <span className="text-brand text-xs font-bold flex-shrink-0">✓ Correct</span>}
                  {answered && isSelected && !isCorrect && <span className="text-red-400 text-xs font-bold flex-shrink-0">✗ Wrong</span>}
                </button>
              )
            })}
          </div>

          {answered && (
            <button
              onClick={next}
              className="w-full bg-brand hover:bg-brand-hover text-black font-bold py-3.5 rounded-xl text-sm transition-all"
            >
              {idx + 1 >= questions.length ? 'See Results →' : 'Next Question →'}
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── Results ──────────────────────────────────────────────────────────────
  if (phase === 'results') {
    const finalAnswers = answers
    const finalCorrect = finalAnswers.filter(a => a.isCorrect).length
    const finalPct = questions.length > 0 ? Math.min(Math.round((finalCorrect / questions.length) * 100), 100) : 0
    const finalPassed = finalPct >= settings.pass_score

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
            <p className="text-[#e5e5e5]/40 text-xs mt-3">Pass mark: {settings.pass_score}%</p>
            {saving && <p className="text-[#e5e5e5]/40 text-xs mt-2">Saving result…</p>}
            {saveErr && <p className="text-red-400 text-xs mt-2">Error saving: {saveErr}</p>}
          </div>

          {!finalPassed && (
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-5 py-4 mb-6">
              <p className="text-yellow-400 text-sm font-semibold">You need {settings.pass_score}% to pass. Retake the test below.</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 mb-8">
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
          </div>

          {/* Breakdown */}
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
                    <p className="text-white text-sm font-medium leading-snug">{a.q.question}</p>
                  </div>
                  {!a.isCorrect && (
                    <div className="ml-7 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-red-400/60 w-24 flex-shrink-0">Your answer:</span>
                        <span className="text-xs text-red-400 font-medium bg-red-400/10 px-2 py-0.5 rounded">{OPT_LABEL[a.selected]}. {selText}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-brand/60 w-24 flex-shrink-0">Correct:</span>
                        <span className="text-xs text-brand font-medium bg-brand/10 px-2 py-0.5 rounded">{OPT_LABEL[a.q.correct_answer]}. {corrText}</span>
                      </div>
                    </div>
                  )}
                  {a.isCorrect && (
                    <p className="ml-7 text-xs text-brand/60">{OPT_LABEL[a.selected]}. {selText}</p>
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
