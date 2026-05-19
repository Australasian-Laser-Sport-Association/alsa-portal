// Subtle informational card pointing at Doug Burbidge's external Oz Nationals
// scoring site. Used on the ZLTAC landing page beneath the year explorer.
// Kept deliberately quiet — small text, muted colour, single line of copy.
export default function DougBurbidgeReference() {
  return (
    <section className="max-w-3xl mx-auto px-6 py-6">
      <div className="bg-surface/40 border border-line rounded-xl px-4 py-3 text-center">
        <p className="text-xs text-[#e5e5e5]/45 leading-relaxed">
          For historical results and Oz Nationals scoring, see{' '}
          <a
            href="https://dougburbidge.com/OzNationals/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand/80 hover:text-brand underline underline-offset-2"
          >
            Doug Burbidge&rsquo;s site
          </a>.
        </p>
      </div>
    </section>
  )
}
