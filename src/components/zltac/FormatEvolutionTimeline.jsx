import { useEffect, useRef, useState } from 'react'
import { zltacHistory } from '../../data/zltacHistory'

// ── Sparkline ────────────────────────────────────────────────────────────────
function TournamentGrowthSparkline() {
  const data = zltacHistory.events
    .filter(e => e.year >= 1999 && e.year <= 2026)
    .map(e => ({
      year: e.year,
      count: e.teamCount,
      location: e.location ?? null,
      state: e.state ?? null,
      cancelled: !!e.cancelled,
    }))
    .sort((a, b) => a.year - b.year)

  const xMin = 1999
  const xMax = 2026
  const yMax = 40
  const W = 800
  const H = 130
  const padX = 18
  const padTop = 22
  const padBottom = 38
  const plotW = W - 2 * padX
  const plotH = H - padTop - padBottom
  const baselineY = padTop + plotH

  const xs = (year) => padX + ((year - xMin) / (xMax - xMin)) * plotW
  const ys = (count) => padTop + (1 - count / yMax) * plotH

  // Interpolate the 2021 y-value across the gap (2020=30, 2022=24 → 27)
  const y2020 = data.find(d => d.year === 2020).count
  const y2022 = data.find(d => d.year === 2022).count
  const interp2021 = (y2020 + y2022) / 2

  // Build a single continuous line/area path including an interpolated 2021.
  const linePoints = data.map(d => {
    if (d.year === 2021) return { year: 2021, x: xs(2021), y: ys(interp2021) }
    return { year: d.year, x: xs(d.year), y: ys(d.count) }
  })

  const linePath = linePoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ')

  const first = linePoints[0]
  const last = linePoints[linePoints.length - 1]
  const areaPath =
    `M${first.x.toFixed(1)} ${baselineY.toFixed(1)} ` +
    linePoints.map(p => `L${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') +
    ` L${last.x.toFixed(1)} ${baselineY.toFixed(1)} Z`

  // Callout config — 1999/2018 anchor "start" (labels extend right of dot),
  // 2016/2026 anchor "end" (labels extend left). This staggers 2016 and 2018
  // (the closest pair on the x-axis) so their multi-line labels don't collide.
  const callouts = [
    { year: 1999, anchor: 'start' },
    { year: 2016, anchor: 'end' },
    { year: 2018, anchor: 'start', emphasis: true, locationSuffix: ', largest field' },
    { year: 2026, anchor: 'end' },
  ]
  const calloutYears = new Set(callouts.map(c => c.year))

  // Hover state — cursor coords (in SVG units) + nearest-year data
  const [hover, setHover] = useState(null)
  const svgRef = useRef(null)
  const wrapperRef = useRef(null)

  function nearestYear(svgX) {
    let nearest = null
    let bestDist = Infinity
    for (const d of data) {
      const dist = Math.abs(xs(d.year) - svgX)
      if (dist < bestDist) {
        bestDist = dist
        nearest = d
      }
    }
    return nearest
  }

  function pointerToSvg(clientX, clientY) {
    const svg = svgRef.current
    if (!svg) return null
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    return pt.matrixTransform(ctm.inverse())
  }

  function setHoverFromPointer(clientX, clientY) {
    const local = pointerToSvg(clientX, clientY)
    if (!local) return
    const yr = nearestYear(local.x)
    if (!yr) return
    setHover({
      year: yr.year,
      count: yr.count,
      location: yr.location,
      state: yr.state,
      cursorX: local.x,
      cursorY: local.y,
    })
  }

  function handleMouseMove(e) {
    setHoverFromPointer(e.clientX, e.clientY)
  }

  function handleTouchStart(e) {
    if (e.touches.length > 0) {
      setHoverFromPointer(e.touches[0].clientX, e.touches[0].clientY)
    }
  }

  function handleMouseLeave() {
    setHover(null)
  }

  // Tap outside the chart hides the tooltip on touch devices.
  useEffect(() => {
    function onDocTouch(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setHover(null)
      }
    }
    document.addEventListener('touchstart', onDocTouch, { passive: true })
    return () => document.removeEventListener('touchstart', onDocTouch)
  }, [])

  // Active-dot lookup: highlight the dot for the hovered year (if it has data).
  const activeYear = hover?.year ?? null
  const activeYDot =
    activeYear === 2021
      ? null  // 2021 has no real dot; the red marker shows highlight separately.
      : data.find(d => d.year === activeYear && d.count != null) ?? null

  // Tooltip positioning: anchor to cursor, flip near right edge.
  const flipX = hover ? hover.cursorX > W * 0.7 : false
  const tooltipTransform = flipX
    ? 'translate(calc(-100% - 12px), -100%)'
    : 'translate(12px, -100%)'

  return (
    <div className="relative" ref={wrapperRef}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full block"
        role="img"
        aria-label="Team count per year, 1999 to 2026"
      >
        <defs>
          <filter id="zltac-spark-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="1.6" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Filled area under the continuous line */}
        <path d={areaPath} fill="rgba(192, 132, 252, 0.10)" />

        {/* Continuous purple line including interpolated 2021 */}
        <path
          d={linePath}
          fill="none"
          stroke="#c084fc"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#zltac-spark-glow)"
        />

        {/* Real-data dots (every year except 2021) */}
        {data
          .filter(d => d.count != null)
          .map(d => {
            const isActive = activeYDot?.year === d.year
            const baseR = calloutYears.has(d.year) ? 3.5 : 2.5
            const r = isActive ? baseR * 1.5 : baseR
            return (
              <circle
                key={d.year}
                cx={xs(d.year)}
                cy={ys(d.count)}
                r={r}
                fill="#c084fc"
                stroke={isActive ? '#d8b4fe' : 'none'}
                strokeWidth={isActive ? 1.5 : 0}
              />
            )
          })}

        {/* 2021 — red marker dot at interpolated y */}
        {(() => {
          const isActive = activeYear === 2021
          const r = isActive ? 4.5 : 3
          return (
            <circle
              cx={xs(2021)}
              cy={ys(interp2021)}
              r={r}
              fill="#ef4444"
              stroke={isActive ? '#fca5a5' : 'none'}
              strokeWidth={isActive ? 1.5 : 0}
            />
          )
        })()}
        {/* Dashed vertical riser above the red dot */}
        <line
          x1={xs(2021)}
          y1={ys(interp2021) - 4}
          x2={xs(2021)}
          y2={ys(interp2021) - plotH * 0.25}
          stroke="#ef4444"
          strokeOpacity="0.4"
          strokeWidth="1"
          strokeDasharray="2,3"
        />
        {/* Label above the riser — stacked on two lines, centered on the dot */}
        <text
          x={xs(2021)}
          y={ys(interp2021) - plotH * 0.25 - 14}
          textAnchor="middle"
          style={{ fill: '#ef4444', fontSize: '7.5px', fontWeight: 700, letterSpacing: '0.04em' }}
        >
          <tspan x={xs(2021)}>2021</tspan>
          <tspan x={xs(2021)} dy="10">COVID cancelled</tspan>
        </text>

        {/* Callouts — 4 labelled points: 1999, 2016, 2018 (peak), 2026.
            Each has 3 lines: "{N} teams" above dot, "{location}, {state}" below,
            and the year as the bottom-most line. */}
        {callouts.map(c => {
          const ev = data.find(d => d.year === c.year)
          if (!ev || ev.count == null) return null
          const x = xs(c.year)
          const y = ys(ev.count)
          const baseLocation = `${ev.location}, ${ev.state}`
          const locationLabel = c.locationSuffix ? `${baseLocation}${c.locationSuffix}` : baseLocation
          return (
            <g key={`callout-${c.year}`}>
              <text
                x={x}
                y={y - 9}
                textAnchor={c.anchor}
                style={{
                  fill: '#c084fc',
                  fontSize: c.emphasis ? '10.5px' : '9.5px',
                  fontWeight: c.emphasis ? 800 : 700,
                }}
              >
                {ev.count} teams
              </text>
              <text
                x={x}
                y={baselineY + 12}
                textAnchor={c.anchor}
                style={{
                  fill: 'rgba(229, 229, 229, 0.6)',
                  fontSize: c.emphasis ? '8.5px' : '7.5px',
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                }}
              >
                {locationLabel}
              </text>
              <text
                x={x}
                y={baselineY + 23}
                textAnchor={c.anchor}
                style={{
                  fill: 'rgba(229, 229, 229, 0.4)',
                  fontSize: '7.5px',
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                }}
              >
                {c.year}
              </text>
            </g>
          )
        })}

        {/* Invisible hover overlay covering the plot area */}
        <rect
          x={padX}
          y={padTop}
          width={plotW}
          height={plotH}
          fill="transparent"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onTouchStart={handleTouchStart}
        />
      </svg>

      {/* Tooltip — anchored to cursor, content = nearest year */}
      {hover && (
        <div
          className="absolute pointer-events-none z-10 transition-opacity bg-[#1a1a1a] border border-purple-400/40 rounded-md px-3 py-2 text-xs shadow-lg shadow-black/40"
          style={{
            left: `${(hover.cursorX / W) * 100}%`,
            top: `${(hover.cursorY / H) * 100}%`,
            transform: tooltipTransform,
          }}
        >
          <p className="text-white font-bold leading-tight">{hover.year}</p>
          {hover.year === 2021 ? (
            <>
              <p className="text-[#e5e5e5]/60 leading-tight mt-0.5">Cancelled, COVID</p>
              <p className="text-purple-400 leading-tight mt-0.5">No event</p>
            </>
          ) : (
            <>
              <p className="text-[#e5e5e5]/60 leading-tight mt-0.5">
                {[hover.location, hover.state].filter(Boolean).join(', ')}
              </p>
              <p className="text-purple-400 leading-tight mt-0.5">
                {hover.count} team{hover.count !== 1 ? 's' : ''}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function FormatEvolutionTimeline() {
  const milestones = zltacHistory.formatEvolution

  return (
    <section className="max-w-7xl mx-auto px-6 pt-20 md:pt-24 pb-10 md:pb-12">
      <div className="text-center mb-12">
        <p className="text-brand text-xs font-bold uppercase tracking-[0.2em] mb-3">Format Evolution</p>
        <h2 className="text-3xl md:text-4xl font-black text-white mb-3">From One Format to Eight</h2>
        <p
          className="text-white/80 text-sm md:text-base leading-relaxed max-w-3xl mx-auto text-center"
          style={{ color: 'rgba(255, 255, 255, 0.8)' }}
        >
          The championship has grown from a single event in Box Hill, VIC in 1999, then known as the Australian Zone 3 Nationals, with just 7 teams and ~40 players competing solely in the Teams event, to ZLTAC as it's known today: every state competing, consistently 25+ teams each year, with the highest recorded attendance in Albury, NSW in 2018 at 37 teams and ~200 players. ZLTAC now spans 8 formats: the premier Teams event and 7 side events, Solos, Doubles, Triples, Masters, Womens, Juniors, and Lord of the Rings.
        </p>
      </div>

      {/* Horizontal timeline (md+) */}
      <div className="hidden md:block relative">
        <div className="absolute top-7 left-0 right-0 h-px bg-line" />
        <div className="absolute top-7 left-0 h-px bg-brand/60" style={{ width: '100%' }} />
        <div className="grid grid-cols-5 gap-2 relative">
          {milestones.map(({ era, added, divisionCount }) => (
            <div key={era} className="text-center">
              <div className="flex justify-center mb-3">
                <div
                  className="w-14 h-14 rounded-full bg-base border-2 border-brand flex items-center justify-center font-black text-brand text-sm"
                  style={{ boxShadow: '0 0 16px rgba(0,255,65,0.25)' }}
                >
                  {divisionCount}
                </div>
              </div>
              <p className="text-brand font-black text-base mb-1">{era}</p>
              <div className="flex flex-wrap justify-center gap-1 mb-1">
                {added.map(name => (
                  <span
                    key={name}
                    className="text-[10px] font-bold uppercase tracking-wider bg-brand/10 text-brand border border-brand/20 px-2 py-0.5 rounded-full"
                  >
                    + {name}
                  </span>
                ))}
              </div>
              <p className="text-[#e5e5e5]/35 text-[10px] uppercase tracking-wider">
                {divisionCount} format{divisionCount !== 1 ? 's' : ''}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Vertical list (mobile) */}
      <div className="md:hidden space-y-4">
        {milestones.map(({ era, added, divisionCount }) => (
          <div key={era} className="bg-surface border border-line rounded-xl p-4 flex items-center gap-4">
            <div
              className="w-12 h-12 rounded-full bg-base border-2 border-brand flex items-center justify-center font-black text-brand flex-shrink-0"
              style={{ boxShadow: '0 0 12px rgba(0,255,65,0.2)' }}
            >
              {divisionCount}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-brand font-black text-base">{era}</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {added.map(name => (
                  <span
                    key={name}
                    className="text-[10px] font-bold uppercase tracking-wider bg-brand/10 text-brand border border-brand/20 px-2 py-0.5 rounded-full"
                  >
                    + {name}
                  </span>
                ))}
              </div>
              <p className="text-[#e5e5e5]/35 text-[10px] uppercase tracking-wider mt-1">
                {divisionCount} format{divisionCount !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Tournament Growth sparkline — visually subordinate, same container */}
      <div className="mt-12 md:mt-16 pt-8 md:pt-10 border-t border-line">
        <p className="text-[#e5e5e5]/60 text-xs font-bold uppercase tracking-widest text-center mb-4">
          Tournament Growth
        </p>
        <div className="md:max-w-4xl md:mx-auto">
          <TournamentGrowthSparkline />
          <p className="text-[#e5e5e5]/40 text-[10px] uppercase tracking-widest text-center mt-3">
            Team count per year, 1999-2026
          </p>
        </div>
      </div>
    </section>
  )
}
