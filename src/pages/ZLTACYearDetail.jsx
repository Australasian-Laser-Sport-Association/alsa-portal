import { useState, useEffect, useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/dateFormat'
import Footer from '../components/Footer'
import Dialog from '../components/Dialog'
import { maskStorageUrl } from '../lib/assetUrl'

const SIDE_EVENT_LABELS = {
  solos:   'Solos',
  doubles: 'Doubles',
  triples: 'Triples',
  masters: 'Masters',
  womens:  'Womens',
  juniors: 'Juniors',
  lotr:    'Lord of the Rings',
}
const SIDE_EVENT_ORDER = ['solos', 'doubles', 'triples', 'masters', 'womens', 'juniors', 'lotr']

function PhotoLightbox({ urls, startIndex, onClose }) {
  const [current, setCurrent] = useState(startIndex)
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setCurrent(c => Math.min(c + 1, urls.length - 1))
      if (e.key === 'ArrowLeft') setCurrent(c => Math.max(c - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [urls.length, onClose])

  return (
    <Dialog open onClose={onClose} variant="lightbox" closeOnBackdrop label="Photo viewer" className="relative max-w-4xl max-h-full">
        <img src={urls[current]} alt="" className="max-h-[80vh] max-w-full object-contain rounded-xl" />
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 bg-black/70 text-white rounded-full flex items-center justify-center text-sm hover:bg-black"
        >
          ×
        </button>
        {urls.length > 1 && (
          <div className="flex items-center justify-between mt-3">
            <button
              onClick={() => setCurrent(c => Math.max(c - 1, 0))}
              disabled={current === 0}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-30 text-white rounded-lg text-sm transition-colors"
            >
              ←
            </button>
            <span className="text-white/50 text-sm">{current + 1} / {urls.length}</span>
            <button
              onClick={() => setCurrent(c => Math.min(c + 1, urls.length - 1))}
              disabled={current === urls.length - 1}
              className="px-4 py-2 bg-white/10 hover:bg-white/20 disabled:opacity-30 text-white rounded-lg text-sm transition-colors"
            >
              →
            </button>
          </div>
        )}
    </Dialog>
  )
}

export default function ZLTACYearDetail() {
  const { year } = useParams()
  const [event, setEvent] = useState(null)
  const [placings, setPlacings] = useState([])
  const [loading, setLoading] = useState(true)
  const [lightbox, setLightbox] = useState(null) // index or null

  useEffect(() => {
    let cancelled = false
    const y = parseInt(year)

    Promise.all([
      supabase
        .from('zltac_event_history')
        .select('*')
        .eq('year', y)
        .maybeSingle(),
      supabase
        .from('zltac_event_placings')
        .select('division, rank, name, subtitle')
        .eq('tournament_year', y)
        .order('rank', { ascending: true }),
    ]).then(([eventRes, placingsRes]) => {
      if (cancelled) return
      setEvent(eventRes.data ?? null)
      setPlacings(placingsRes.data ?? [])
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [year])

  const teamPodium = useMemo(() => {
    const byRank = { 1: null, 2: null, 3: null }
    for (const p of placings) {
      if (p.division === 'team' && (p.rank === 1 || p.rank === 2 || p.rank === 3)) {
        byRank[p.rank] = p
      }
    }
    return byRank
  }, [placings])

  const sideEventGroups = useMemo(() => {
    const byDivision = new Map()
    for (const p of placings) {
      if (p.division === 'team') continue
      let list = byDivision.get(p.division)
      if (!list) { list = []; byDivision.set(p.division, list) }
      list.push(p)
    }
    for (const list of byDivision.values()) list.sort((a, b) => a.rank - b.rank)
    return SIDE_EVENT_ORDER
      .filter(div => byDivision.has(div))
      .map(div => ({ division: div, label: SIDE_EVENT_LABELS[div], entries: byDivision.get(div) }))
  }, [placings])

  if (loading) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!event) {
    return (
      <div className="min-h-screen bg-base text-white flex flex-col items-center justify-center gap-5 px-6">
        <p className="text-[#e5e5e5]/30 text-lg">No records found for ZLTAC {year}.</p>
        <Link to="/zltac" className="text-brand/60 hover:text-brand text-sm transition-colors">
          ← Back to ZLTAC history
        </Link>
      </div>
    )
  }

  const location = [event.location_city, event.location_state].filter(Boolean).join(', ')
  const hasPodium = !!(teamPodium[1] || teamPodium[2] || teamPodium[3])
  const hasSideEvents = sideEventGroups.length > 0
  const hasPhotos = event.photo_urls?.length > 0
  // Mask the gallery URLs once so the thumbnails and the lightbox stay consistent.
  const maskedPhotoUrls = (event.photo_urls ?? []).map(maskStorageUrl)

  const dateRange = event.start_date
    ? event.end_date && event.end_date !== event.start_date
      ? `${formatDate(event.start_date)} – ${formatDate(event.end_date)}`
      : formatDate(event.start_date)
    : null

  return (
    <div className="bg-base text-white min-h-screen">

      {/* Hero */}
      <section
        className="relative py-24 border-b border-line overflow-hidden"
        style={{ background: 'radial-gradient(ellipse at 50% 100%, rgba(0,255,65,0.06) 0%, transparent 60%), #0F0F0F' }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(rgba(0,255,65,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,65,0.025) 1px, transparent 1px)`,
            backgroundSize: '72px 72px',
          }}
        />
        <div className="relative max-w-5xl mx-auto px-6">
          <Link to="/zltac" className="inline-flex items-center gap-1.5 text-xs text-[#e5e5e5]/40 hover:text-brand transition-colors mb-8">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to ZLTAC history
          </Link>

          <div className="flex items-start gap-8">
            {event.logo_url && (
              <img
                src={maskStorageUrl(event.logo_url)}
                alt={event.name}
                className="w-24 h-24 md:w-32 md:h-32 object-contain rounded-2xl bg-[#191919] p-3 border border-line flex-shrink-0"
              />
            )}
            <div>
              <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-2">Championship Results</p>
              <h1 className="text-4xl md:text-5xl font-black text-white mb-3">{event.name || `ZLTAC ${event.year}`}</h1>
              <div className="flex flex-wrap gap-4 text-sm text-[#e5e5e5]/50">
                {location && (
                  <span className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    {location}{event.location_venue ? ` — ${event.location_venue}` : ''}
                  </span>
                )}
                {dateRange && (
                  <span className="flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    {dateRange}
                  </span>
                )}
              </div>
              {event.description && (
                <p className="text-[#e5e5e5]/50 text-sm leading-relaxed mt-4 max-w-xl">{event.description}</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-6 py-16 space-y-16">

        {/* Podium */}
        {hasPodium && (
          <section>
            <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-8 text-center">Final Podium</p>
            <div className="flex items-end justify-center gap-4">
              {/* Runner up — left */}
              {teamPodium[2] ? (
                <div className="flex-1 max-w-[220px]">
                  <div className="bg-surface border border-line rounded-2xl p-6 text-center">
                    <div className="text-3xl mb-3">🥈</div>
                    <p className="text-[10px] text-[#e5e5e5]/30 uppercase tracking-wider mb-1">Runner Up</p>
                    <p className="text-white font-bold text-lg leading-tight">{teamPodium[2].name}</p>
                  </div>
                </div>
              ) : <div className="flex-1 max-w-[220px]" />}

              {/* Champion — centre, elevated */}
              {teamPodium[1] && (
                <div className="flex-1 max-w-[260px] -mb-4">
                  <div className="bg-brand/5 border-2 border-brand/40 rounded-2xl p-7 text-center shadow-[0_0_40px_rgba(0,255,65,0.08)]">
                    <div className="text-4xl mb-3">🥇</div>
                    <p className="text-[10px] text-brand/60 uppercase tracking-wider mb-1">Champion</p>
                    <p className="text-white font-black text-xl leading-tight">{teamPodium[1].name}</p>
                  </div>
                </div>
              )}

              {/* Third place — right */}
              {teamPodium[3] ? (
                <div className="flex-1 max-w-[220px]">
                  <div className="bg-surface border border-line rounded-2xl p-6 text-center">
                    <div className="text-3xl mb-3">🥉</div>
                    <p className="text-[10px] text-[#e5e5e5]/30 uppercase tracking-wider mb-1">Third Place</p>
                    <p className="text-white font-bold text-lg leading-tight">{teamPodium[3].name}</p>
                  </div>
                </div>
              ) : <div className="flex-1 max-w-[220px]" />}
            </div>

            {/* MVP */}
            {event.mvp_name && (
              <div className="mt-8 bg-surface border border-line rounded-2xl p-5 max-w-sm mx-auto text-center">
                <p className="text-[10px] text-[#e5e5e5]/30 uppercase tracking-wider mb-1">MVP / Player of the Tournament</p>
                <p className="text-white font-bold text-lg">{event.mvp_name}</p>
                {event.mvp_alias && <p className="text-brand/60 text-sm mt-0.5">{event.mvp_alias}</p>}
              </div>
            )}
          </section>
        )}

        {/* Side event results */}
        {hasSideEvents && (
          <section>
            <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-6">Side Event Results</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sideEventGroups.map(group => (
                <div key={group.division} className="bg-surface border border-line rounded-2xl p-5">
                  <p className="text-white font-bold mb-4">{group.label}</p>
                  <div className="space-y-2">
                    {group.entries.map(({ rank, name, subtitle }) => {
                      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`
                      return (
                        <div key={rank} className="flex items-center gap-3 text-sm">
                          <span className="text-base">{medal}</span>
                          <span className="text-[#e5e5e5]/70 font-medium">{name}</span>
                          {subtitle && <span className="text-[#e5e5e5]/35 text-xs">({subtitle})</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Full results text */}
        {event.full_results_text && (
          <section>
            <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-6">Full Results</p>
            <div className="bg-surface border border-line rounded-2xl p-6 md:p-8">
              <pre className="text-sm text-[#e5e5e5]/60 leading-relaxed whitespace-pre-wrap font-sans">
                {event.full_results_text}
              </pre>
            </div>
          </section>
        )}

        {/* Photo gallery */}
        {hasPhotos && (
          <section>
            <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-6">Photo Gallery</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {maskedPhotoUrls.map((url, i) => (
                <button
                  key={i}
                  onClick={() => setLightbox(i)}
                  className="relative aspect-square overflow-hidden rounded-xl bg-[#191919] border border-line hover:border-brand/30 transition-all group"
                >
                  <img src={url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Back link */}
        <div className="pt-4 border-t border-line">
          <Link to="/zltac" className="inline-flex items-center gap-1.5 text-sm text-[#e5e5e5]/40 hover:text-brand transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to ZLTAC history
          </Link>
        </div>
      </div>

      <Footer />

      {/* Lightbox */}
      {lightbox !== null && (
        <PhotoLightbox
          urls={maskedPhotoUrls}
          startIndex={lightbox}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}
