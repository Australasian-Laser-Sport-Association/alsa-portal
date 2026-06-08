import { useEffect, useState, useId } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// Landing page for the password-reset email link. Supabase's reset email
// directs the user here with a hash fragment that the JS client parses on
// load (#access_token=...&type=recovery). The client emits a
// PASSWORD_RECOVERY auth state event and creates a short-lived session
// authorised to call supabase.auth.updateUser({ password }).
//
// Flow:
//   1. On mount, listen for PASSWORD_RECOVERY; also probe the current session
//      so we handle the case where the event fired before this component
//      mounted (Supabase parses the URL hash on client init).
//   2. If a recovery session is present → show the new-password form.
//   3. If not → show "open the reset link from your email" guidance with a
//      link back to /forgot-password.
//   4. On submit → updateUser, then navigate to /dashboard.

export default function ResetPassword() {
  const navigate = useNavigate()
  const [ready, setReady] = useState(false)        // recovery session detected
  const [checking, setChecking] = useState(true)
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const uid = useId()

  useEffect(() => {
    // Subscribe first — covers the case where the event fires after mount.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true)
        setChecking(false)
      }
    })

    // Race the subscription with a session probe. If a session already
    // exists (Supabase parsed the URL hash before this mount), we treat it
    // as recovery-capable; updateUser will surface a clearer error if not.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setReady(true)
      }
      // Allow ~1.2s for the PASSWORD_RECOVERY event to fire if it hasn't yet.
      setTimeout(() => setChecking(false), 1200)
    })

    return () => { subscription.unsubscribe() }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (newPw !== confirmPw) {
      setError('New passwords do not match.')
      return
    }
    if (newPw.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    setSaving(true)
    const { error: updErr } = await supabase.auth.updateUser({ password: newPw })
    setSaving(false)
    if (updErr) {
      setError(updErr.message)
      return
    }
    navigate('/dashboard', { replace: true })
  }

  return (
    <div className="min-h-screen bg-base flex items-center justify-center">
      <div className="bg-surface rounded-2xl p-8 w-full max-w-md shadow-xl border border-line">
        <h1 className="text-2xl font-bold text-white mb-2">Set a new password</h1>
        <p className="text-[#e5e5e5]/60 mb-6 text-sm">
          Choose a new password for your ALSA account.
        </p>

        {checking ? (
          <div className="flex justify-center py-6">
            <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !ready ? (
          <div className="space-y-4">
            <div className="bg-red-400/10 border border-red-400/30 rounded-lg px-4 py-3 text-sm text-red-400">
              This page must be opened from the password-reset email link.
              The link may have expired or already been used.
            </div>
            <Link to="/forgot-password" className="block text-center text-brand hover:underline text-sm">
              Request a new reset link →
            </Link>
            <Link to="/login" className="block text-center text-[#e5e5e5]/50 hover:text-white text-sm">
              ← Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor={`${uid}-new-password`} className="block text-sm text-[#e5e5e5] mb-1">New password</label>
              <input
                id={`${uid}-new-password`}
                type="password"
                value={newPw}
                onChange={e => setNewPw(e.target.value)}
                placeholder="••••••••"
                required
                autoFocus
                className="w-full bg-base text-white rounded-lg px-4 py-2 border border-line focus:outline-none focus:border-brand"
              />
            </div>
            <div>
              <label htmlFor={`${uid}-confirm-password`} className="block text-sm text-[#e5e5e5] mb-1">Confirm new password</label>
              <input
                id={`${uid}-confirm-password`}
                type="password"
                value={confirmPw}
                onChange={e => setConfirmPw(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full bg-base text-white rounded-lg px-4 py-2 border border-line focus:outline-none focus:border-brand"
              />
            </div>

            {error && (
              <p role="alert" className="text-red-400 text-sm bg-red-400/10 border border-red-400/30 rounded-lg px-4 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-brand hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold rounded-lg py-2 transition-colors"
            >
              {saving ? 'Saving…' : 'Set new password'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
