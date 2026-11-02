import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { riskStyle } from './risk'

interface RiskBadgeProps {
  level: string
  size?: 'default' | 'lg'
  className?: string
}

/** The risk class as text plus an icon, so it never relies on colour alone. */
export function RiskBadge({ level, size = 'default', className }: RiskBadgeProps) {
  const { label, Icon, badge } = riskStyle(level)
  return (
    <Badge
      variant="outline"
      data-risk={level}
      className={cn(badge, size === 'lg' && 'h-7 gap-1.5 px-3 text-sm', className)}
    >
      <Icon aria-hidden />
      {label} intensity
    </Badge>
  )
}
