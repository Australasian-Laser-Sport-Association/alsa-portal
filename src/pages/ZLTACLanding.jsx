import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Footer from '../components/Footer'

// Hardcoded history for years before the DB was set up
const LEGACY_YEARS = [
  { year: 2018, location: 'Location TBC', winner: 'TBC', note: "The inaugural ZLTAC — the birth of Australasia's premier laser sport championship." },
  { year: 2019, location: 'Location TBC', winner: 'TBC', note: '' },
  { year: 2020, location: 'Location TBC', winner: 'TBC', note: 'Format adapted to meet the challenges of the year.' },
  { year: 2021, location: 'Location TBC', winner: 'TBC', note: '' },
  { year: 2022, location: 'Location TBC', winner: 'TBC', note: '' },
  { year: 2023, location: 'Location TBC', winner: 'TBC', note: 'Expanded side events program introduced.' },
  { year: 2024, location: 'Location TBC', winner: 'TBC', note: '' },
  { year: 2025, location: 'Location TBC', winner: 'TBC', note: 'Most recent completed championship.' },
]

function SideEventsCollapse({ sideEvents }) {
  const [open, setOpen] = useState(false)
  if (!sideEvents?.length) return null
  return (
    <div className="border-t border-line pt-3 mt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-xs text-[#e5e5e5]/40 hover:text-[#e5e5e5]/70 transition-colors"
      >
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        Side event winners ({sideEvents.length})
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {sideEvents.map((se, i) => (
            <div key={i} className="bg-[#0F0F0F] rounded-lg px-3 py-2">
              <p className="text-xs font-semibold text-[#e5e5e5]/60 mb-1.5">{se.name}</p>
              <div className="flex gap-4 text-xs text-[#e5e5e5]/40">
                {se.first_name && <span>🥇 {se.first_name}{se.first_alias ? ` (${se.first_alias})` : ''}</span>}
                {se.second_name && <span>🥈 {se.second_name}{se.second_alias ? ` (${se.second_alias})` : ''}</span>}
                {se.third_name && <span>🥉 {se.third_name}{se.third_alias ? ` (${se.third_alias})` : ''}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function FullResultsCollapse({ text }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  return (
    <div className="border-t border-line pt-3 mt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-xs text-brand/60 hover:text-brand transition-colors"
      >
        {open ? 'Hide full results ↑' : 'View full results →'}
      </button>
      {open && (
        <pre className="mt-3 text-xs text-[#e5e5e5]/50 leading-relaxed whitespace-pre-wrap font-sans border-t border-line pt-3">
          {text}
        </pre>
      )}
    </div>
  )
}

export default function ZLTACLanding() {
  const [historyRecords, setHistoryRecords] = useState([])
  const [archivedEvents, setArchivedEvents] = useState([])
  const [activeEvent, setActiveEvent] = useState(null)

  useEffect(() => {
    Promise.all([
      supabase
        .from('zltac_event_history')
        .select('id, year, name, location_city, location_state, logo_url, champion_team, champion_state, runner_up_team, runner_up_state, third_place_team, third_place_state, mvp_name, mvp_alias, side_event_results, full_results_text, photo_urls, description')
        .order('year', { ascending: false }),
      supabase.from('zltac_events').select('id, name, year, location').eq('status', 'archived').order('year', { ascending: true }),
      supabase.from('zltac_events').select('name, year').neq('status', 'archived').neq('status', 'draft').order('year', { ascending: false }).limit(1).maybeSingle(),
    ]).then(([{ data: history }, { data: archived }, { data: active }]) => {
      setHistoryRecords(history ?? [])
      setArchivedEvents(archived ?? [])
      setActiveEvent(active)
    })
  }, [])

  // Merge: history records by year take priority, then archived events not in history, then legacy
  const historyYears = new Set(historyRecords.map(e => e.year))
  const archivedNotInHistory = archivedEvents.filter(e => !historyYears.has(e.year))
  const allDbYears = new Set([...historyYears, ...archivedNotInHistory.map(e => e.year)])
  const legacyFiltered = LEGACY_YEARS.filter(e => !allDbYears.has(e.year))

  const timeline = [
    ...historyRecords.map(e => ({ ...e, type: 'history' })),
    ...archivedNotInHistory.map(e => ({
      year: e.year, name: e.name, location: e.location, type: 'archived',
    })),
    ...legacyFiltered.map(e => ({ ...e, type: 'legacy' })),
  ].sort((a, b) => b.year - a.year)

  const hasAnyHistory = timeline.length > 0

  return (
    <div className="bg-base text-white">

      {/* ── Hero ── */}
      <section
        className="relative py-28 border-b border-line overflow-hidden"
        style={{ background: 'radial-gradient(ellipse at 50% 100%, rgba(0,255,65,0.07) 0%, transparent 60%), #0F0F0F' }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(rgba(0,255,65,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,65,0.03) 1px, transparent 1px)`,
            backgroundSize: '72px 72px',
          }}
        />
        <div className="relative text-center px-6 max-w-3xl mx-auto">
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-4">The Championship</p>
          <h1 className="text-5xl md:text-6xl font-black text-white mb-4">ZLTAC</h1>
          <p className="text-brand font-semibold text-lg mb-6">Zone Laser Tag Australasian Championship</p>
          <p className="text-[#e5e5e5]/50 leading-relaxed">
            The most prestigious laser sport competition in Australasia — held annually since 2018.
          </p>
          {activeEvent && (
            <div className="mt-10">
              <Link
                to={`/events/${activeEvent.year}`}
                className="bg-brand hover:bg-brand-hover text-black font-bold px-8 py-4 rounded-xl transition-all hover:shadow-[0_0_24px_rgba(0,255,65,0.4)]"
              >
                View {activeEvent.name} →
              </Link>
            </div>
          )}
        </div>
      </section>

      {/* ── What is ZLTAC? ── */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-4">About the Event</p>
            <h2 className="text-4xl font-black text-white mb-6 leading-tight">What is ZLTAC?</h2>
            <div className="space-y-4 text-[#e5e5e5]/60 text-sm leading-relaxed">
              <p>ZLTAC — the Zone Laser Tag Australasian Championship — is the annual flagship event of the Australasian Laser Sport Association. Held each year, it brings together the best laser tag players and teams from across Australia and New Zealand to compete for Australasia's most coveted competitive laser sport title.</p>
              <p>The championship features both a main team competition and a programme of individual side events, giving players of all styles and skill levels the chance to test themselves against the best.</p>
              <p>All ZLTAC events are conducted under official ALSA rules and adjudicated by certified officials. Results and standings are recorded permanently in the ALSA registry.</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'First Held', value: '2018' },
              { label: 'Format', value: 'Teams + Individuals' },
              { label: 'Frequency', value: 'Annual' },
              { label: 'Region', value: 'AU & NZ' },
            ].map(({ label, value }) => (
              <div key={label} className="bg-surface border border-line rounded-2xl p-6 text-center">
                <p className="text-brand font-black text-2xl mb-1">{value}</p>
                <p className="text-[#e5e5e5]/40 text-xs uppercase tracking-wider">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Timeline ── */}
      <section className="bg-surface border-y border-line">
        <div className="max-w-7xl mx-auto px-6 py-20">
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3 text-center">Championship History</p>
          <h2 className="text-3xl font-black text-white text-center mb-3">ZLTAC Through the Years</h2>
          <p className="text-[#e5e5e5]/40 text-sm text-center mb-16 max-w-md mx-auto">
            {hasAnyHistory
              ? `${timeline.length} years of Australasian laser sport excellence. Every year a new champion.`
              : 'Building our championship legacy — results coming soon.'}
          </p>

          {!hasAnyHistory && (
            <div className="text-center py-16">
              <div className="w-16 h-16 bg-[#191919] rounded-2xl border border-line flex items-center justify-center mx-auto mb-5">
                <svg className="w-8 h-8 text-[#e5e5e5]/15" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-[#e5e5e5]/40 text-sm font-medium">Results coming soon</p>
              <p className="text-[#e5e5e5]/25 text-xs mt-1">
                Check back after {activeEvent ? `${activeEvent.name} ${activeEvent.year}` : 'the next ZLTAC event'}
              </p>
            </div>
          )}

          {hasAnyHistory && (
            <div className="relative max-w-3xl mx-auto">
              <div className="absolute left-[88px] top-0 bottom-0 w-px bg-line" />
              <div className="flex flex-col gap-0">
                {timeline.map((entry) => {
                  const isHistory = entry.type === 'history'
                  const isArchived = entry.type === 'archived'
                  const location = isHistory
                    ? [entry.location_city, entry.location_state].filter(Boolean).join(', ') || 'TBC'
                    : entry.location ?? 'TBC'

                  return (
                    <div key={entry.year} className="flex gap-0 group">
                      <div className="w-[88px] flex-shrink-0 text-right pr-6 pt-4">
                        <span className="text-brand font-black text-lg">{entry.year}</span>
                      </div>
                      <div className="relative flex-shrink-0 flex flex-col items-center">
                        <div
                          className="w-3 h-3 rounded-full bg-brand border-2 border-base relative z-10 group-hover:shadow-[0_0_10px_rgba(0,255,65,0.6)] transition-all"
                          style={{ marginTop: '18px' }}
                        />
                      </div>
                      <div className="flex-1 pl-6 pb-10">
                        <div className="bg-base border border-line hover:border-brand/30 rounded-xl p-5 transition-all">

                          {/* Header row */}
                          <div className="flex items-start gap-4 mb-3">
                            {isHistory && entry.logo_url && (
                              <img src={entry.logo_url} alt="" className="w-12 h-12 object-contain rounded-lg bg-[#191919] p-1 border border-line flex-shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-white font-bold">{entry.name || `ZLTAC ${entry.year}`}</p>
                              </div>
                              <p className="text-[#e5e5e5]/40 text-xs mt-0.5">{location}</p>
                            </div>
                          </div>

                          {/* Rich history card */}
                          {isHistory && (
                            <>
                              {/* Podium */}
                              {(entry.champion_team || entry.runner_up_team || entry.third_place_team) && (
                                <div className="flex gap-3 mb-3">
                                  {entry.champion_team && (
                                    <div className="flex-1 bg-[#191919] rounded-lg px-3 py-2 text-center">
                                      <p className="text-[10px] text-[#e5e5e5]/30 uppercase tracking-wider mb-0.5">🥇 Champion</p>
                                      <p className="text-white text-xs font-bold truncate">{entry.champion_team}</p>
                                      {entry.champion_state && <p className="text-[#e5e5e5]/40 text-[10px]">{entry.champion_state}</p>}
                                    </div>
                                  )}
                                  {entry.runner_up_team && (
                                    <div className="flex-1 bg-[#191919] rounded-lg px-3 py-2 text-center">
                                      <p className="text-[10px] text-[#e5e5e5]/30 uppercase tracking-wider mb-0.5">🥈 Runner Up</p>
                                      <p className="text-[#e5e5e5]/70 text-xs font-semibold truncate">{entry.runner_up_team}</p>
                                      {entry.runner_up_state && <p className="text-[#e5e5e5]/40 text-[10px]">{entry.runner_up_state}</p>}
                                    </div>
                                  )}
                                  {entry.third_place_team && (
                                    <div className="flex-1 bg-[#191919] rounded-lg px-3 py-2 text-center">
                                      <p className="text-[10px] text-[#e5e5e5]/30 uppercase tracking-wider mb-0.5">🥉 Third</p>
                                      <p className="text-[#e5e5e5]/60 text-xs font-semibold truncate">{entry.third_place_team}</p>
                                      {entry.third_place_state && <p className="text-[#e5e5e5]/40 text-[10px]">{entry.third_place_state}</p>}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* MVP */}
                              {entry.mvp_name && (
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="text-[10px] text-[#e5e5e5]/30 uppercase tracking-wider">MVP</span>
                                  <span className="text-xs text-[#e5e5e5]/60 font-medium">
                                    {entry.mvp_name}{entry.mvp_alias ? ` (${entry.mvp_alias})` : ''}
                                  </span>
                                </div>
                              )}

                              {/* Photo thumbnails */}
                              {entry.photo_urls?.length > 0 && (
                                <div className="flex gap-1.5 mb-2 flex-wrap">
                                  {entry.photo_urls.slice(0, 5).map((url, i) => (
                                    <img key={i} src={url} alt="" className="h-10 w-14 object-cover rounded bg-[#191919]" />
                                  ))}
                                  {entry.photo_urls.length > 5 && (
                                    <div className="h-10 w-14 rounded bg-[#191919] border border-line flex items-center justify-center text-[10px] text-[#e5e5e5]/30">
                                      +{entry.photo_urls.length - 5}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Side events collapse */}
                              <SideEventsCollapse sideEvents={entry.side_event_results} />

                              {/* Full results collapse */}
                              <FullResultsCollapse text={entry.full_results_text} />

                              {/* View detail link */}
                              <div className="mt-3 pt-3 border-t border-line">
                                <Link
                                  to={`/zltac/${entry.year}`}
                                  className="inline-block text-brand/60 hover:text-brand text-xs transition-colors"
                                >
                                  View {entry.year} full details →
                                </Link>
                              </div>
                            </>
                          )}

                          {/* Basic archived event card */}
                          {isArchived && (
                            <>
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <p className="text-[#e5e5e5]/25 text-xs uppercase tracking-wider mb-0.5">Champion</p>
                                  <p className="text-[#e5e5e5]/60 text-sm font-semibold">TBC</p>
                                </div>
                              </div>
                              <Link
                                to={`/events/${entry.year}`}
                                className="inline-block text-brand/60 hover:text-brand text-xs mt-3 transition-colors"
                              >
                                View {entry.year} results →
                              </Link>
                            </>
                          )}

                          {/* Legacy card */}
                          {entry.type === 'legacy' && (
                            <>
                              <div className="flex items-start justify-between gap-4">
                                <div>
                                  <p className="text-[#e5e5e5]/25 text-xs uppercase tracking-wider mb-0.5">Champion</p>
                                  <p className="text-[#e5e5e5]/60 text-sm font-semibold">{entry.winner ?? 'TBC'}</p>
                                </div>
                              </div>
                              {entry.note && (
                                <p className="text-[#e5e5e5]/35 text-xs leading-relaxed border-t border-line pt-3 mt-3">{entry.note}</p>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {activeEvent && (
            <div className="text-center mt-6">
              <Link
                to={`/events/${activeEvent.year}`}
                className="inline-block bg-brand hover:bg-brand-hover text-black font-bold px-8 py-4 rounded-xl transition-all hover:shadow-[0_0_24px_rgba(0,255,65,0.4)]"
              >
                Enter {activeEvent.name} →
              </Link>
            </div>
          )}
        </div>
      </section>

      <Footer />
    </div>
  )
}
