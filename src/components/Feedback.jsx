import Dialog from './Dialog'

const TONES = {
  error: 'bg-red-500/10 border-red-500/25 text-red-300',
  warning: 'bg-yellow-500/10 border-yellow-500/25 text-yellow-200',
  success: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300',
  info: 'bg-brand/10 border-brand/25 text-[#e5e5e5]',
}

export function InlineAlert({ children, tone = 'error', className = '' }) {
  if (!children) return null

  return (
    <div role="alert" className={`rounded-xl border px-4 py-3 text-sm ${TONES[tone] ?? TONES.error} ${className}`.trim()}>
      {children}
    </div>
  )
}

export function Toast({ message, tone = 'info', onDismiss, className = '' }) {
  if (!message) return null

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border px-4 py-3 text-sm shadow-xl ${TONES[tone] ?? TONES.info} ${className}`.trim()}
    >
      <div className="flex items-start gap-3">
        <p className="flex-1">{message}</p>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-current opacity-70 hover:opacity-100"
            aria-label="Dismiss notification"
          >
            x
          </button>
        )}
      </div>
    </div>
  )
}

export function LoadErrorState({
  title = 'Could not load this page.',
  message,
  retryLabel = 'Try again',
  onRetry,
  className = '',
}) {
  return (
    <div className={`flex items-center justify-center py-16 ${className}`.trim()}>
      <div className="w-full max-w-md rounded-xl border border-red-500/25 bg-red-500/10 px-5 py-4 text-center">
        <p className="text-white font-bold">{title}</p>
        {message && <p className="text-red-200/80 text-sm mt-2">{message}</p>}
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 rounded-lg bg-brand px-4 py-2 text-xs font-bold text-black hover:bg-brand-hover"
          >
            {retryLabel}
          </button>
        )}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  busy = false,
  busyLabel,
  destructive = false,
  error,
  onConfirm,
  onCancel,
}) {
  if (!open) return null

  const confirmClass = destructive
    ? 'bg-red-500 hover:bg-red-600 text-white'
    : 'bg-brand hover:bg-brand-hover text-black'

  function handleCancel() {
    if (!busy) onCancel?.()
  }

  return (
    <Dialog open={open} onClose={handleCancel} variant="center" size="sm" closeOnBackdrop className="p-6">
      <Dialog.Title as="p" className="text-white font-bold mb-2">{title}</Dialog.Title>
      <div className="text-[#e5e5e5]/60 text-sm mb-5">
        {children}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={`${confirmClass} disabled:opacity-60 font-bold px-4 py-2 rounded-lg text-xs`}
        >
          {busy ? (busyLabel ?? 'Working...') : confirmLabel}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          disabled={busy}
          className="border border-line text-[#e5e5e5]/60 hover:text-white disabled:opacity-60 font-semibold px-4 py-2 rounded-lg text-xs"
        >
          {cancelLabel}
        </button>
      </div>
      <InlineAlert className="mt-4" tone="error">{error}</InlineAlert>
    </Dialog>
  )
}
