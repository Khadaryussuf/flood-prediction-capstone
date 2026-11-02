import { Cpu, History } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { REPLAY_LABEL } from '@/lib/copy'
import { formatDay } from '@/lib/format'
import type { Comparison, Health, Meta } from '@/lib/types'
import { LimitationsSheet } from './LimitationsSheet'

interface TopBarProps {
  health: Health | null
  meta: Meta | null
  comparison: Comparison | null
}

export function TopBar({ health, meta, comparison }: TopBarProps) {
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold leading-tight">Replay and model comparison</h2>
            <p className="truncate text-xs text-muted-foreground">How the served model performed on held-out ERA5 data</p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="h-7 gap-1.5 border-primary/40 px-2.5 font-semibold text-primary max-sm:[&>svg]:hidden">
                <History aria-hidden />
                REPLAY
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              {REPLAY_LABEL}
              {meta && `: ${formatDay(meta.test_period.start)} to ${formatDay(meta.test_period.end)}`}
            </TooltipContent>
          </Tooltip>
          <Badge variant="secondary" className="h-7 gap-1.5 px-2.5 font-mono">
            <Cpu aria-hidden />
            <span className="sr-only">Serving model:</span>
            {health ? health.model : '…'}
          </Badge>
          <LimitationsSheet meta={meta} comparison={comparison} />
        </div>
      </div>
    </header>
  )
}
