import { ChevronDown } from 'lucide-react'

// Collapsible card section with a styled header, used across Player Hub.
// Layout: a lucide icon on the left, an all-caps green title, and a chevron on
// the right that rotates when the section is open. Controlled by the parent so
// a section can be opened from outside (for example, an in-page hash link).
// The body wrapper sets white text explicitly rather than relying on
// inheritance from an ancestor.
export default function CollapsibleSection({ id, icon: Icon, title, open, onToggle, children }) {
  return (
    <div id={id} className="bg-surface border border-line rounded-2xl">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-5 py-4 text-left"
      >
        {Icon && <Icon className="w-6 h-6 text-brand flex-shrink-0" />}
        <span className="flex-1 text-brand font-black uppercase tracking-wide text-xl">{title}</span>
        <ChevronDown className={`w-5 h-5 text-brand flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-5 pb-5 text-white">{children}</div>
      )}
    </div>
  )
}
