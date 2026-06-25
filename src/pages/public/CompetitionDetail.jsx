import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Footer from '../../components/Footer'
import { useAuth } from '../../lib/useAuth'
import { apiFetch } from '../../lib/apiFetch.js'
import { formatDateRange, formatDateTime } from '../../lib/dateFormat'
import { storageImageSrcSet, storageImageUrl } from '../../lib/assetUrl'
import { dollars } from '../../lib/pricing.js'

// Public competition detail page. Anon-readable. The registration CTA gates
// on auth: unauthenticated users are routed to /login?redirect=<this page>
// so they return here (the public registration target lives at
// /competitions/:slug/register, landing in Phase 3c — for now the CTA
// is a placeholder that surfaces 'Coming soon').

function windowState(comp) {
  const now = new Date()
  const open = comp.registration_open_at ? new Date(comp.registration_open_at) : null
  const close = comp.registration_close_at ? new Date(comp.registration_close_at) : null
  if (close && now > close) return 'closed'
  if (open && now < open) return 'not_yet_open'
  return 'open'
}

const TONE = {
  green: 'bg-green-500/15 text-green-400 border-green-500/30',
  amber: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  grey:  'bg-[#374056] text-white border-line',
}

function Pill({ tone, children }) {
  return (
    <span className={`inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded border whitespace-nowrap ${TONE[tone]}`}>
      {children}
    </span>
  )
}

function Fact({ label, value }) {
  return (
    <div>
      <p className="text-white text-[10px] font-bold uppercase tracking-wider opacity-50 mb-1">{label}</p>
      <p className="text-white text-sm">{value || <span className="opacity-40">Not set</span>}</p>
    </div>
  )
}

function fullName(p) {
  return [p.first_name, p.last_name].filter(Boolean).join(' ')
}

// Description + structured links sections. Rendered when either field is
// populated; the whole region is omitted if both are empty so the page reads
// the same as before Phase 2a.
function DescriptionAndLinks({ description, links }) {
  const trimmed = typeof description === 'string' ? description.trim() : ''
  const hasDescription = trimmed.length > 0
  const cleanLinks = Array.isArray(links)
    ? links.filter(l => l && typeof l.label === 'string' && typeof l.url === 'string' && l.label.trim() && l.url.trim())
    : []
  const hasLinks = cleanLinks.length > 0
  if (!hasDescription && !hasLinks) return null

  return (
    <>
      {hasDescription && (
        <div>
          <h2 className="text-white text-xs font-bold uppercase tracking-[0.2em] mb-4 opacity-70">About</h2>
          <div className="bg-surface border border-line rounded-2xl p-6">
            <p className="text-white text-sm leading-relaxed whitespace-pre-wrap">{trimmed}</p>
          </div>
        </div>
      )}

      {hasLinks && (
        <div>
          <h2 className="text-white text-xs font-bold uppercase tracking-[0.2em] mb-4 opacity-70">Schedule + Resources</h2>
          <div className="space-y-2">
            {cleanLinks.map((l, i) => (
              <a
                key={`link-${i}`}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block bg-surface hover:bg-line/40 border border-line rounded-2xl px-4 py-3 transition-colors"
              >
                <p className="text-brand font-bold text-sm">{l.label}</p>
                <p className="text-white text-[11px] opacity-50 mt-0.5 break-all">{l.url}</p>
              </a>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function PlayerLine({ player }) {
  const name = fullName(player)
  return (
    <p className="text-white text-sm">
      {player.alias
        ? <span className="text-brand font-semibold">"{player.alias}"</span>
        : <span className="opacity-50">(no alias)</span>}
      {name && <span className="ml-2 opacity-80">{name}</span>}
    </p>
  )
}

function TeamCard({ team }) {
  const memberCount = (team.captain ? 1 : 0) + team.members.length
  return (
    <div className="bg-surface border border-line rounded-2xl p-5">
      <div className="flex items-center gap-3 mb-3">
        <div
          className="w-7 h-7 rounded-lg border border-line flex-shrink-0"
          style={{ background: team.colour }}
          aria-label="Team colour"
        />
        <p className="text-white font-bold flex-1 min-w-0 truncate">{team.name}</p>
        <span className="text-white text-[11px] opacity-50 whitespace-nowrap">
          {memberCount === 1 ? '1 player' : `${memberCount} players`}
        </span>
      </div>
      <div className="space-y-1.5">
        {team.captain && (
          <div className="flex items-center gap-2">
            <span className="inline-block text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/30">
              C
            </span>
            <PlayerLine player={team.captain} />
          </div>
        )}
        {team.members.map((m, i) => (
          <div key={`${team.id}-m-${i}`} className="pl-6">
            <PlayerLine player={m} />
          </div>
        ))}
      </div>
    </div>
  )
}

function RosterSection({ slug }) {
  const [roster, setRoster] = useState(null) // null = loading; false = error
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/public?resource=roster&slug=${encodeURIComponent(slug)}`)
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => { if (!cancelled) setRoster(data) })
      .catch(() => { if (!cancelled) setRoster(false) })
    return () => { cancelled = true }
  }, [slug, reloadKey])

  function retry() {
    setRoster(null)
    setReloadKey(k => k + 1)
  }

  if (roster === null) {
    return (
      <div>
        <h2 className="text-white text-xs font-bold uppercase tracking-[0.2em] mb-4 opacity-70">Registered Teams</h2>
        <p className="text-white text-sm opacity-50">Loading roster...</p>
      </div>
    )
  }

  if (roster === false) {
    return (
      <div>
        <h2 className="text-white text-xs font-bold uppercase tracking-[0.2em] mb-4 opacity-70">Registered Teams</h2>
        <div className="bg-surface border border-line rounded-2xl p-5">
          <p className="text-white text-sm mb-3">Could not load the roster right now. Please try again.</p>
          <button
            type="button"
            onClick={retry}
            className="border border-line text-white text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-line/40 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  const hasTeams = roster.teams.length > 0
  const hasUnteamed = roster.unteamed_players.length > 0
  if (!hasTeams && !hasUnteamed) return null

  // Header copy varies: pure-unteamed renders as "Registered Players"; any
  // teams present render as "Registered Teams" with a follow-on unteamed
  // section if applicable.
  if (!hasTeams && hasUnteamed) {
    return (
      <div>
        <h2 className="text-white text-xs font-bold uppercase tracking-[0.2em] mb-4 opacity-70">Registered Players</h2>
        <div className="bg-surface border border-line rounded-2xl p-5 space-y-1.5">
          {roster.unteamed_players.map((p, i) => (
            <PlayerLine key={`u-${i}`} player={p} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <h2 className="text-white text-xs font-bold uppercase tracking-[0.2em] mb-4 opacity-70">Registered Teams</h2>
      <div className="space-y-3">
        {roster.teams.map(t => <TeamCard key={t.id} team={t} />)}
      </div>
      {hasUnteamed && (
        <div className="mt-8">
          <h3 className="text-white text-xs font-bold uppercase tracking-[0.2em] mb-4 opacity-70">
            Registered Players (Not On A Team)
          </h3>
          <div className="bg-surface border border-line rounded-2xl p-5 space-y-1.5">
            {roster.unteamed_players.map((p, i) => (
              <PlayerLine key={`u-${i}`} player={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function CompetitionDetail() {
  const { slug } = useParams()
  const { user, loading: authLoading } = useAuth()
  const [comp, setComp] = useState(null) // null = loading; false = not found
  const [error, setError] = useState(null)
  // null             = no probe result yet (anon: stays null forever;
  //                    authenticated: transient while the probe is in flight)
  // 'registered'     = caller has a registration row for this competition
  // 'not_registered' = caller authenticated but no row (also the fallback on
  //                    probe failure — the register page handles duplicate-
  //                    registration cleanly if the fallback was wrong)
  // The "checking" UI state is derived from (user && regState === null) at
  // render time rather than stored, so we never sync-setState inside the
  // effect.
  const [regState, setRegState] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/public?resource=competitions&slug=${encodeURIComponent(slug)}`)
      .then(async r => {
        if (r.status === 404) return false
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(data => { if (!cancelled) setComp(data) })
      .catch(err => { if (!cancelled) { setError(err.message); setComp(false) } })
    return () => { cancelled = true }
  }, [slug])

  // Registration probe — only runs once we know who the caller is AND have
  // the competition id. Anon callers skip the probe entirely (regState stays
  // null and the CTA falls into the !user branch).
  useEffect(() => {
    if (authLoading || !user) return
    if (!comp || comp === false) return
    let cancelled = false
    apiFetch(`/api/superadmin/competition-registration?competition_id=${comp.id}`)
      .then(() => { if (!cancelled) setRegState('registered') })
      .catch(() => { if (!cancelled) setRegState('not_registered') })
    return () => { cancelled = true }
  }, [authLoading, user, comp])

  if (comp === null) {
    return (
      <div className="bg-base text-white min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (comp === false) {
    return (
      <div className="bg-base text-white min-h-screen flex flex-col">
        <section className="flex-1 max-w-2xl w-full mx-auto px-6 py-16">
          <Link to="/competitions" className="text-white opacity-60 hover:opacity-100 text-xs transition-colors mb-5 inline-block">
            ← Back to competitions
          </Link>
          <div className="bg-surface border border-line rounded-2xl p-6">
            <p className="text-white font-bold mb-2">Competition not found</p>
            <p className="text-white text-sm opacity-70">
              We could not find a competition with that URL. It may have been archived or the registration window may have closed.
            </p>
            {error && <p className="text-red-400 text-xs mt-3">{error}</p>}
          </div>
        </section>
        <Footer />
      </div>
    )
  }

  const state = windowState(comp)
  const winPill =
    state === 'closed' ? { tone: 'grey', label: 'Closed' } :
    state === 'not_yet_open' ? { tone: 'amber', label: `Opens ${formatDateTime(comp.registration_open_at)}` } :
    { tone: 'green', label: comp.registration_close_at ? `Closes ${formatDateTime(comp.registration_close_at)}` : 'Open' }

  // The registration target lives at /competitions/:slug/register (Phase 3c).
  // For now this page links there; until 3c ships, the route falls through to
  // the global NotFound route. The CTA text is honest about that for
  // authenticated users; sign-in users go through /login first and land on
  // the same target after auth.
  const registerPath = `/competitions/${comp.slug}/register`
  const signInPath = `/login?redirect=${encodeURIComponent(registerPath)}`

  return (
    <div className="bg-base text-white min-h-screen flex flex-col">
      {comp.banner_url && (
        <section className="max-w-5xl mx-auto px-6 pt-8">
          <img
            src={storageImageUrl(comp.banner_url, { width: 1280, quality: 72, resize: 'cover' })}
            srcSet={storageImageSrcSet(comp.banner_url, [768, 1280, 1600], { quality: 72, resize: 'cover' })}
            sizes="(max-width: 1024px) calc(100vw - 3rem), 1024px"
            alt={`${comp.name} banner`}
            loading="eager"
            decoding="async"
            className="w-full aspect-[4096/1716] object-cover rounded-2xl"
          />
        </section>
      )}

      <section
        className="relative py-20 border-b border-line overflow-hidden"
        style={{ background: 'radial-gradient(ellipse at 50% 100%, rgba(0,255,65,0.07) 0%, transparent 60%), #0F0F0F' }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(rgba(0,255,65,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,65,0.03) 1px, transparent 1px)`,
            backgroundSize: '72px 72px',
          }}
        />
        <div className="relative max-w-3xl mx-auto px-6">
          <Link to="/competitions" className="text-white opacity-60 hover:opacity-100 text-xs transition-colors mb-5 inline-block">
            ← Back to competitions
          </Link>
          <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3">Competition</p>
          <h1 className="text-4xl md:text-5xl font-black text-white mb-4">{comp.name}</h1>
          <div className="flex flex-wrap items-center gap-3 text-white text-sm opacity-80">
            <span>{formatDateRange(comp.start_date, comp.end_date)}</span>
            <span className="opacity-30">·</span>
            <Pill tone={winPill.tone}>{winPill.label}</Pill>
          </div>
        </div>
      </section>

      <section className="flex-1 max-w-3xl w-full mx-auto px-6 py-12 space-y-6">
        <div className="bg-surface border border-line rounded-2xl p-6">
          <p className="text-white text-xs font-bold uppercase tracking-wider mb-4">Quick facts</p>
          <div className="grid grid-cols-2 gap-4">
            <Fact label="Dates" value={formatDateRange(comp.start_date, comp.end_date)} />
            <Fact
              label="Price per player"
              value={comp.price_per_player != null ? `${dollars(comp.price_per_player)} AUD` : null}
            />
            <Fact label="Registration opens" value={comp.registration_open_at ? formatDateTime(comp.registration_open_at) : null} />
            <Fact label="Registration closes" value={comp.registration_close_at ? formatDateTime(comp.registration_close_at) : null} />
          </div>
        </div>

        <div className="bg-surface border border-brand/30 rounded-2xl p-8 text-center">
          {state === 'closed' && (
            <>
              <p className="text-white text-lg font-bold mb-2">Registration is closed for this event.</p>
              <p className="text-white opacity-70 text-sm">Contact ALSA if you have any questions.</p>
            </>
          )}

          {state === 'not_yet_open' && (
            <>
              <p className="text-white text-lg font-bold mb-2">
                Registration opens {formatDateTime(comp.registration_open_at)}
              </p>
              <p className="text-white opacity-70 text-sm">Check back when registration opens to secure your spot.</p>
            </>
          )}

          {state === 'open' && (
            <>
              {regState === 'registered' ? (
                <>
                  <p className="text-white text-xs opacity-60 mb-3">You're registered for this event.</p>
                  <Link
                    to={`/competitions/${comp.slug}/hub`}
                    className="inline-block bg-line hover:bg-[#374056] text-white font-bold px-6 py-3 rounded-xl text-sm transition-colors border border-line"
                  >
                    Manage your registration
                  </Link>
                </>
              ) : (
                <>
                  <p className="text-white text-lg font-bold mb-4">Ready to compete?</p>
                  {authLoading ? (
                    <div className="w-6 h-6 mx-auto border-2 border-brand border-t-transparent rounded-full animate-spin" />
                  ) : user && regState === null ? (
                    <p className="text-white text-sm opacity-60">Checking your registration...</p>
                  ) : user ? (
                    <Link
                      to={registerPath}
                      className="inline-block bg-brand hover:bg-brand-hover text-black font-bold px-6 py-3 rounded-xl text-sm transition-all"
                    >
                      Register now
                    </Link>
                  ) : (
                    <Link
                      to={signInPath}
                      className="inline-block bg-brand hover:bg-brand-hover text-black font-bold px-6 py-3 rounded-xl text-sm transition-all"
                    >
                      Sign in to register
                    </Link>
                  )}
                  {comp.registration_close_at && (
                    <p className="text-white opacity-50 text-xs mt-4">
                      Closes {formatDateTime(comp.registration_close_at)}
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <DescriptionAndLinks description={comp.description} links={comp.links} />

        <RosterSection slug={comp.slug} />
      </section>

      <Footer />
    </div>
  )
}
