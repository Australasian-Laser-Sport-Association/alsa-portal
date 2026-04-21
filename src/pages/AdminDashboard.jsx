export default function AdminDashboard() {
  return (
    <div className="min-h-screen bg-base p-8">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-1">Admin Dashboard</h1>
        <p className="text-[#e5e5e5]/60 mb-8">ALSA event and player management</p>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Total Players', value: '0' },
            { label: 'Active Events', value: '0' },
            { label: 'Teams Registered', value: '0' },
            { label: 'Pending Approvals', value: '0' },
          ].map(({ label, value }) => (
            <div key={label} className="bg-surface rounded-xl p-5 border border-line">
              <p className="text-[#e5e5e5]/60 text-xs mb-1">{label}</p>
              <p className="text-white text-2xl font-bold">{value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-surface rounded-xl p-6 border border-line">
            <h2 className="text-white font-semibold text-lg mb-4">Event Management</h2>
            <p className="text-[#e5e5e5]/40 text-sm mb-4">No events configured.</p>
            <button className="bg-brand hover:bg-brand-hover text-black font-semibold rounded-lg px-4 py-2 text-sm transition-colors">
              Create Event
            </button>
          </div>

          <div className="bg-surface rounded-xl p-6 border border-line">
            <h2 className="text-white font-semibold text-lg mb-4">Player Management</h2>
            <p className="text-[#e5e5e5]/40 text-sm mb-4">No players registered yet.</p>
            <button className="bg-line hover:bg-[#374056] text-white font-semibold rounded-lg px-4 py-2 text-sm transition-colors">
              View All Players
            </button>
          </div>

          <div className="bg-surface rounded-xl p-6 border border-line">
            <h2 className="text-white font-semibold text-lg mb-4">Results Entry</h2>
            <p className="text-[#e5e5e5]/40 text-sm">Enter and publish event results.</p>
          </div>

          <div className="bg-surface rounded-xl p-6 border border-line">
            <h2 className="text-white font-semibold text-lg mb-4">Reports</h2>
            <p className="text-[#e5e5e5]/40 text-sm">Export registrations, rosters, and standings.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
