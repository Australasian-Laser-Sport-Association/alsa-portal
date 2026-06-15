import { useContext } from 'react'
import { AlertTriangle } from 'lucide-react'
import { SiteBannerContext } from '../lib/siteSettings'

// Site-wide testing-mode warning bar. Pinned with the nav by the sticky
// wrapper in App.jsx. Intentionally not dismissible: it stays up for the
// whole testing period.
export default function SiteBanner() {
  const { banner } = useContext(SiteBannerContext)
  if (!banner.enabled || !banner.message) return null

  return (
    <div className="bg-amber-500/15 border-b border-amber-500/40 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-center gap-2 text-center">
        <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" aria-hidden="true" />
        <p className="text-amber-200 text-xs sm:text-sm font-medium">{banner.message}</p>
      </div>
    </div>
  )
}
