import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// /join/:code — looks up the team, finds the active event, redirects to player-register with code pre-filled
export default function JoinTeam() {
  const { code } = useParams()
  const navigate = useNavigate()

  useEffect(() => {
    async function redirect() {
      // Find the team and active event
      const [{ data: team }, { data: event }] = await Promise.all([
        supabase.from('teams').select('id, status').eq('invite_code', code.toUpperCase()).eq('invite_active', true).maybeSingle(),
        supabase.from('zltac_events').select('year').eq('status', 'open').maybeSingle(),
      ])

      if (!team || !event) {
        // Invalid code or no active event — go to home
        navigate('/', { replace: true })
        return
      }

      navigate(`/events/${event.year}/player-register?code=${code.toUpperCase()}`, { replace: true })
    }
    redirect()
  }, [code, navigate])

  return (
    <div className="min-h-screen bg-base flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
