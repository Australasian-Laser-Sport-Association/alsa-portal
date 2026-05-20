import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/useAuth'
import { supabase } from '../lib/supabase'
import { apiFetch } from '../lib/apiFetch.js'
import RulesTestRunner from '../components/RulesTestRunner'

// Player route. Thin wrapper: fetches active questions + settings + the user's
// prior result, renders the shared RulesTestRunner, and posts the final result.
// All test-taking UX lives in RulesTestRunner (single source of truth shared
// with the admin preview).
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

    if (sData) setSettings({
      safety_questions_per_test: sData.safety_questions_per_test ?? 10,
      safety_pass_score: sData.safety_pass_score ?? 100,
      general_questions_per_test: sData.general_questions_per_test ?? 20,
      general_pass_score: sData.general_pass_score ?? 70,
    })

    if (user) {
      const { data: existing } = await supabase
        .from('referee_test_results')
        .select('passed, score')
        .eq('user_id', user.id)
        .maybeSingle()
      setExistingResult(existing ?? null)
    }

    const active = qData ?? []
    setPool({
      safety: active.filter(q => q.section === 'safety'),
      general: active.filter(q => q.section !== 'safety'),
    })
    setLoading(false)
  }

  // Persist the completed attempt. The API is server-authoritative for the pass
  // result; we still update the local "already passed" banner state.
  async function handleComplete(result) {
    await apiFetch('/api/referee-test', {
      method: 'POST',
      body: JSON.stringify({ ...result, taken_at: new Date().toISOString() }),
    })
    setExistingResult({ passed: result.passed, score: result.score })
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
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
