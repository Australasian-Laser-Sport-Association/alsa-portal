import { useState, useId } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { safeInternalRedirect } from '../lib/safeRedirect'

export default function Login() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const uid = useId()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      const target = safeInternalRedirect(searchParams.get('redirect')) ?? '/dashboard'
      navigate(target)
    }
  }

  return (
    <div className="min-h-screen bg-base flex items-center justify-center">
      <div className="bg-surface rounded-2xl p-8 w-full max-w-md shadow-xl border border-line">
        <h1 className="text-2xl font-bold text-white mb-2">Sign In</h1>
        <p className="text-[#e5e5e5]/60 mb-6 text-sm">Welcome back to ALSA</p>

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
              className="w-full bg-base text-white rounded-lg px-4 py-2 border border-line focus:outline-none focus:border-brand"
            />
          </div>
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <label htmlFor={`${uid}-password`} className="block text-sm text-[#e5e5e5]">Password</label>
              <Link to="/forgot-password" className="text-xs text-brand/70 hover:text-brand transition-colors">
                Forgot password?
              </Link>
            </div>
            <input
              id={`${uid}-password`}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
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
            disabled={loading}
            className="w-full bg-brand hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed text-black font-semibold rounded-lg py-2 transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="text-[#e5e5e5]/60 text-sm mt-4 text-center">
          No account?{' '}
          <Link to="/register" className="text-brand hover:underline">Register here</Link>
        </p>
      </div>
    </div>
  )
}
