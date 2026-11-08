import { forwardRef } from 'react'

/** Blocks of buildings for one layer of the skyline, the same on every load */
function blocks(seed: number, minHeight: number, maxHeight: number, minWidth: number, maxWidth: number) {
  let state = seed
  const next = () => ((state = (state * 16807) % 2147483647) / 2147483647)
  const list: { x: number; width: number; height: number }[] = []
  for (let x = 0; x < 400;) {
    const width = Math.round(minWidth + next() * (maxWidth - minWidth))
    list.push({ x, width, height: Math.round(minHeight + next() ** 1.4 * (maxHeight - minHeight)) })
    x += width
  }
  const d = 'M0 186' + list.map(({ x, width, height }) => `V${186 - height}H${Math.min(400, x + width)}`).join('') + 'V186Z'
  return { d, list, next }
}

const FAR = blocks(7, 34, 104, 10, 22)
const MID = blocks(41, 22, 74, 14, 30)
const NEAR = blocks(97, 10, 44, 18, 38)
// A few softly lit windows on the nearer layers; some flicker slowly
const WINDOWS = [MID, NEAR].flatMap((layer, depth) =>
  layer.list.flatMap(({ x, width, height }) => {
    if (layer.next() > 0.55 || width < 14) return []
    const count = 1 + Math.floor(layer.next() * 2)
    return Array.from({ length: count }, () => ({
      x: x + 3 + Math.floor(layer.next() * (width - 8)),
      y: 186 - height + 5 + Math.floor(layer.next() * Math.max(1, height - 14)),
      flicker: layer.next() < 0.3,
      bright: depth === 1,
    }))
  }))

/** A city skyline at dusk: three layers of generic towers (not a map of real
 *  buildings) against a glow along the horizon, standing in a strip of water.
 *  Drawn here, so nothing is downloaded; it is a box of its own below the words. */
export const Skyline = forwardRef<SVGSVGElement, { className?: string }>(function Skyline({ className }, ref) {
  const wave = 'M0 190 q50 -5 100 0' + ' t100 0'.repeat(7)
  return (
    <svg ref={ref} viewBox="0 0 400 200" className={className} aria-hidden focusable="false" preserveAspectRatio="xMidYMax slice">
      <defs>
        <linearGradient id="fw-horizon" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--brand-accent)', stopOpacity: 0 }} />
          <stop offset="1" style={{ stopColor: 'var(--brand-accent)', stopOpacity: 0.5 }} />
        </linearGradient>
        <linearGradient id="fw-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'color-mix(in srgb, var(--brand-sky-bottom), var(--brand-accent) 28%)' }} />
          <stop offset="1" style={{ stopColor: 'var(--brand-sky-top)' }} />
        </linearGradient>
        <filter id="fw-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="1.4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <rect x="0" y="110" width="400" height="76" fill="url(#fw-horizon)" />
      <path d={FAR.d} style={{ fill: 'color-mix(in srgb, var(--brand-sky-bottom), var(--brand-accent) 30%)' }} opacity="0.6" />
      <path d={MID.d} style={{ fill: 'color-mix(in srgb, var(--brand-sky-bottom), white 14%)' }} />
      <path d={NEAR.d} style={{ fill: 'color-mix(in srgb, var(--brand-sky-top), var(--brand-sky-bottom) 55%)', stroke: 'var(--brand-accent)' }}
        strokeOpacity="0.3" strokeWidth="0.6" />
      <g filter="url(#fw-glow)">
        {WINDOWS.map(({ x, y, flicker, bright }, i) => (
          <rect key={i} x={x} y={y} width="2.6" height="3.4" rx="0.4" fill="#FCD9A0"
            opacity={bright ? 0.85 : 0.6} className={flicker ? 'fw-window' : undefined}
            style={flicker ? { animationDelay: `${-(i % 7)}s` } : undefined} />
        ))}
      </g>
      <rect x="0" y="186" width="400" height="14" fill="url(#fw-water)" />
      <g className="fw-wave" style={{ color: 'var(--brand-accent)' }}>
        <path stroke="currentColor" strokeWidth="1.2" fill="none" opacity="0.55" d={wave} />
      </g>
    </svg>
  )
})
