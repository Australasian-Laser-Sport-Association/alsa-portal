import { useCurrentEvent } from '../hooks/useCurrentEvent'

export default function CaptainPortal() {
  const { eventName } = useCurrentEvent()
  return (
    <div className="min-h-screen bg-base p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-1">Captain Portal</h1>
        <p className="text-[#e5e5e5]/60 mb-8">Manage your team and event entries</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-surface rounded-xl p-6 border border-line">
            <h2 className="text-white font-semibold text-lg mb-4">My Team</h2>
            <p className="text-[#e5e5e5]/40 text-sm">No team created yet.</p>
            <button className="mt-4 bg-brand hover:bg-brand-hover text-black font-semibold rounded-lg px-4 py-2 text-sm transition-colors">
              Create Team
            </button>
          </div>

          <div className="bg-surface rounded-xl p-6 border border-line">
            <h2 className="text-white font-semibold text-lg mb-4">Team Entries</h2>
            <p className="text-[#e5e5e5]/40 text-sm">No active event entries.</p>
            <button className="mt-4 bg-line hover:bg-[#374056] text-white font-semibold rounded-lg px-4 py-2 text-sm transition-colors">
              Enter {eventName}
            </button>
          </div>
        </div>

        <div className="bg-surface rounded-xl p-6 border border-line">
          <h2 className="text-white font-semibold text-lg mb-4">Roster Management</h2>
          <p className="text-[#e5e5e5]/40 text-sm">Create a team first to manage your roster.</p>
        </div>
      </div>
    </div>
  )
}
