import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { apiFetch } from '../../lib/apiFetch.js'

function StatCard({ label, value, sub, color }) {
  return (
    <div className="bg-surface border border-line rounded-xl p-5">
      <p className="text-xs text-[#e5e5e5]/60 uppercase tracking-wider font-bold mb-1">{label}</p>
      <p className={`text-3xl font-black ${color ?? 'text-white'}`}>{value ?? '—'}</p>
      {sub && <p className="text-xs text-[#e5e5e5]/60 mt-1">{sub}</p>}
    </div>
  )
}

export default function AdminAlsaDashboard() {
  const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      // Portal-wide counts. ALSA Members reuses the same endpoint AdminMembers
      // reads — its `active` bucket is the canonical "currently active" set,
      // so the count here always matches that page. The endpoint can throw,
      // so it's guarded; the three Supabase counts return errors in-band.
      const [
        { count: totalUsers },
        membersRes,
        { count: lifetimeRegs },
        { count: eventsArchived },
      ] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        apiFetch('/api/admin/alsa?resource=members').catch(() => ({ active: [] })),
        supabase.from('zltac_registrations').select('*', { count: 'exact', head: true }),
        supabase.from('zltac_events').select('*', { count: 'exact', head: true }).eq('status', 'archived'),
      ])

      setStats({
        totalUsers: totalUsers ?? 0,
        alsaMembers: (membersRes?.active ?? []).length,
        lifetimeRegs: lifetimeRegs ?? 0,
        eventsArchived: eventsArchived ?? 0,
      })
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-black text-white">ALSA Portal Dashboard</h1>
        <p className="text-[#e5e5e5]/60 text-sm mt-1">
          Portal-wide stats. Event-specific data lives on the ZLTAC dashboard.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 max-w-4xl mx-auto">
          <StatCard label="Total Website Users" value={stats.totalUsers} color="text-white" />
          <StatCard label="ALSA Members" value={stats.alsaMembers} color="text-brand" />
          <StatCard label="Lifetime Registrations" value={stats.lifetimeRegs} color="text-white" />
          <StatCard label="Events Archived" value={stats.eventsArchived} color="text-white" />
        </div>
      )}
    </div>
  )
}
