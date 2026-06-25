export default function RootErrorFallback({ resetError }) {
  return (
    <main className="min-h-screen bg-base text-white flex items-center justify-center px-6">
      <section className="max-w-md text-center">
        <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-4">ALSA Portal</p>
        <h1 className="text-3xl font-black mb-3">Something went wrong</h1>
        <p className="text-[#e5e5e5]/70 text-sm leading-relaxed mb-6">
          Reload the portal and try again. The error has been captured if monitoring is enabled.
        </p>
        <button
          type="button"
          onClick={() => {
            resetError()
            window.location.reload()
          }}
          className="inline-flex items-center justify-center rounded-lg bg-brand px-5 py-2.5 text-sm font-bold text-black hover:bg-brand/90 transition-colors"
        >
          Reload
        </button>
      </section>
    </main>
  )
}
