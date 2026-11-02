import type { Meta } from '@/lib/types'
import { formatMm } from '@/lib/format'
import { riskStyle } from './risk'

// Display scale only: the gauge runs from 0 to 10 mm and values above
// that are drawn at the end with a "≥ 10" label. The highest hour in the
// test period is 9.3 mm (docs/model_comparison.csv), so this covers it.
export const GAUGE_MAX_MM = 10

const CX = 100
const CY = 100
const R = 78
const WIDTH = 16

/** Point on the arc for a value: 0 mm is the far left, the maximum the far right */
function point(mm: number, radius = R) {
  const angle = Math.PI * (1 - mm / GAUGE_MAX_MM)
  return { x: CX + radius * Math.cos(angle), y: CY - radius * Math.sin(angle) }
}

function arc(fromMm: number, toMm: number) {
  const a = point(fromMm)
  const b = point(toMm)
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${R} ${R} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`
}

interface RiskGaugeProps {
  valueMm: number
  level: string
  thresholds: Meta['thresholds']
  highestRisk: string
}

/** Semicircle gauge with one band per risk class, built from the API's thresholds. */
export function RiskGauge({ valueMm, level, thresholds, highestRisk }: RiskGaugeProps) {
  // Bands: 0 to the first limit, then limit to limit, then the last limit to the end
  const bands: { from: number; to: number; label: string }[] = []
  let from = 0
  for (const { below_mm, label } of thresholds) {
    bands.push({ from, to: Math.min(below_mm, GAUGE_MAX_MM), label })
    from = below_mm
  }
  bands.push({ from, to: GAUGE_MAX_MM, label: highestRisk })

  const clamped = Math.min(Math.max(valueMm, 0), GAUGE_MAX_MM)
  const degrees = (clamped / GAUGE_MAX_MM) * 180
  const active = riskStyle(level)

  const description =
    `Gauge: ${formatMm(valueMm)} mm on a 0 to ${GAUGE_MAX_MM} mm scale. ` +
    bands.map((b) => `${riskStyle(b.label).label} from ${b.from} to ${b.to} mm`).join('; ') + '.'

  return (
    <svg viewBox="0 0 200 122" role="img" aria-label={description} className="w-full max-w-72">
      {bands.map((band) => (
        <path
          key={band.label}
          d={arc(band.from, band.to)}
          fill="none"
          stroke={riskStyle(band.label).solid}
          strokeWidth={WIDTH}
          opacity={band.label === level ? 0.95 : 0.28}
        />
      ))}

      {/* Tick labels at 0, each threshold, and the end of the scale */}
      {[0, ...thresholds.map((t) => t.below_mm), GAUGE_MAX_MM].map((mm) => {
        const p = point(mm, R + WIDTH / 2 + 9)
        const anchor = mm === 0 ? 'start' : mm === GAUGE_MAX_MM ? 'end' : 'middle'
        const y = mm === 0 || mm === GAUGE_MAX_MM ? CY + 16 : p.y
        const x = mm === 0 ? CX - R - WIDTH / 2 : mm === GAUGE_MAX_MM ? CX + R + WIDTH / 2 : p.x
        return (
          <text key={mm} x={x} y={y} textAnchor={anchor} className="fill-muted-foreground font-mono text-[9px]">
            {mm === GAUGE_MAX_MM ? `≥${mm}` : mm}
          </text>
        )
      })}

      {/* Needle: drawn pointing at 0 mm, then rotated to the value */}
      <g
        className="transition-transform duration-700 ease-out"
        style={{ transform: `rotate(${degrees}deg)`, transformOrigin: `${CX}px ${CY}px` }}
      >
        <line x1={CX} y1={CY} x2={CX - R + 4} y2={CY} stroke="var(--foreground)" strokeWidth={3} strokeLinecap="round" />
      </g>
      <circle cx={CX} cy={CY} r={7} fill="var(--foreground)" />
      <circle cx={CX} cy={CY} r={3} fill={active.solid} />
      <text x={CX} y={CY + 18} textAnchor="middle" className="fill-muted-foreground text-[9px]">
        mm / hour
      </text>
    </svg>
  )
}
