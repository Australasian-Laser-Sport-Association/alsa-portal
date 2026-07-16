import { useCallback, useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom'
import { apiFetch } from '../lib/apiFetch.js'
import LoadError from './LoadError'

export default function ManagerRoute({ children }) {
  const { slug } = useParams()
  const location = useLocation()
  const [state, setState] = useState({ status: 'loading', competitions: [], error: null })

  const load = useCallback(() => {
    let active = true
    apiFetch('/api/superadmin/my-competitions')
      .then(data => {
        if (!active) return
        setState({ status: 'ready', competitions: Array.isArray(data) ? data : [], error: null })
      })
      .catch(error => {
        if (active) setState({ status: 'error', competitions: [], error })
      })
    return () => { active = false }
  }, [])

  useEffect(() => load(), [load])

  function retry() {
    setState({ status: 'loading', competitions: [], error: null })
    load()
  }

  if (state.status === 'loading') {
    return (
      <div className="min-h-[40vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (state.status === 'error') {
    return <LoadError title="Could not verify manager access" message={state.error?.message} onRetry={retry} />
  }

  const allowed = slug
    ? state.competitions.some(item => (item.competition ?? item)?.slug === slug)
    : state.competitions.length > 0
  if (!allowed) {
    return <Navigate to="/dashboard" replace state={{ accessDenied: true, from: location.pathname }} />
  }

  return children ?? <Outlet context={{ managedCompetitions: state.competitions }} />
}
