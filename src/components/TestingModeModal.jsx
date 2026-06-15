import { useContext, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import Dialog from './Dialog'
import { SiteBannerContext } from '../lib/siteSettings'

const SEEN_KEY = 'testingModeSeen'

// Homepage testing-mode notice. Shows once per browser session while the
// site banner is enabled; dismissing it records the session flag.
export default function TestingModeModal() {
  const { banner } = useContext(SiteBannerContext)
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(SEEN_KEY) === '1')

  function close() {
    sessionStorage.setItem(SEEN_KEY, '1')
    setDismissed(true)
  }

  return (
    <Dialog open={banner.enabled && !dismissed} onClose={close} closeOnBackdrop>
      <div className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-400" aria-hidden="true" />
          </div>
          <Dialog.Title className="text-lg font-black text-white">Testing Mode</Dialog.Title>
        </div>
        <p className="text-[#e5e5e5]/80 text-sm leading-relaxed mb-6">{banner.message}</p>
        <button
          onClick={close}
          className="w-full bg-brand hover:bg-brand-hover text-black font-bold px-5 py-2.5 rounded-xl text-sm transition-all"
        >
          Got it
        </button>
      </div>
    </Dialog>
  )
}
