import { useEffect, useState, type FormEvent } from 'react'
import { ChevronLeft, ChevronRight, CloudRainWind } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCount, formatHour, formatMm } from '@/lib/format'
import type { Meta } from '@/lib/types'

interface ReplayControlsProps {
  /** 0-based window index, as used by /api/replay/<index> */
  index: number
  count: number
  wettest: Meta['wettest']
  busy: boolean
  onChange: (index: number) => void
}

/** Step through the test period. The page shows windows 1-based to people. */
export function ReplayControls({ index, count, wettest, busy, onChange }: ReplayControlsProps) {
  const [draft, setDraft] = useState(String(index + 1))
  useEffect(() => setDraft(String(index + 1)), [index])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const wanted = Number(draft)
    if (Number.isInteger(wanted) && wanted >= 1 && wanted <= count) onChange(wanted - 1)
    else setDraft(String(index + 1))
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        aria-label="Previous hour"
        disabled={busy || index <= 0}
        onClick={() => onChange(index - 1)}
      >
        <ChevronLeft aria-hidden />
      </Button>

      <form onSubmit={submit} className="flex items-center gap-1.5">
        <Label htmlFor="replay-window" className="sr-only">
          Window number, 1 to {count}
        </Label>
        <Input
          id="replay-window"
          inputMode="numeric"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={submit}
          className="h-8 w-20 text-center font-mono tabular-nums"
        />
        <span className="text-sm text-muted-foreground">of {formatCount(count)}</span>
      </form>

      <Button
        variant="outline"
        size="icon"
        aria-label="Next hour"
        disabled={busy || index >= count - 1}
        onClick={() => onChange(index + 1)}
      >
        <ChevronRight aria-hidden />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm" className="h-8" disabled={busy || wettest.length === 0}>
            <CloudRainWind aria-hidden />
            Wettest hours
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64">
          <DropdownMenuLabel>Wettest hours in the test period</DropdownMenuLabel>
          {wettest.map((hour) => (
            <DropdownMenuItem key={hour.index} onSelect={() => onChange(hour.index)}>
              <span>{formatHour(hour.target_time)}</span>
              <span className="ml-auto font-mono tabular-nums text-muted-foreground">
                {formatMm(hour.actual_mm, 1)} mm
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
