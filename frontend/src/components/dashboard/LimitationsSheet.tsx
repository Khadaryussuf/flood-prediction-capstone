import { TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { REPLAY_LABEL } from '@/lib/copy'
import { caughtMoreThanServed, withinSeedSpread } from '@/lib/comparison'
import { formatDay, formatMm } from '@/lib/format'
import type { Comparison, Meta } from '@/lib/types'

interface LimitationsSheetProps {
  meta: Meta | null
  comparison: Comparison | null
}

/** Panel 5: what this dashboard can't tell you. Numbers come from the API. */
export function LimitationsSheet({ meta, comparison }: LimitationsSheetProps) {
  const served = comparison?.models.find((m) => m.selected)
  const highLimit = meta?.thresholds.at(-1)?.below_mm

  const items: { title: string; text: string }[] = [
    {
      title: 'A replay, not live',
      text: `${REPLAY_LABEL}${meta ? `: ${formatDay(meta.test_period.start)} to ${formatDay(meta.test_period.end)}` : ''}. It shows how the model behaved on past hours it was not trained on, not current conditions.`,
    },
    {
      title: 'A grid cell, not rain gauges',
      text: 'Inputs are ERA5 reanalysis for one grid cell of about 31 km, which covers much of Nairobi. Local storms smaller than the cell are smoothed out.',
    },
    {
      title: 'Rain intensity, not flood probability',
      text: 'The risk level is the American Meteorological Society class of the predicted hourly rainfall. It says nothing directly about drainage, river levels or flooding.',
    },
    {
      title: 'Not calibrated to Nairobi',
      text: 'The class limits have not been checked against Nairobi flood records.',
    },
  ]
  if (served) {
    items.push({
      title: 'Few heavy hours to judge by',
      text: `Only ${served.val_heavy_actual} validation hours and ${served.test_heavy_actual} test hours had at least ${comparison?.heavy_rain_mm} mm of rain, so one hit moves the recall noticeably. Compare the counts, not just percentages.`,
    })
    items.push({
      title: 'The model under-predicts peaks',
      text:
        `Its highest test prediction is ${formatMm(served.test_max_pred_mm)} mm, against a highest actual of ${formatMm(served.test_max_actual_mm)} mm.` +
        (highLimit !== undefined && served.test_max_pred_mm < highLimit
          ? ` That is below the ${highLimit} mm limit, so the replay never reaches the ${meta?.highest_risk} class, even in the wettest hours.`
          : ''),
    })
    const more = caughtMoreThanServed(comparison!.models)
    const spread = withinSeedSpread(comparison!.models)
    if (more || spread) {
      items.push({
        title: 'Close and mixed results between models',
        text: [spread, more].filter(Boolean).join(' '),
      })
    }
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 max-sm:[&>svg]:hidden">
          <TriangleAlert aria-hidden />
          Limitations
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Limitations</SheetTitle>
          <SheetDescription>What this dashboard can and can't tell you.</SheetDescription>
        </SheetHeader>
        <dl className="flex flex-col gap-4 px-4 pb-6 text-sm">
          {items.map(({ title, text }) => (
            <div key={title}>
              <dt className="font-medium">{title}</dt>
              <dd className="mt-0.5 text-muted-foreground">{text}</dd>
            </div>
          ))}
        </dl>
      </SheetContent>
    </Sheet>
  )
}
