import { Cpu, History, Waves } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { ThemeToggle } from '@/components/theme-toggle'
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
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Waves className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold leading-tight">Nairobi Flash-Flood Risk</h1>
            <p className="truncate text-xs text-muted-foreground">Next-hour rainfall from ERA5 weather inputs</p>
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
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
