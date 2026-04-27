import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const AU_NZ_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA', 'NZ']

const inputClass = 'w-full bg-base text-white rounded-lg px-4 py-2 border border-line focus:outline-none focus:border-brand'
const labelClass = 'block text-sm text-[#e5e5e5] mb-1'

export default function Register() {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [submittedEmail, setSubmittedEmail] = useState(null)

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
    emergencyName: '',
    emergencyPhone: '',
  })

  function set(field) {
    return e => setForm(prev => ({ ...prev, [field]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error: signUpError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        data: {
          first_name: form.firstName,
          last_name: form.lastName,
          alias: form.alias || null,
          dob: form.dateOfBirth || null,
          phone: form.phone || null,
          state: form.state || null,
          home_arena: form.homeArena || null,
          emergency_contact_name: form.emergencyName || null,
          emergency_contact_phone: form.emergencyPhone || null,
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
            <p className="text-[#e5e5e5]/50 text-sm mb-6">
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
                  <label className={labelClass}>First Name</label>
                  <input type="text" value={form.firstName} onChange={set('firstName')} placeholder="Alex" required className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Last Name</label>
                  <input type="text" value={form.lastName} onChange={set('lastName')} placeholder="Smith" required className={inputClass} />
                </div>
              </div>

              {/* Alias */}
              <div>
                <label className={labelClass}>Alias <span className="text-[#e5e5e5]/40 font-normal">(your in-game name — e.g. "DarkShot", "Viper")</span></label>
                <input type="text" value={form.alias} onChange={set('alias')} placeholder="DarkShot" className={inputClass} />
              </div>

              {/* Auth */}
              <div>
                <label className={labelClass}>Email</label>
                <input type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" required className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Password</label>
                <input type="password" value={form.password} onChange={set('password')} placeholder="Min. 10 characters" minLength={10} required className={inputClass} />
              </div>

              {/* Contact */}
              <div>
                <label className={labelClass}>Phone</label>
                <input type="tel" value={form.phone} onChange={set('phone')} placeholder="+61 400 000 000" className={inputClass} />
              </div>

              {/* Personal */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Date of Birth</label>
                  <input type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} className={inputClass + ' [color-scheme:dark]'} />
                </div>
                <div>
                  <label className={labelClass}>State / Territory</label>
                  <select value={form.state} onChange={set('state')} required className={inputClass}>
                    <option value="">Select state</option>
                    {AU_NZ_STATES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className={labelClass}>Home Arena</label>
                <input type="text" value={form.homeArena} onChange={set('homeArena')} placeholder="e.g. Zone Laser Force Sydney" className={inputClass} />
              </div>

              {/* Emergency contact */}
              <div className="pt-2 border-t border-line">
                <p className="text-[#e5e5e5]/50 text-xs mb-3 uppercase tracking-wider">Emergency Contact</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Name</label>
                    <input type="text" value={form.emergencyName} onChange={set('emergencyName')} placeholder="Contact name" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Phone</label>
                    <input type="tel" value={form.emergencyPhone} onChange={set('emergencyPhone')} placeholder="+61 400 000 000" className={inputClass} />
                  </div>
                </div>
              </div>

              {error && (
                <p className="text-red-400 text-sm bg-red-400/10 border border-red-400/30 rounded-lg px-4 py-2">
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

            <p className="text-[#e5e5e5]/50 text-sm mt-4 text-center">
              Already have an account?{' '}
              <Link to="/login" className="text-brand hover:underline">Sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
