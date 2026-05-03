import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

// Shared invite-code modal used by EventPage (state C card) and PlayerHub
// (top team CTA section). Owns its own input state so the parent only needs
// to control open/closed.

export default function JoinTeamModal({ open, onClose }) {
  const [joinCode, setJoinCode] = useState('')
  const navigate = useNavigate()

  if (!open) return null

  function submit() {
    const code = joinCode.trim().toUpperCase()
    if (!code) return
    navigate(`/join/${code}`)
  }

  function close() {
    setJoinCode('')
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4">
      <div className="bg-surface border border-line rounded-2xl p-6 max-w-sm w-full">
        <p className="text-white font-bold mb-2">Join a team</p>
        <p className="text-[#e5e5e5]/50 text-sm mb-5">
          Enter the invite code your captain shared with you.
        </p>
        <input
          type="text"
          value={joinCode}
          onChange={e => setJoinCode(e.target.value.toUpperCase())}
          onKeyDown={e => {
            if (e.key === 'Enter' && joinCode.trim()) submit()
          }}
          placeholder="e.g. ABC123"
          autoFocus
          maxLength={12}
          className="w-full bg-base border border-line rounded-xl px-4 py-2.5 text-sm text-white placeholder-[#e5e5e5]/30 focus:outline-none focus:border-brand transition-colors mb-4 font-mono uppercase tracking-widest"
        />
        <div className="flex gap-3">
          <button
            onClick={submit}
            disabled={!joinCode.trim()}
            className="bg-brand hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed text-black font-bold px-5 py-2 rounded-xl text-sm transition-colors"
          >
            Join team
          </button>
          <button
            onClick={close}
            className="border border-line text-[#e5e5e5]/60 hover:text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
