import { useState, useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { dollars } from '../../lib/pricing'

function StatCard({ label, value, sub, color }) {
  return (
    <div className="bg-surface border border-line rounded-xl p-5">
      <p className="text-xs text-[#e5e5e5]/40 uppercase tracking-wider font-bold mb-1">{label}</p>
      <p className={`text-3xl font-black ${color ?? 'text-white'}`}>{value ?? '—'}</p>
      {sub && <p className="text-xs text-[#e5e5e5]/40 mt-1">{sub}</p>}
    </div>
  )
}

function ActivityRow({ icon, text, time }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-line last:border-0">
      <span className="text-base flex-shrink-0 mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#e5e5e5]/80">{text}</p>
        <p className="text-xs text-[#e5e5e5]/30 mt-0.5">{time}</p>
      </div>
    </div>
  )
}

function fmt(d) {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function AdminHome() {
  const { role } = useOutletContext()
  const [stats, setStats] = useState({})
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [
        { count: memberCount },
        { count: teamCount },
        { count: playerCount },
        { data: payments },
        { data: recentRegs },
        { data: recentPayments },
        { data: recentCoc },
        { count: refPassed },
        { data: activeEvent },
      ] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase.from('teams').select('*', { count: 'exact', head: true }),
        supabase.from('zltac_registrations').select('*', { count: 'exact', head: true }),
        supabase.from('payments').select('amount').eq('status', 'paid'),
        supabase.from('zltac_registrations').select('id, created_at, year, profiles!zltac_registrations_user_id_fkey(first_name, alias)').order('created_at', { ascending: false }).limit(5),
        supabase.from('payments').select('amount, created_at, profiles(first_name, alias)').eq('status', 'paid').order('created_at', { ascending: false }).limit(5),
        supabase.from('code_of_conduct_signatures').select('signed_at, profiles(first_name, alias)').order('signed_at', { ascending: false }).limit(5),
        supabase.from('referee_test_results').select('*', { count: 'exact', head: true }).eq('passed', true),
        supabase.from('zltac_events').select('name, year').eq('status', 'open').limit(1).maybeSingle(),
      ])

      const totalRevenue = (payments ?? []).reduce((sum, p) => sum + (p.amount ?? 0), 0)
      const eventLabel = activeEvent ? `${activeEvent.name} ${activeEvent.year}` : '—'

      setStats({
        memberCount: memberCount ?? 0,
        teamCount: teamCount ?? 0,
        playerCount: playerCount ?? 0,
        totalRevenue,
        refPassed: refPassed ?? 0,
        eventLabel,
        eventOpen: !!activeEvent,
      })

      const feed = []
      function displayName(profiles) {
        if (!profiles) return 'A player'
        return profiles.alias || profiles.first_name || 'A player'
      }
      for (const r of recentRegs ?? []) {
        feed.push({ icon: '📋', text: `${displayName(r.profiles)} registered for ZLTAC ${r.year ?? '2027'}`, time: fmt(r.created_at), ts: r.created_at })
      }
      for (const p of recentPayments ?? []) {
        feed.push({ icon: '💳', text: `${displayName(p.profiles)} paid ${dollars(p.amount)}`, time: fmt(p.created_at), ts: p.created_at })
      }
      for (const c of recentCoc ?? []) {
        feed.push({ icon: '✍️', text: `${displayName(c.profiles)} signed the Code of Conduct`, time: fmt(c.signed_at), ts: c.signed_at })
      }
      feed.sort((a, b) => new Date(b.ts) - new Date(a.ts))
      setActivity(feed.slice(0, 12))
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-black text-white">Dashboard</h1>
        <p className="text-[#e5e5e5]/40 text-sm mt-1">Overview of ALSA Portal activity</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* Stats grid */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            <StatCard label="Total Members" value={stats.memberCount} color="text-white" />
            <StatCard label="Teams Registered" value={stats.teamCount} color="text-brand" />
            <StatCard label="Players Registered" value={stats.playerCount} color="text-white" />
            <StatCard label="Payments Received" value={dollars(stats.totalRevenue)} sub={stats.eventLabel} color="text-brand" />
            <StatCard label="Ref Tests Passed" value={stats.refPassed} color="text-white" />
            <StatCard label="Active Event" value={stats.eventLabel} sub={stats.eventOpen ? 'Registration open' : 'No event open'} color="text-brand" />
          </div>

          {/* Activity feed */}
          <div className="bg-surface border border-line rounded-xl">
            <div className="px-5 py-4 border-b border-line">
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">Recent Activity</h2>
            </div>
            <div className="px-5">
              {activity.length === 0 ? (
                <p className="text-sm text-[#e5e5e5]/30 py-8 text-center">No activity yet</p>
              ) : (
                activity.map((a, i) => (
                  <ActivityRow key={i} icon={a.icon} text={a.text} time={a.time} />
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
