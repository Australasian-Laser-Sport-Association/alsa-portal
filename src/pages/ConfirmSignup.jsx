import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// Supabase signup confirmation landing. The email magic link is configured to
// point at /confirm-signup?token_hash=...&type=signup on the portal domain
// (instead of the project-subdomain default), keeping the user inside the
// branded surface for the final verifyOtp step.

export default function ConfirmSignup() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')

  // 'loading' | 'success' | 'error'. Missing params skip verifyOtp and land
  // straight on 'error' so we don't fire a doomed network call.
  const [status, setStatus] = useState(tokenHash && type ? 'loading' : 'error')
  const [errorMsg, setErrorMsg] = useState(
    tokenHash && type ? '' : 'This confirmation link is missing required information.'
  )

  useEffect(() => {
    if (status !== 'loading') return
    let cancelled = false
    supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      .then(({ error }) => {
        if (cancelled) return
        if (error) {
          setErrorMsg(error.message || 'This confirmation link is invalid or has expired.')
          setStatus('error')
        } else {
          setStatus('success')
        }
      })
      .catch(err => {
        if (cancelled) return
        setErrorMsg(err?.message || 'Could not confirm your email. Please try again.')
        setStatus('error')
      })
    return () => { cancelled = true }
  }, [status, tokenHash, type])

  useEffect(() => {
    if (status !== 'success') return
    const id = setTimeout(() => navigate('/welcome'), 1500)
    return () => clearTimeout(id)
  }, [status, navigate])

  return (
    <div className="min-h-screen bg-base flex items-center justify-center px-4">
      <div className="bg-surface rounded-2xl p-8 w-full max-w-md shadow-xl border border-line text-center">
        {status === 'loading' && (
          <>
            <div className="w-10 h-10 border-2 border-brand border-t-transparent rounded-full animate-spin mx-auto mb-5" />
            <h1 className="text-xl font-bold text-white mb-1">Confirming your email...</h1>
            <p className="text-[#e5e5e5]/60 text-sm">Just a moment.</p>
          </>
        )}

        {status === 'success' && (
          <>
            <h1 className="text-2xl font-bold text-white mb-2">Email confirmed!</h1>
            <p className="text-[#e5e5e5]/60 text-sm">Taking you to your welcome page.</p>
          </>
        )}

        {status === 'error' && (
          <>
            <h1 className="text-2xl font-bold text-white mb-2">Confirmation failed</h1>
            <p role="alert" className="text-[#e5e5e5]/60 text-sm mb-6">{errorMsg}</p>
            <Link
              to="/login"
              className="inline-block bg-brand hover:bg-brand-hover text-black font-bold px-6 py-2.5 rounded-xl text-sm transition-colors"
            >
              Sign in
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
