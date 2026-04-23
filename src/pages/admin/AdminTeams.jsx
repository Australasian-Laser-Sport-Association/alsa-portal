import { useState, useEffect, useRef } from 'react'
import { apiFetch } from '../../lib/apiFetch.js'

export default function AdminTeams() {
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [saveStatus, setSaveStatus] = useState('idle') // 'idle' | 'saving' | 'saved' | 'error'
  const [deletedIds, setDeletedIds] = useState([])

  const dirtyRef = useRef(false)
  const dragItem = useRef(null)
  const [dragOver, setDragOver] = useState(null)

  // ── Load ──────────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const { teams: data } = await apiFetch('/api/admin/rr-teams')
        setTeams(data ?? [])
      } catch (err) {
        console.error('[AdminTeams] load failed:', err)
      }
      setLoading(false)
      setTimeout(() => { dirtyRef.current = false }, 0)
    }
    load()
  }, [])

  // ── Auto-save (debounced 1 s) ─────────────────────────────────────────────────

  useEffect(() => {
    if (!dirtyRef.current) return

    const timer = setTimeout(async () => {
      setSaveStatus('saving')
      try {
        await apiFetch('/api/admin/rr-teams', {
          method: 'POST',
          body: JSON.stringify({ teams, deletedIds }),
        })
        setDeletedIds([])
        setSaveStatus('saved')
        setTimeout(() => setSaveStatus('idle'), 2000)
      } catch (err) {
        console.error('[AdminTeams] save failed:', err)
        setSaveStatus('error')
      }
    }, 1000)

    return () => clearTimeout(timer)
  }, [teams, deletedIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ──────────────────────────────────────────────────────────────────

  function handleAdd() {
    dirtyRef.current = true
    setTeams(prev => [
      ...prev,
      { id: crypto.randomUUID(), name: '', seed_rank: prev.length + 1, region: '', notes: '' },
    ])
  }

  function handleDelete(id) {
    dirtyRef.current = true
    setTeams(prev => prev.filter(t => t.id !== id))
    setDeletedIds(prev => [...prev, id])
  }

  function handleChange(id, field, value) {
    dirtyRef.current = true
    setTeams(prev => prev.map(t => (t.id === id ? { ...t, [field]: value } : t)))
  }

  function handleDragStart(e, idx) {
    dragItem.current = idx
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e, idx) {
    e.preventDefault()
    setDragOver(idx)
  }

  function handleDrop(e, toIdx) {
    e.preventDefault()
    setDragOver(null)
    const fromIdx = dragItem.current
    dragItem.current = null
    if (fromIdx === null || fromIdx === toIdx) return
    dirtyRef.current = true
    setTeams(prev => {
      const next = [...prev]
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return next
    })
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white">Teams</h1>
          <p className="text-sm text-[#e5e5e5]/40 mt-1">
            Manage your seed-ranked team list for the Round Robin Generator. Changes auto-save.
          </p>
        </div>

        {/* Save indicator */}
        <div className="flex-shrink-0 mt-1.5 min-w-[64px] text-right">
          {saveStatus === 'saving' && (
            <span className="flex items-center justify-end gap-1.5 text-xs text-[#e5e5e5]/40">
              <div className="w-3 h-3 border border-[#e5e5e5]/30 border-t-transparent rounded-full animate-spin" />
              Saving…
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="flex items-center justify-end gap-1.5 text-xs text-brand">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Saved
            </span>
          )}
          {saveStatus === 'error' && (
            <span className="text-xs text-red-400">Save failed</span>
          )}
        </div>
      </div>

      {/* Team list */}
      <div className="bg-surface border border-line rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-widest text-[#e5e5e5]/40">Ranked Teams</p>
          <span className="text-xs text-[#e5e5e5]/25">
            {teams.length} team{teams.length !== 1 ? 's' : ''}
          </span>
        </div>

        {teams.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <svg className="w-8 h-8 text-[#e5e5e5]/15 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <p className="text-sm text-[#e5e5e5]/30">No teams yet</p>
            <p className="text-xs text-[#e5e5e5]/20 mt-1">Add your first team below</p>
          </div>
        ) : (
          <div className="space-y-1">
            {/* Column headers */}
            <div className="grid grid-cols-[20px_28px_1fr_130px_150px_24px] gap-2 px-2 mb-1">
              <div />
              <div />
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#e5e5e5]/25">Name</p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#e5e5e5]/25">Region</p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#e5e5e5]/25">Notes</p>
              <div />
            </div>

            {teams.map((team, idx) => {
              const isDragTarget = dragOver === idx
              return (
                <div
                  key={team.id}
                  draggable
                  onDragStart={e => handleDragStart(e, idx)}
                  onDragOver={e => handleDragOver(e, idx)}
                  onDrop={e => handleDrop(e, idx)}
                  onDragLeave={() => setDragOver(null)}
                  className={`grid grid-cols-[20px_28px_1fr_130px_150px_24px] gap-2 items-center px-2 py-1.5 rounded-lg border transition-colors ${
                    isDragTarget
                      ? 'bg-brand/10 border-brand/30'
                      : 'border-transparent hover:bg-line/40'
                  }`}
                >
                  {/* Drag handle */}
                  <div className="text-[#e5e5e5]/20 cursor-grab active:cursor-grabbing">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                      <circle cx="5" cy="4" r="1.2"/><circle cx="11" cy="4" r="1.2"/>
                      <circle cx="5" cy="8" r="1.2"/><circle cx="11" cy="8" r="1.2"/>
                      <circle cx="5" cy="12" r="1.2"/><circle cx="11" cy="12" r="1.2"/>
                    </svg>
                  </div>

                  {/* Seed number */}
                  <span className="text-[10px] font-bold text-[#e5e5e5]/25 text-right tabular-nums">
                    {idx + 1}
                  </span>

                  {/* Name */}
                  <input
                    type="text"
                    value={team.name}
                    placeholder="Team name…"
                    onChange={e => handleChange(team.id, 'name', e.target.value)}
                    className="bg-transparent border-b border-transparent hover:border-line focus:border-brand/50 text-xs text-[#e5e5e5]/80 focus:text-white outline-none py-0.5 transition-colors placeholder-[#e5e5e5]/20"
                  />

                  {/* Region */}
                  <input
                    type="text"
                    value={team.region || ''}
                    placeholder="Region…"
                    onChange={e => handleChange(team.id, 'region', e.target.value)}
                    className="bg-transparent border-b border-transparent hover:border-line focus:border-brand/50 text-xs text-[#e5e5e5]/50 focus:text-white outline-none py-0.5 transition-colors placeholder-[#e5e5e5]/15"
                  />

                  {/* Notes */}
                  <input
                    type="text"
                    value={team.notes || ''}
                    placeholder="Notes…"
                    onChange={e => handleChange(team.id, 'notes', e.target.value)}
                    className="bg-transparent border-b border-transparent hover:border-line focus:border-brand/50 text-xs text-[#e5e5e5]/50 focus:text-white outline-none py-0.5 transition-colors placeholder-[#e5e5e5]/15"
                  />

                  {/* Delete */}
                  <button
                    onClick={() => handleDelete(team.id)}
                    className="text-[#e5e5e5]/20 hover:text-red-400 transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Add team */}
        <button
          onClick={handleAdd}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold text-[#e5e5e5]/40 hover:text-brand border border-dashed border-line hover:border-brand/40 rounded-lg transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Team
        </button>
      </div>
    </div>
  )
}
