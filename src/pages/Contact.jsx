import { useState } from 'react'
import Footer from '../components/Footer'

const SUBJECTS = [
  'General Enquiry',
  'ZLTAC Registration',
  'Sponsorship',
  'Media',
  'Other',
]

export default function Contact() {
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' })
  const [submitted, setSubmitted] = useState(false)

  const inputClass = 'w-full bg-base text-white rounded-xl px-4 py-3 border border-line focus:outline-none focus:border-brand text-sm transition-colors placeholder:text-[#e5e5e5]/20'

  function set(field) {
    return e => setForm(prev => ({ ...prev, [field]: e.target.value }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    setSubmitted(true)
  }

  return (
    <div className="bg-base text-white">

      {/* ── Hero ── */}
      <section
        className="relative py-24 border-b border-line overflow-hidden"
        style={{ background: 'radial-gradient(ellipse at 50% 100%, rgba(0,255,65,0.05) 0%, transparent 60%), #0F0F0F' }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(rgba(0,255,65,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,65,0.03) 1px, transparent 1px)`,
            backgroundSize: '72px 72px',
          }}
        />
        <div className="relative text-center px-6">
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-4">Get in Touch</p>
          <h1 className="text-5xl md:text-6xl font-black text-white">Contact ALSA</h1>
          <p className="text-[#e5e5e5]/50 mt-4 text-lg">We'd love to hear from you</p>
        </div>
      </section>

      {/* ── Form + Details ── */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-12">

          {/* Form */}
          <div className="lg:col-span-3">
            <h2 className="text-2xl font-black text-white mb-2">Send a Message</h2>
            <p className="text-[#e5e5e5]/40 text-sm mb-8">Fill in the form and we'll get back to you as soon as possible.</p>

            {submitted ? (
              <div className="bg-brand/10 border border-brand/30 rounded-2xl p-10 text-center">
                <p className="text-brand text-3xl mb-3">✓</p>
                <p className="text-white font-bold text-lg mb-2">Message sent!</p>
                <p className="text-[#e5e5e5]/50 text-sm">Thanks for reaching out. We'll be in touch shortly.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[#e5e5e5]/40 mb-2">Name</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={set('name')}
                      placeholder="Your full name"
                      required
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[#e5e5e5]/40 mb-2">Email</label>
                    <input
                      type="email"
                      value={form.email}
                      onChange={set('email')}
                      placeholder="you@example.com"
                      required
                      className={inputClass}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-[#e5e5e5]/40 mb-2">Subject</label>
                  <select
                    value={form.subject}
                    onChange={set('subject')}
                    required
                    className={inputClass + ' [color-scheme:dark]'}
                  >
                    <option value="">Select a subject</option>
                    {SUBJECTS.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-[#e5e5e5]/40 mb-2">Message</label>
                  <textarea
                    value={form.message}
                    onChange={set('message')}
                    placeholder="Tell us what you'd like to discuss..."
                    required
                    rows={6}
                    className={inputClass + ' resize-none'}
                  />
                </div>
                <button
                  type="submit"
                  className="w-full bg-brand hover:bg-brand-hover text-black font-bold rounded-xl py-3.5 text-sm transition-all hover:shadow-[0_0_20px_rgba(0,255,65,0.35)]"
                >
                  Send Message
                </button>
              </form>
            )}
          </div>

          {/* Details */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-black text-white mb-2">Contact Details</h2>
              <p className="text-[#e5e5e5]/40 text-sm mb-8">You can also reach us through the following channels.</p>
            </div>

            {[
              {
                label: 'Email',
                value: 'info@alsa.org.au',
                sub: 'General enquiries',
              },
              {
                label: 'Location',
                value: 'Australia & New Zealand',
                sub: 'Australasian region',
              },
            ].map(({ label, value, sub }) => (
              <div key={label} className="bg-surface border border-line rounded-xl p-5">
                <p className="text-[#e5e5e5]/40 text-xs uppercase tracking-wider font-semibold mb-1">{label}</p>
                <p className="text-white font-semibold text-sm">{value}</p>
                <p className="text-[#e5e5e5]/35 text-xs mt-0.5">{sub}</p>
              </div>
            ))}

            <div className="bg-surface border border-line rounded-xl p-5">
              <p className="text-[#e5e5e5]/40 text-xs uppercase tracking-wider font-semibold mb-3">Follow ALSA</p>
              <div className="flex gap-3">
                {['Facebook', 'Instagram', 'YouTube', 'X'].map(s => (
                  <a
                    key={s}
                    href="#"
                    className="flex-1 text-center bg-line hover:bg-[#374056] hover:text-brand text-[#e5e5e5]/50 text-xs py-2 rounded-lg transition-colors"
                  >
                    {s}
                  </a>
                ))}
              </div>
            </div>
          </div>

        </div>
      </section>

      <Footer />
    </div>
  )
}
