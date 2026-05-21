import { Archive, ExternalLink } from 'lucide-react'

// Credit card pointing at Doug Burbidge's external Oz Nationals scoring site,
// the long-standing keeper of ZLTAC's official record. Rendered in two spots on
// the ZLTAC landing page (above the year/search section and beneath it), so any
// copy or style change here applies to both.
export default function DougBurbidgeReference() {
  return (
    <section className="max-w-3xl mx-auto px-6 py-6">
      <div className="bg-surface border border-brand rounded-2xl p-6 md:p-8">
        <div className="flex items-start gap-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-brand/10 border border-brand/30 flex items-center justify-center">
            <Archive className="w-5 h-5 text-brand" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-brand leading-relaxed">Doug Burbidge has been the keeper of ZLTAC&rsquo;s official record for years.</p>
            <p className="text-white mt-2 leading-relaxed">Visit his site for verified historical results and complete scoring.</p>
            <a
              href="https://dougburbidge.com/OzNationals/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 mt-4 bg-brand hover:bg-brand-hover text-black font-bold text-sm px-4 py-2.5 rounded-xl transition-colors"
            >
              Visit Doug Burbidge&rsquo;s site
              <ExternalLink className="w-4 h-4" aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
