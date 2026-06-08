import { useState, useId } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const uid = useId()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setLoading(false)
    if (resetErr) {
      setError(resetErr.message)
      return
    }
    setSent(true)
  }

  return (
    <div className="min-h-screen bg-base flex items-center justify-center">
      <div className="bg-surface rounded-2xl p-8 w-full max-w-md shadow-xl border border-line">
        <h1 className="text-2xl font-bold text-white mb-2">Reset Password</h1>
        <p className="text-[#e5e5e5]/60 mb-6 text-sm">
          Enter the email you signed up with. We&rsquo;ll send you a link to set a new password.
        </p>

        {sent ? (
          <div className="space-y-4">
            <div className="bg-brand/10 border border-brand/30 rounded-lg px-4 py-3 text-sm text-brand">
              If an account exists for <strong>{email}</strong>, a reset link has been sent.
              Check your inbox (and spam folder).
            </div>
            <Link to="/login" className="block text-center text-brand hover:underline text-sm">
              ← Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor={`${uid}-email`} className="block text-sm text-[#e5e5e5] mb-1">Email</label>
              <input
                id={`${uid}-email`}
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus
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
              disabled={loading}
              className="w-full bg-brand hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold rounded-lg py-2 transition-colors"
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>

            <p className="text-[#e5e5e5]/60 text-sm text-center">
              Remembered it?{' '}
              <Link to="/login" className="text-brand hover:underline">Back to sign in</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
