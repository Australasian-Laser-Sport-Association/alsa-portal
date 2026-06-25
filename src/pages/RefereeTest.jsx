import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/apiFetch.js'
import { formatDate } from '../lib/dateFormat'
import Footer from '../components/Footer'
import RulesTestRunner from '../components/RulesTestRunner'
import { ClipboardCheck } from 'lucide-react'

// Player route. Thin wrapper: fetches active questions + settings + the user's
// prior result, renders the shared RulesTestRunner, and posts the final result.
// Once a player has PASSED, the test is locked — they see a read-only passed
// state instead of the test (committee clears the row or uses the override to
// allow a retake). All test-taking UX lives in RulesTestRunner.
export default function RefereeTest() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [pool, setPool] = useState({ safety: [], general: [] })
  const [settings, setSettings] = useState({
    safety_questions_per_test: 10, safety_pass_score: 100,
    general_questions_per_test: 20, general_pass_score: 70,
  })
  const [existingResult, setExistingResult] = useState(null)
  // Set only when the player had ALREADY passed at mount → locks the test.
  // Not updated by an in-session pass, so a player who passes during this visit
  // still sees RulesTestRunner's own results screen rather than being bumped.
  const [passedResult, setPassedResult] = useState(null)

  async function loadData() {
    // Player-facing fetch uses the column-masked view. correct_answer is
    // never sent to the browser; scoring happens server-side in
    // api/referee-test.js. (Admin preview surface keeps base-table access
    // through the committee FOR ALL policy; that path is untouched.)
    const [{ data: qData }, { data: sData }] = await Promise.all([
      supabase
        .from('referee_questions_public')
        .select('id, section, question, option_a, option_b, option_c, option_d, category, image_url, video_url'),
      supabase
        .from('referee_test_settings')
        .select('id, safety_questions_per_test, safety_pass_score, general_questions_per_test, general_pass_score')
        .limit(1)
        .maybeSingle(),
    ])

    if (sData) setSettings({
      safety_questions_per_test: sData.safety_questions_per_test ?? 10,
      safety_pass_score: sData.safety_pass_score ?? 100,
      general_questions_per_test: sData.general_questions_per_test ?? 20,
      general_pass_score: sData.general_pass_score ?? 70,
    })

    if (user) {
      const { data: existing } = await supabase
        .from('referee_test_results')
        .select('passed, score, safety_correct, safety_total, general_correct, general_total, taken_at')
        .eq('user_id', user.id)
        .maybeSingle()
      setExistingResult(existing ?? null)
      if (existing?.passed === true) setPassedResult(existing)
    }

    const active = qData ?? []
    setPool({
      safety: active.filter(q => q.section === 'safety'),
      general: active.filter(q => q.section !== 'safety'),
    })
    setLoading(false)
  }

  useEffect(() => {
    if (!authLoading && !user) { navigate('/login'); return }
    if (!user) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData()
  }, [authLoading, user]) // eslint-disable-line

  // Submit the raw answers and let the server score them. The response
  // carries the authoritative result + per-question breakdown so the runner
  // can render its results phase without ever holding correct_answer
  // pre-submit. We bubble the response back to the runner; we also update
  // the local "already passed" state so a follow-up refresh shows the
  // locked banner.
  async function handleComplete({ answers }) {
    const data = await apiFetch('/api/referee-test', {
      method: 'POST',
      body: JSON.stringify({ answers, taken_at: new Date().toISOString() }),
    })
    setExistingResult({ passed: data.passed, score: data.score })
    return data
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // Already passed → locked, read-only passed state. No Begin / Retake.
  if (passedResult) {
    const r = passedResult
    const hasBreakdown = r.safety_total != null && r.general_total != null
    return (
      <div className="min-h-screen bg-base text-white flex flex-col">
        <div className="flex-1 flex items-center justify-center px-5 py-12">
          <div className="w-full max-w-lg rounded-2xl border border-brand/30 bg-brand/[0.06] p-7 sm:p-10 text-center">
            <div className="w-14 h-14 sm:w-16 sm:h-16 mx-auto mb-5 rounded-full bg-brand/15 border border-brand/40 flex items-center justify-center">
              <ClipboardCheck className="h-7 w-7 sm:h-8 sm:w-8 text-brand" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-white mb-2">Rules Test — Passed ✓</h1>
            {r.score != null && <p className="text-brand font-bold mb-4">Overall {r.score}%</p>}
            {hasBreakdown && (
              <div className="grid grid-cols-2 gap-3 mb-5 text-left">
                <div className="rounded-xl border border-line bg-base p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#e5e5e5]/60 mb-1">Safety</p>
                  <p className="text-white font-black text-lg">{r.safety_correct ?? 0}/{r.safety_total}</p>
                </div>
                <div className="rounded-xl border border-line bg-base p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#e5e5e5]/60 mb-1">General</p>
                  <p className="text-white font-black text-lg">{r.general_correct ?? 0}/{r.general_total}</p>
                </div>
              </div>
            )}
            {r.taken_at && <p className="text-[#e5e5e5]/60 text-sm mb-2">Passed on {formatDate(r.taken_at, 'longWithTime')}</p>}
            <p className="text-white text-sm mb-8">You've already passed the Rules Test. Contact the committee if you need to retake.</p>
            <Link to="/player-hub" className="inline-block bg-brand hover:bg-brand-hover text-black font-bold px-6 py-3 rounded-xl text-sm transition-all">
              Back to Player Hub
            </Link>
          </div>
        </div>
        <Footer />
      </div>
    )
  }

  return (
    <RulesTestRunner
      settings={settings}
      questionPool={pool}
      existingResult={existingResult}
      onComplete={handleComplete}
    />
  )
}
