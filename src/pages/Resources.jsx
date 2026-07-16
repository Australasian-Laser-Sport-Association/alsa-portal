import { useEffect, useState } from 'react'
import { FileText, ExternalLink } from 'lucide-react'
import { supabase } from '../lib/supabase'
import Footer from '../components/Footer'

// Public resources page, shared between ALSA (/resources) and ZLTAC
// (/zltac/resources) via the `scope` prop. Reads are anon: both tables have
// public SELECT policies. Routed with a per-scope key so switching between
// the two pages remounts with fresh state.

const SCOPE_COPY = {
  alsa: {
    eyebrow: 'The Association',
    title: 'ALSA Resources',
    subtitle: 'Documents, policies, and useful links from the association.',
  },
  zltac: {
    eyebrow: 'The Championship',
    title: 'ZLTAC Resources',
    subtitle: 'Documents, rules, and useful links for the championship.',
  },
}

const byOrder = (a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name)

export default function Resources({ scope }) {
  const copy = SCOPE_COPY[scope] ?? SCOPE_COPY.alsa
  const [categories, setCategories] = useState([])
  const [documents, setDocuments] = useState([])
  const [requiredDocuments, setRequiredDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const [categoryResult, documentResult, requiredResult] = await Promise.all([
          supabase.from('document_categories').select('id, scope, name, sort_order').eq('scope', scope),
          supabase.from('documents').select('id, scope, category_id, name, url, description, sort_order').eq('scope', scope),
          scope === 'zltac'
            ? fetch('/api/public?resource=required-documents')
            : Promise.resolve(null),
        ])
        if (categoryResult.error) throw categoryResult.error
        if (documentResult.error) throw documentResult.error
        if (requiredResult && !requiredResult.ok) throw new Error('Policies and forms could not be loaded')
        const requiredPayload = requiredResult ? await requiredResult.json() : { documents: [] }
        if (cancelled) return
        setCategories((categoryResult.data ?? []).slice().sort(byOrder))
        setDocuments((documentResult.data ?? []).slice().sort(byOrder))
        setRequiredDocuments(requiredPayload.documents ?? [])
      } catch {
        if (cancelled) return
        setCategories([])
        setDocuments([])
        setRequiredDocuments([])
        setError("Couldn't load resources. Please try again.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [scope, reloadKey])

  // Group documents under their category; anything without a (known) category
  // lands in "Other", last. Empty categories are hidden.
  const knownIds = new Set(categories.map(c => c.id))
  const groups = categories
    .map(c => ({ key: c.id, name: c.name, docs: documents.filter(d => d.category_id === c.id) }))
    .filter(g => g.docs.length > 0)
  const other = documents.filter(d => !d.category_id || !knownIds.has(d.category_id))
  if (other.length > 0) groups.push({ key: 'other', name: 'Other', docs: other })
  if (scope === 'zltac' && requiredDocuments.length > 0) {
    groups.unshift({
      key: 'required-documents',
      name: 'Policies and forms',
      docs: requiredDocuments.map(document => ({
        id: document.id,
        name: document.original_filename,
        description: `Version ${document.version} - effective ${document.effective_date}`,
        url: document.url,
      })),
    })
  }

  return (
    <div className="bg-base text-white">

      {/* ── Hero ── */}
      <section
        className="relative py-20 flex items-center justify-center overflow-hidden border-b border-line"
        style={{ background: 'radial-gradient(ellipse at 50% 100%, rgba(0,255,65,0.06) 0%, transparent 60%), #0F0F0F' }}
      >
        <div className="relative text-center px-6">
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-4">{copy.eyebrow}</p>
          <h1 className="text-5xl md:text-6xl font-black text-white">{copy.title}</h1>
          <p className="text-[#e5e5e5]/60 mt-4 text-lg max-w-lg mx-auto">{copy.subtitle}</p>
        </div>
      </section>

      {/* ── Resource groups ── */}
      <section className="bg-surface border-b border-line">
        <div className="max-w-7xl mx-auto px-6 py-16 md:py-20">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-12">
              <p className="text-red-300 text-sm mb-4" role="alert">{error}</p>
              <button
                type="button"
                onClick={() => setReloadKey(k => k + 1)}
                className="inline-flex items-center justify-center rounded-lg border border-brand/40 px-4 py-2 text-sm font-bold text-brand hover:bg-brand/10 transition-colors"
              >
                Retry
              </button>
            </div>
          ) : groups.length === 0 ? (
            <p className="text-center text-[#e5e5e5]/60 text-sm py-12">Resources will appear here soon.</p>
          ) : (
            groups.map(g => (
              <div key={g.key} className="mb-12 last:mb-0">
                <h2 className="text-2xl font-black text-white mb-6">{g.name}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {g.docs.map(d => (
                    <a
                      key={d.id}
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-base border border-line hover:border-brand/30 rounded-2xl p-5 transition-all block"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-brand/10 border border-brand/20 flex items-center justify-center flex-shrink-0">
                          <FileText className="w-5 h-5 text-brand" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-white font-bold">{d.name}</p>
                          {d.description && (
                            <p className="text-[#e5e5e5]/60 text-sm mt-1 leading-snug">{d.description}</p>
                          )}
                        </div>
                        <ExternalLink className="w-4 h-4 text-[#e5e5e5]/40 flex-shrink-0 mt-1" aria-hidden="true" />
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <Footer />
    </div>
  )
}
