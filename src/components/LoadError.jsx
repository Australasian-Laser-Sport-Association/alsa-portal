export default function LoadError({
  title = 'Could not load this page',
  message = 'Please check your connection and try again.',
  onRetry,
}) {
  return (
    <div className="min-h-[40vh] flex items-center justify-center px-4">
      <div role="alert" className="w-full max-w-lg bg-surface border border-red-400/30 rounded-2xl p-6 text-center">
        <h1 className="text-white text-lg font-bold">{title}</h1>
        <p className="text-[#e5e5e5]/70 text-sm mt-2">{message}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-5 bg-brand text-black font-semibold rounded-lg px-4 py-2 hover:bg-brand-hover transition-colors"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  )
}
