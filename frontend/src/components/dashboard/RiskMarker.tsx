import { riskStyle } from './risk'

interface RiskMarkerProps {
  level: string
  cx: number
  cy: number
  size?: number
}

/** A different shape per class (circle, diamond, triangle), so a colour-blind
 *  reader can still tell the classes apart. Draws inside an existing <svg>. */
export function RiskMarker({ level, cx, cy, size = 6 }: RiskMarkerProps) {
  const fill = riskStyle(level).solid
  const stroke = 'var(--card)'
  if (level === 'moderate') {
    const points = `${cx},${cy - size} ${cx + size},${cy} ${cx},${cy + size} ${cx - size},${cy}`
    return <polygon points={points} fill={fill} stroke={stroke} strokeWidth={1} />
  }
  if (level === 'high') {
    const points = `${cx},${cy - size} ${cx + size},${cy + size} ${cx - size},${cy + size}`
    return <polygon points={points} fill={fill} stroke={stroke} strokeWidth={1} />
  }
  return <circle cx={cx} cy={cy} r={size * 0.8} fill={fill} stroke={stroke} strokeWidth={1} />
}
