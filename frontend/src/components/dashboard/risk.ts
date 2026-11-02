// How each risk class looks. The class itself always comes from the API
// (/predict or /predictions), and the mm limits from /api/meta; nothing
// here decides which class a value is in.
import { CloudDrizzle, CloudRain, CloudRainWind, type LucideIcon } from 'lucide-react'

export interface RiskStyle {
  label: string
  Icon: LucideIcon
  /** Tailwind classes for text on a tinted background (AA contrast) */
  badge: string
  /** CSS colour for graphics such as the gauge band */
  solid: string
}

export const RISK_STYLES: Record<string, RiskStyle> = {
  low: {
    label: 'Low',
    Icon: CloudDrizzle,
    badge: 'bg-risk-low-bg text-risk-low border-risk-low/30',
    solid: 'var(--risk-low-solid)',
  },
  moderate: {
    label: 'Moderate',
    Icon: CloudRain,
    badge: 'bg-risk-moderate-bg text-risk-moderate border-risk-moderate/30',
    solid: 'var(--risk-moderate-solid)',
  },
  high: {
    label: 'High',
    Icon: CloudRainWind,
    badge: 'bg-risk-high-bg text-risk-high border-risk-high/30',
    solid: 'var(--risk-high-solid)',
  },
}

/** Style for a class name the API returned; unknown names get a neutral look */
export function riskStyle(level: string): RiskStyle {
  return (
    RISK_STYLES[level] ?? {
      label: level,
      Icon: CloudRain,
      badge: 'bg-muted text-foreground border-border',
      solid: 'var(--muted-foreground)',
    }
  )
}
