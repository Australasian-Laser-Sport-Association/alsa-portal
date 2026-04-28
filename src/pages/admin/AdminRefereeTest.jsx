import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

const CATEGORIES = ['Rules', 'Safety', 'Equipment', 'Scoring', 'General']
const DIFFICULTIES = ['easy', 'medium', 'hard']
const OPTS = ['a', 'b', 'c', 'd']

const EMPTY_Q = {
  question: '', option_a: '', option_b: '', option_c: '', option_d: '',
  correct_answer: 'a', category: 'Rules', difficulty: 'medium', active: true,
}

function DifficultyBadge({ d }) {
  const map = { easy: 'text-brand bg-brand/10', medium: 'text-yellow-400 bg-yellow-400/10', hard: 'text-red-400 bg-red-400/10' }
  return <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${map[d] ?? map.medium}`}>{d}</span>
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── Preview Overlay ──────────────────────────────────────────────────────────
function PreviewOverlay({ allQuestions, settings, onClose }) {
  const [phase, setPhase] = useState(() => {
    return allQuestions.filter(q => q.active).length === 0 ? 'empty' : 'running'
  }) // empty | running | results
  const [testQs, setTestQs] = useState(() => {
    const active = allQuestions.filter(q => q.active)
    if (active.length === 0) return []
    const count = Math.min(parseInt(settings.questions_per_test) || 20, active.length)
    return shuffle(active).slice(0, count)
  })
  const [idx, setIdx]           = useState(0)
  const [selected, setSelected] = useState(null)
  const [answered, setAnswered] = useState(false)
  const [answers, setAnswers]   = useState([])
  const [timeLeft, setTimeLeft] = useState(() => {
    if (allQuestions.filter(q => q.active).length === 0) return null
    const tl = parseInt(settings.time_limit)
    return tl > 0 ? tl * 60 : null
  })
  const timerRef = useRef(null)

  function finishTest() {
    clearTimeout(timerRef.current)
    setPhase('results')
  }

  // Mirror the RefereeTest pattern: ref to the latest finishTest so the
  // timer effect can call it without taking finishTest as a dep (previously
  // masked with eslint-disable, which hid an access-before-declared error).
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
    const q = testQs[idx]
    setSelected(opt)
    setAnswered(true)
    setAnswers(prev => [...prev, { q, selected: opt, isCorrect: opt === q.correct_answer }])
  }

  function next() {
    if (idx + 1 >= testQs.length) { finishTest(); return }
    setIdx(i => i + 1)
    setSelected(null)
    setAnswered(false)
  }

  function restart() {
    clearTimeout(timerRef.current)
    const active = allQuestions.filter(q => q.active)
    const count = Math.min(parseInt(settings.questions_per_test) || 20, active.length)
    setTestQs(shuffle(active).slice(0, count))
    setIdx(0); setSelected(null); setAnswered(false); setAnswers([])
    const tl = parseInt(settings.time_limit)
    if (tl > 0) setTimeLeft(tl * 60)
    setPhase('running')
  }

  function fmtTime(s) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

  const correctCount = answers.filter(a => a.isCorrect).length
  const pct = testQs.length > 0 ? Math.round((correctCount / testQs.length) * 100) : 0
  const passed = pct >= (parseInt(settings.pass_score) || 70)
  const currentQ = testQs[idx]
  const progress = testQs.length > 0 ? ((idx + (answered ? 1 : 0)) / testQs.length) * 100 : 0

  const optLabel = { a: 'A', b: 'B', c: 'C', d: 'D' }

  return (
    <div className="fixed inset-0 z-50 bg-[#0F0F0F] overflow-y-auto">
      {/* Preview banner */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-2.5" style={{ backgroundColor: '#7C3AED' }}>
        <span className="text-white text-xs font-black uppercase tracking-widest">
          ⚠ ADMIN PREVIEW — This is how the test appears to players
        </span>
        <button onClick={onClose} className="text-white/70 hover:text-white text-xs font-bold uppercase tracking-wider transition-colors">
          Exit Preview ✕
        </button>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-10">

        {/* ── Empty state ── */}
        {phase === 'empty' && (
          <div className="text-center py-20">
            <div className="text-5xl mb-5">📋</div>
            <h2 className="text-2xl font-black text-white mb-3">No Active Questions</h2>
            <p className="text-[#e5e5e5]/40 text-sm mb-6">
              No active questions in the question bank. Add questions before previewing the test.
            </p>
            <button onClick={onClose} className="bg-brand hover:bg-brand-hover text-black font-bold px-6 py-3 rounded-xl text-sm transition-all">
              Add Questions
            </button>
          </div>
        )}

        {/* ── Running ── */}
        {phase === 'running' && currentQ && (
          <div>
            {/* Header: progress + timer + score */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-[#e5e5e5]/50 text-sm">Question {idx + 1} of {testQs.length}</span>
              <div className="flex items-center gap-4">
                <span className="text-brand text-sm font-bold">{correctCount} correct</span>
                {timeLeft !== null && (
                  <span className={`text-sm font-black tabular-nums ${timeLeft <= 60 ? 'text-red-400' : 'text-[#e5e5e5]/60'}`}>
                    ⏱ {fmtTime(timeLeft)}
                  </span>
                )}
              </div>
            </div>

            {/* Progress bar */}
            <div className="h-1.5 bg-line rounded-full mb-8 overflow-hidden">
              <div className="h-full rounded-full transition-all duration-300" style={{ width: `${progress}%`, backgroundColor: '#7C3AED' }} />
            </div>

            {/* Category badge */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs text-[#e5e5e5]/30 font-bold uppercase tracking-widest">{currentQ.category}</span>
              <DifficultyBadge d={currentQ.difficulty} />
            </div>

            {/* Question */}
            <h2 className="text-xl font-bold text-white mb-8 leading-relaxed">{currentQ.question}</h2>

            {/* Options */}
            <div className="space-y-3 mb-8">
              {OPTS.map(opt => {
                const optText = currentQ[`option_${opt}`]
                if (!optText) return null
                const isCorrect = opt === currentQ.correct_answer
                const isSelected = opt === selected

                let cls = 'border-line bg-surface text-[#e5e5e5]/80 hover:border-[#7C3AED]/50 hover:text-white cursor-pointer'
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
                      {optLabel[opt]}
                    </span>
                    <span className="text-sm font-medium leading-snug">{optText}</span>
                    {answered && isCorrect && <span className="ml-auto text-brand text-xs font-bold">✓ Correct</span>}
                    {answered && isSelected && !isCorrect && <span className="ml-auto text-red-400 text-xs font-bold">✗ Wrong</span>}
                  </button>
                )
              })}
            </div>

            {answered && (
              <button
                onClick={next}
                className="w-full py-3.5 rounded-xl font-bold text-white text-sm transition-all"
                style={{ backgroundColor: '#7C3AED' }}
                onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
              >
                {idx + 1 >= testQs.length ? 'See Results →' : 'Next Question →'}
              </button>
            )}
          </div>
        )}

        {/* ── Results ── */}
        {phase === 'results' && (
          <div>
            {/* Score card */}
            <div className={`rounded-2xl border-2 p-8 text-center mb-8 ${passed ? 'border-brand/40 bg-brand/5' : 'border-red-400/40 bg-red-400/5'}`}>
              <p className="text-6xl font-black mb-2" style={{ color: passed ? '#00E6FF' : '#f87171' }}>
                {correctCount}/{testQs.length}
              </p>
              <p className="text-3xl font-black text-white mb-1">{pct}%</p>
              <span className={`inline-block text-sm font-black uppercase tracking-widest px-4 py-1.5 rounded-full mt-2 ${
                passed ? 'bg-brand/20 text-brand' : 'bg-red-400/20 text-red-400'
              }`}>
                {passed ? '✓ PASS' : '✗ FAIL'}
              </span>
              <p className="text-[#e5e5e5]/40 text-xs mt-3">Pass mark: {settings.pass_score}%</p>
            </div>

            {/* Actions */}
            <div className="flex gap-3 mb-8">
              <button onClick={onClose}
                className="flex-1 py-3 rounded-xl border border-line text-[#e5e5e5]/60 hover:text-white font-bold text-sm transition-colors">
                Exit Preview
              </button>
              <button onClick={restart}
                className="flex-1 py-3 rounded-xl font-bold text-white text-sm transition-all"
                style={{ backgroundColor: '#7C3AED' }}
                onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
                Retake Preview
              </button>
            </div>

            {/* Question breakdown */}
            <h3 className="text-white font-bold text-base mb-4">Question Breakdown</h3>
            <div className="space-y-3">
              {answers.map((a, i) => {
                const selText = a.q[`option_${a.selected}`]
                const corrText = a.q[`option_${a.q.correct_answer}`]
                return (
                  <div key={i} className={`rounded-xl border p-4 ${a.isCorrect ? 'border-brand/20 bg-brand/5' : 'border-red-400/20 bg-red-400/5'}`}>
                    <div className="flex items-start gap-2 mb-3">
                      <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-black mt-0.5 ${a.isCorrect ? 'bg-brand text-black' : 'bg-red-400 text-white'}`}>
                        {a.isCorrect ? '✓' : '✗'}
                      </span>
                      <div>
                        <p className="text-white text-sm font-medium leading-snug mb-1">{a.q.question}</p>
                        <span className="text-[10px] text-[#e5e5e5]/30 font-bold uppercase tracking-wider">{a.q.category}</span>
                      </div>
                    </div>
                    {!a.isCorrect && (
                      <div className="ml-7 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-red-400/60 w-24 flex-shrink-0">Your answer:</span>
                          <span className="text-xs text-red-400 font-medium bg-red-400/10 px-2 py-0.5 rounded">{optLabel[a.selected]}. {selText}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-brand/60 w-24 flex-shrink-0">Correct answer:</span>
                          <span className="text-xs text-brand font-medium bg-brand/10 px-2 py-0.5 rounded">{optLabel[a.q.correct_answer]}. {corrText}</span>
                        </div>
                      </div>
                    )}
                    {a.isCorrect && (
                      <div className="ml-7">
                        <span className="text-xs text-brand/60">{optLabel[a.selected]}. {selText}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Admin Page ──────────────────────────────────────────────────────────
export default function AdminRefereeTest() {
  const [questions, setQuestions] = useState([])
  const [settings, setSettings]   = useState({ pass_score: 70, time_limit: 30, questions_per_test: 20 })
  const [loading, setLoading]     = useState(true)
  const [adding, setAdding]       = useState(false)
  const [editing, setEditing]     = useState(null)
  const [form, setForm]           = useState(EMPTY_Q)
  const [saving, setSaving]       = useState(false)
  const [msg, setMsg]             = useState(null)
  const [filterCategory, setFilterCategory]   = useState('all')
  const [filterDifficulty, setFilterDifficulty] = useState('all')
  const [search, setSearch]       = useState('')
  const [savingSettings, setSavingSettings] = useState(false)
  const [preview, setPreview]     = useState(false)
  const csvRef = useRef()

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    const [{ data: qData }, { data: sData }] = await Promise.all([
      supabase.from('referee_questions').select('*').order('created_at', { ascending: false }),
      supabase.from('referee_test_settings').select('*').limit(1).single(),
    ])
    setQuestions(qData ?? [])
    if (sData) setSettings({ pass_score: sData.pass_score ?? 70, time_limit: sData.time_limit_minutes ?? 30, questions_per_test: sData.questions_per_test ?? 20 })
    setLoading(false)
  }

  function startAdd()    { setForm(EMPTY_Q); setEditing(null); setAdding(true) }
  function startEdit(q)  { setForm({ ...q }); setEditing(q.id); setAdding(true) }

  async function handleSave() {
    setSaving(true); setMsg(null)
    const payload = { ...form }; delete payload.id
    let err
    if (editing) { ;({ error: err } = await supabase.from('referee_questions').update(payload).eq('id', editing)) }
    else         { ;({ error: err } = await supabase.from('referee_questions').insert(payload)) }
    setSaving(false)
    if (err) setMsg({ type: 'error', text: err.message })
    else { setMsg({ type: 'ok', text: editing ? 'Updated.' : 'Question added.' }); loadAll(); setTimeout(() => { setAdding(false); setMsg(null) }, 800) }
  }

  async function deleteQ(id) {
    if (!window.confirm('Delete this question?')) return
    await supabase.from('referee_questions').delete().eq('id', id)
    setQuestions(qs => qs.filter(q => q.id !== id))
  }

  async function toggleActive(q) {
    await supabase.from('referee_questions').update({ active: !q.active }).eq('id', q.id)
    setQuestions(qs => qs.map(x => x.id === q.id ? { ...x, active: !x.active } : x))
  }

  async function saveSettings() {
    setSavingSettings(true)
    await supabase.from('referee_test_settings').upsert({ id: 1, pass_score: parseInt(settings.pass_score), time_limit_minutes: parseInt(settings.time_limit), questions_per_test: parseInt(settings.questions_per_test) })
    setSavingSettings(false)
  }

  function handleCSVImport(e) {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const lines = ev.target.result.split('\n').filter(l => l.trim())
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase())
      const rows = lines.slice(1).map(line => {
        const vals = line.split(',')
        return Object.fromEntries(headers.map((h, i) => [h, (vals[i] ?? '').trim().replace(/^"|"$/g, '')]))
      })
      await supabase.from('referee_questions').insert(rows.map(r => ({
        question: r.question, option_a: r.option_a ?? r.a, option_b: r.option_b ?? r.b,
        option_c: r.option_c ?? r.c, option_d: r.option_d ?? r.d,
        correct_answer: r.correct_answer ?? r.answer ?? 'a',
        category: r.category ?? 'General', difficulty: r.difficulty ?? 'medium', active: true,
      })))
      loadAll()
    }
    reader.readAsText(file); e.target.value = ''
  }

  const filtered = questions.filter(q => {
    if (filterCategory !== 'all' && q.category !== filterCategory) return false
    if (filterDifficulty !== 'all' && q.difficulty !== filterDifficulty) return false
    if (search && !q.question.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const activeCount = questions.filter(q => q.active).length

  return (
    <>
      {preview && (
        <PreviewOverlay
          allQuestions={questions}
          settings={settings}
          onClose={() => setPreview(false)}
        />
      )}

      <div>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-black text-white">Referee Test</h1>
            <p className="text-[#e5e5e5]/40 text-sm mt-1">Manage questions and test settings</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPreview(true)}
              className="text-white font-bold px-5 py-2.5 rounded-xl text-sm transition-all"
              style={{ backgroundColor: '#7C3AED' }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >
              Preview Test
            </button>
            <input ref={csvRef} type="file" accept=".csv" onChange={handleCSVImport} className="hidden" />
            <button onClick={() => csvRef.current.click()}
              className="text-xs bg-line hover:bg-[#374056] text-[#e5e5e5]/60 hover:text-white font-semibold px-4 py-2 rounded-lg transition-colors">
              Import CSV
            </button>
            <button onClick={startAdd}
              className="bg-brand hover:bg-brand-hover text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-all">
              + Add Question
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Total Questions', value: questions.length },
            { label: 'Active Questions', value: activeCount },
            { label: 'Pass Rate', value: `${settings.pass_score}%` },
          ].map(s => (
            <div key={s.label} className="bg-surface border border-line rounded-xl p-4">
              <p className="text-xs text-[#e5e5e5]/40 uppercase tracking-wider font-bold mb-1">{s.label}</p>
              <p className="text-2xl font-black text-brand">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Low question warning */}
        {!loading && activeCount < parseInt(settings.questions_per_test) && (
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-3 mb-6">
            <p className="text-yellow-400 text-sm font-semibold">
              ⚠ Warning: You have {activeCount} active question{activeCount !== 1 ? 's' : ''} but the test is set to show {settings.questions_per_test} questions. Add more questions or reduce the questions per test setting.
            </p>
          </div>
        )}

        {/* Test settings */}
        <div className="bg-surface border border-line rounded-xl p-5 mb-6">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-4">Test Settings</h2>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Pass Score (%)', key: 'pass_score' },
              { label: 'Time Limit (min)', key: 'time_limit' },
              { label: 'Questions per Test', key: 'questions_per_test' },
            ].map(({ label, key }) => (
              <div key={key}>
                <label className="block text-xs text-[#e5e5e5]/40 mb-1">{label}</label>
                <input type="number" value={settings[key]}
                  onChange={e => setSettings(s => ({ ...s, [key]: e.target.value }))}
                  className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand" />
              </div>
            ))}
          </div>
          <button onClick={saveSettings} disabled={savingSettings}
            className="mt-4 text-sm bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-5 py-2 rounded-xl transition-all">
            {savingSettings ? 'Saving…' : 'Save Settings'}
          </button>
        </div>

        {/* Add/Edit form */}
        {adding && (
          <div className="bg-surface border border-brand/20 rounded-xl p-5 mb-6">
            <h2 className="text-sm font-bold text-white mb-4">{editing ? 'Edit Question' : 'Add Question'}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-[#e5e5e5]/40 mb-1">Question</label>
                <textarea rows={3} value={form.question} onChange={e => setForm(f => ({ ...f, question: e.target.value }))}
                  className="w-full bg-base border border-line rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-brand resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {OPTS.map(opt => (
                  <div key={opt}>
                    <label className="block text-xs text-[#e5e5e5]/40 mb-1">Option {opt.toUpperCase()}</label>
                    <input type="text" value={form[`option_${opt}`]}
                      onChange={e => setForm(f => ({ ...f, [`option_${opt}`]: e.target.value }))}
                      className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand" />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-[#e5e5e5]/40 mb-1">Correct Answer</label>
                  <select value={form.correct_answer} onChange={e => setForm(f => ({ ...f, correct_answer: e.target.value }))}
                    className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand">
                    {OPTS.map(o => <option key={o} value={o}>{o.toUpperCase()}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#e5e5e5]/40 mb-1">Category</label>
                  <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand">
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#e5e5e5]/40 mb-1">Difficulty</label>
                  <select value={form.difficulty} onChange={e => setForm(f => ({ ...f, difficulty: e.target.value }))}
                    className="w-full bg-base border border-line rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand">
                    {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={handleSave} disabled={saving || !form.question.trim()}
                  className="bg-brand hover:bg-brand-hover disabled:opacity-50 text-black font-bold px-5 py-2 rounded-xl text-sm transition-all">
                  {saving ? 'Saving…' : editing ? 'Update' : 'Add Question'}
                </button>
                <button onClick={() => { setAdding(false); setMsg(null) }}
                  className="border border-line text-[#e5e5e5]/60 hover:text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors">
                  Cancel
                </button>
                {msg && <span className={`text-sm ${msg.type === 'ok' ? 'text-brand' : 'text-red-400'}`}>{msg.text}</span>}
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-4">
          <input type="text" placeholder="Search questions…" value={search} onChange={e => setSearch(e.target.value)}
            className="bg-surface border border-line rounded-lg px-3 py-2 text-xs text-white placeholder-[#e5e5e5]/30 focus:outline-none focus:border-brand w-48" />
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
            className="bg-surface border border-line rounded-lg px-3 py-2 text-xs text-[#e5e5e5]/70 focus:outline-none focus:border-brand">
            <option value="all">All categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filterDifficulty} onChange={e => setFilterDifficulty(e.target.value)}
            className="bg-surface border border-line rounded-lg px-3 py-2 text-xs text-[#e5e5e5]/70 focus:outline-none focus:border-brand">
            <option value="all">All difficulties</option>
            {DIFFICULTIES.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        {/* Questions table */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="bg-surface border border-line rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  {['Question', 'Category', 'Difficulty', 'Answer', 'Active', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs text-[#e5e5e5]/40 font-bold uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-12 text-[#e5e5e5]/30 text-sm">No questions found</td></tr>
                ) : filtered.map(q => (
                  <tr key={q.id} className="border-b border-line last:border-0 hover:bg-line/30 transition-colors">
                    <td className="px-4 py-3 text-[#e5e5e5]/80 max-w-xs"><span className="line-clamp-2">{q.question}</span></td>
                    <td className="px-4 py-3 text-[#e5e5e5]/50 text-xs">{q.category}</td>
                    <td className="px-4 py-3"><DifficultyBadge d={q.difficulty} /></td>
                    <td className="px-4 py-3 text-brand font-bold text-xs">{(q.correct_answer ?? '').toUpperCase()}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => toggleActive(q)}
                        className={`w-9 h-5 rounded-full transition-colors relative ${q.active ? 'bg-brand' : 'bg-line'}`}>
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${q.active ? 'translate-x-4' : ''}`} />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => startEdit(q)} className="text-xs text-[#e5e5e5]/50 hover:text-brand transition-colors">Edit</button>
                        <button onClick={() => deleteQ(q.id)} className="text-xs text-[#e5e5e5]/50 hover:text-red-400 transition-colors">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
