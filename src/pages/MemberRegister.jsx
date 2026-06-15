import { useEffect, useState } from 'react'
import Footer from '../components/Footer'
import { maskStorageUrl } from '../lib/assetUrl'

function memberInitials(p) {
  const a = (p.first_name?.[0] ?? '').toUpperCase()
  const b = (p.last_name?.[0] ?? '').toUpperCase()
  return (a + b) || (p.alias?.[0]?.toUpperCase() ?? '?')
}

function memberFullName(p) {
  return [p.first_name, p.last_name].filter(Boolean).join(' ') || p.alias || 'ALSA Member'
}

function MemberCard({ member }) {
  return (
    <div className="bg-surface border border-line rounded-xl p-4 flex items-center gap-3">
      <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center flex-shrink-0 overflow-hidden">
        {member.avatar_url
          ? <img src={maskStorageUrl(member.avatar_url)} alt={memberFullName(member)} className="w-full h-full object-cover" />
          : <span className="text-emerald-400 font-bold text-sm">{memberInitials(member)}</span>
        }
      </div>
      <div className="min-w-0">
        <p className="text-white font-semibold text-sm leading-tight">{memberFullName(member)}</p>
        {member.alias && <p className="text-brand text-xs leading-tight">"{member.alias}"</p>}
      </div>
    </div>
  )
}

function MemberGrid({ members }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-w-5xl mx-auto">
      {members.map(p => <MemberCard key={p.id} member={p} />)}
    </div>
  )
}

export default function MemberRegister() {
  const [data, setData] = useState({ current_period: null, members: [], lifetime_members: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/public?resource=members')
      .then(async r => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          console.error('[MemberRegister] /api/public?resource=members failed:', r.status, body)
          if (!cancelled) { setError(true); setLoading(false) }
          return
        }
        const d = await r.json()
        if (!cancelled) { setData(d); setLoading(false) }
      })
      .catch(err => {
        console.error('[MemberRegister] /api/public?resource=members threw:', err)
        if (!cancelled) { setError(true); setLoading(false) }
      })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="bg-base text-white min-h-screen flex flex-col">

      {/* ── Hero ── */}
      <section
        className="relative py-20 md:py-24 border-b border-line overflow-hidden"
        style={{ background: 'radial-gradient(ellipse at 50% 100%, rgba(0,255,65,0.06) 0%, transparent 60%), #0F0F0F' }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(rgba(0,255,65,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,65,0.03) 1px, transparent 1px)`,
            backgroundSize: '72px 72px',
          }}
        />
        <div className="relative text-center px-6 max-w-3xl mx-auto">
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-4">Membership</p>
          <h1 className="text-4xl md:text-5xl font-black text-white mb-4">ALSA Member Register</h1>
          <p className="text-brand text-base md:text-lg leading-relaxed mb-3">
            The current list of members of the Australasian Laser Sport Association Inc.
          </p>
          <p className="text-white text-base md:text-lg leading-relaxed">
            ALSA membership runs between National Championships, approximately March to March each year.
          </p>
        </div>
      </section>

      {/* ── Member list ── */}
      <section className="flex-1 bg-base">
        <div className="max-w-7xl mx-auto px-6 py-16 md:py-20">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-20">
              <p role="alert" className="text-red-400 text-base">
                Couldn't load member register — please try again.
              </p>
            </div>
          ) : !data.current_period && (data.lifetime_members ?? []).length === 0 ? (
            <div className="text-center py-20">
              <p className="text-[#e5e5e5]/60 text-base">
                Between membership periods — check back after the next National Championship.
              </p>
            </div>
          ) : (
            <>
              {(data.lifetime_members ?? []).length > 0 && (
                <div className="mb-16">
                  <div className="text-center mb-8">
                    <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-2">Lifetime Members</p>
                    <p className="text-[#e5e5e5]/60 text-sm">
                      {data.lifetime_members.length} member{data.lifetime_members.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <MemberGrid members={data.lifetime_members} />
                </div>
              )}

              {data.current_period && (
                <div>
                  <div className="text-center mb-12">
                    <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-2">{data.current_period.label}</p>
                    <p className="text-[#e5e5e5]/60 text-sm">
                      {data.members.length} annual member{data.members.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  {data.members.length === 0 ? (
                    <p className="text-center text-[#e5e5e5]/60 text-sm">No annual members yet for this period.</p>
                  ) : (
                    <MemberGrid members={data.members} />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <Footer />
    </div>
  )
}
