import { useState, useId } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { PASSWORD_MIN_LENGTH, PASSWORD_REQUIREMENT_TEXT, validatePassword } from '../lib/passwordPolicy'

const AU_NZ_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NZ']

const inputClass = 'w-full bg-base text-white rounded-lg px-4 py-2 border border-line focus:outline-none focus:border-brand'
const labelClass = 'block text-sm text-[#e5e5e5] mb-1'

export default function Register() {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [submittedEmail, setSubmittedEmail] = useState(null)
  const uid = useId()

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    alias: '',
    email: '',
    password: '',
    phone: '',
    dateOfBirth: '',
    state: '',
    homeArena: '',
  })

  function set(field) {
    return e => setForm(prev => ({ ...prev, [field]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    const passwordError = validatePassword(form.password)
    if (passwordError) {
      setError(passwordError)
      return
    }
    setLoading(true)

    const { error: signUpError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        emailRedirectTo: `${window.location.origin}/welcome`,
        data: {
          first_name: form.firstName,
          last_name: form.lastName,
          alias: form.alias || null,
          dob: form.dateOfBirth || null,
          phone: form.phone || null,
          state: form.state || null,
          home_arena: form.homeArena || null,
        },
      },
    })

    setLoading(false)

    if (signUpError) {
      setError(signUpError.message)
      return
    }

    setSubmittedEmail(form.email)
  }

  return (
    <div className="min-h-screen bg-base flex items-center justify-center py-10">
      <div className="bg-surface rounded-2xl p-8 w-full max-w-lg shadow-xl border border-line">
        {submittedEmail ? (
          <>
            <h1 className="text-2xl font-bold text-white mb-2">Check your email</h1>
            <p className="text-[#e5e5e5]/80 text-sm mb-3">
              We've sent a confirmation email to <span className="font-semibold text-white">{submittedEmail}</span>. Click the link inside to activate your account.
            </p>
            <p className="text-[#e5e5e5]/60 text-sm mb-6">
              Didn't get it? Check your spam folder, or try logging in to resend.
            </p>
            <Link
              to="/login"
              className="inline-block bg-brand hover:bg-brand-hover text-black font-semibold rounded-lg px-4 py-2 transition-colors"
            >
              Back to log in
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold text-white mb-2">Create Account</h1>
            <p className="text-[#e5e5e5]/60 mb-6 text-sm">Register for your permanent ALSA account</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={`${uid}-first-name`} className={labelClass}>First Name</label>
                  <input id={`${uid}-first-name`} type="text" value={form.firstName} onChange={set('firstName')} placeholder="Alex" required className={inputClass} />
                </div>
                <div>
                  <label htmlFor={`${uid}-last-name`} className={labelClass}>Last Name</label>
                  <input id={`${uid}-last-name`} type="text" value={form.lastName} onChange={set('lastName')} placeholder="Smith" required className={inputClass} />
                </div>
              </div>

              {/* Alias */}
              <div>
                <label htmlFor={`${uid}-alias`} className={labelClass}>Alias <span className="text-[#e5e5e5]/60 font-normal">(your in-game name — e.g. "DarkShot", "Viper")</span></label>
                <input id={`${uid}-alias`} type="text" value={form.alias} onChange={set('alias')} placeholder="DarkShot" className={inputClass} />
              </div>

              {/* Auth */}
              <div>
                <label htmlFor={`${uid}-email`} className={labelClass}>Email</label>
                <input id={`${uid}-email`} type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" required className={inputClass} />
              </div>
              <div>
                <label htmlFor={`${uid}-password`} className={labelClass}>Password</label>
                <input id={`${uid}-password`} type="password" value={form.password} onChange={set('password')} placeholder={PASSWORD_REQUIREMENT_TEXT} minLength={PASSWORD_MIN_LENGTH} required className={inputClass} />
              </div>

              {/* Contact */}
              <div>
                <label htmlFor={`${uid}-phone`} className={labelClass}>Phone</label>
                <input id={`${uid}-phone`} type="tel" value={form.phone} onChange={set('phone')} placeholder="+61 400 000 000" className={inputClass} />
              </div>

              {/* Personal */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor={`${uid}-dob`} className={labelClass}>Date of Birth</label>
                  <input id={`${uid}-dob`} type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} className={inputClass + ' [color-scheme:dark]'} />
                </div>
                <div>
                  <label htmlFor={`${uid}-state`} className={labelClass}>State / Territory</label>
                  <select id={`${uid}-state`} value={form.state} onChange={set('state')} required className={inputClass}>
                    <option value="">Select state</option>
                    {AU_NZ_STATES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor={`${uid}-home-arena`} className={labelClass}>Home Arena</label>
                <input id={`${uid}-home-arena`} type="text" value={form.homeArena} onChange={set('homeArena')} placeholder="e.g. Zone Laser Force Sydney" className={inputClass} />
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
                {loading ? 'Creating account…' : 'Create Account'}
              </button>
            </form>

            <p className="text-[#e5e5e5]/60 text-sm mt-4 text-center">
              Already have an account?{' '}
              <Link to="/login" className="text-brand hover:underline">Sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
