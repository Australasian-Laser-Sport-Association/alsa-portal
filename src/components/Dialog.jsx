import { createContext, useContext, useEffect, useId, useRef } from 'react'

// Shared accessible dialog. Controlled: the parent owns `open` and `onClose`.
// Behaviours: focus-in-on-open, vanilla focus trap, Escape→onClose (always),
// backdrop→onClose (only when closeOnBackdrop), body-scroll-lock,
// role="dialog"/aria-modal, aria-labelledby (from <Dialog.Title>) or aria-label
// (from `label`), and restore-focus-to-trigger on close. Inline render (no
// portal), no new dependency. Reuses the existing modal tokens.
//
// Variants:
//   center → vertically/horizontally centred; `size` picks the max width.
//   scroll → top-aligned, the overlay itself scrolls (panel my-auto); for tall
//            forms that may exceed the viewport.
//   drawer → right-side slide-in panel, full height, fixed max-w-md.

const DialogTitleContext = createContext(null)

const SIZE_MAX_W = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
}

// Tabbable elements inside the panel, in DOM order.
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export default function Dialog({
  open,
  onClose,
  variant = 'center',
  size = 'md',
  closeOnBackdrop = false,
  label,
  labelledBy,
  className = '',
  children,
}) {
  const panelRef = useRef(null)
  const restoreRef = useRef(null)
  const generatedId = useId()
  // aria-labelledby points at <Dialog.Title> (which renders this id) unless an
  // explicit labelledBy is passed; `label` takes over as aria-label instead.
  const titleId = labelledBy || `${generatedId}-title`

  // Focus into the dialog on open; restore focus to the trigger on close.
  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement
    const panel = panelRef.current
    const first = panel?.querySelector(FOCUSABLE)
    if (first) first.focus()
    else panel?.focus()
    return () => {
      const el = restoreRef.current
      if (el && typeof el.focus === 'function') el.focus()
    }
  }, [open])

  // Lock background scroll while open.
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [open])

  // Escape closes (always); Tab/Shift+Tab cycle stays trapped inside the panel.
  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const nodes = panel.querySelectorAll(FOCUSABLE)
      if (nodes.length === 0) {
        e.preventDefault()
        panel.focus()
        return
      }
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      const active = document.activeElement
      if (e.shiftKey) {
        if (active === first || !panel.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last || !panel.contains(active)) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  const outer = {
    center: 'fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4',
    scroll: 'fixed inset-0 bg-black/70 z-50 flex items-start justify-center px-4 py-8 overflow-y-auto',
    drawer: 'fixed inset-0 bg-black/70 z-50 flex items-end justify-end',
  }[variant] ?? 'fixed inset-0 bg-black/70 z-50 flex items-center justify-center px-4'

  const maxW = SIZE_MAX_W[size] ?? SIZE_MAX_W.md
  const panel = {
    center: `bg-surface border border-line rounded-2xl w-full ${maxW}`,
    scroll: `bg-surface border border-line rounded-2xl w-full my-auto ${maxW}`,
    drawer: 'bg-surface border-l border-line h-full w-full max-w-md overflow-y-auto',
  }[variant] ?? `bg-surface border border-line rounded-2xl w-full ${maxW}`

  function handleBackdrop(e) {
    if (e.target !== e.currentTarget) return
    if (closeOnBackdrop) onClose()
  }

  return (
    <div className={outer} onClick={handleBackdrop}>
      <DialogTitleContext.Provider value={titleId}>
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          {...(label ? { 'aria-label': label } : { 'aria-labelledby': titleId })}
          tabIndex={-1}
          className={`${panel} ${className}`.trim()}
        >
          {children}
        </div>
      </DialogTitleContext.Provider>
    </div>
  )
}

// Renders the dialog's accessible name and wires its id to aria-labelledby.
// `as` lets callers keep their existing heading level (h2/h3) for visual parity.
function DialogTitle({ as: Tag = 'h2', className = '', children }) {
  const id = useContext(DialogTitleContext)
  return <Tag id={id} className={className}>{children}</Tag>
}

Dialog.Title = DialogTitle
