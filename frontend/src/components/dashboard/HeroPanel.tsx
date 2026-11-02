import { AlertTriangle, History } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { REPLAY_LABEL } from '@/lib/copy'
import { formatDay, formatHour, formatMm } from '@/lib/format'
import type { Health, Meta, Prediction, ReplayWindow } from '@/lib/types'
import { ReplayControls } from './ReplayControls'
import { RiskBadge } from './RiskBadge'
import { RiskGauge } from './RiskGauge'

interface HeroPanelProps {
  meta: Meta | null
  health: Health | null
  replay: ReplayWindow | null
  prediction: Prediction | null
  index: number
  busy: boolean
  error: string | null
  onIndexChange: (index: number) => void
}

/** Panel 1: the served model's next-hour prediction for one replayed hour. */
export function HeroPanel({ meta, health, replay, prediction, index, busy, error, onIndexChange }: HeroPanelProps) {
  const ready = meta && replay && prediction

  return (
    <Card className="h-full" aria-busy={busy}>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Next-hour rainfall</CardTitle>
        <CardDescription className="text-foreground">
          {replay ? (
            <>
              Predicted for <strong className="font-semibold">{formatHour(replay.target_time)}</strong>{' '}
              ({meta?.timezone ?? 'Nairobi time'}) from the 24 hours before
            </>
          ) : (
            <Skeleton className="h-4 w-56" />
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden />
            <AlertTitle>Prediction unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {ready ? (
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:justify-between xl:flex-col xl:items-center">
            <div className="flex flex-col items-center gap-3 sm:items-start xl:items-center">
              <p className="flex items-baseline gap-1.5" aria-live="polite">
                <span className="text-6xl font-semibold tracking-tight tabular-nums" data-testid="predicted-mm">
                  {formatMm(prediction.predicted_mm)}
                </span>
                <span className="text-lg text-muted-foreground">mm</span>
                <span className="sr-only">, {prediction.risk_level} intensity</span>
              </p>
              <div data-testid="hero-risk"><RiskBadge level={prediction.risk_level} size="lg" /></div>
              <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Model output</dt>
                <dd className="font-mono tabular-nums">{formatMm(prediction.predicted_mm, 4)} mm</dd>
                <dt className="text-muted-foreground">Actual (test data)</dt>
                <dd className="font-mono tabular-nums">{formatMm(replay.actual_next_mm, 1)} mm</dd>
              </dl>
            </div>
            <RiskGauge
              valueMm={prediction.predicted_mm}
              level={prediction.risk_level}
              thresholds={meta.thresholds}
              highestRisk={meta.highest_risk}
            />
          </div>
        ) : (
          !error && (
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
              <div className="flex flex-col gap-3">
                <Skeleton className="h-14 w-40" />
                <Skeleton className="h-7 w-32" />
              </div>
              <Skeleton className="h-32 w-64 rounded-t-full" />
            </div>
          )
        )}

        {meta && (
          <ReplayControls
            index={index}
            count={meta.window_count}
            wettest={meta.wettest}
            busy={busy}
            onChange={onIndexChange}
          />
        )}
      </CardContent>

      <CardFooter className="mt-auto flex flex-col items-start gap-1 text-xs text-muted-foreground">
        <p className="flex items-center gap-1.5">
          <History className="size-3.5" aria-hidden />
          <span>
            {REPLAY_LABEL}
            {meta && `: ${formatDay(meta.test_period.start)} to ${formatDay(meta.test_period.end)}`}
          </span>
        </p>
        <p>
          Served model:{' '}
          <span className="font-mono text-foreground" data-testid="served-model">
            {health ? `${health.model} (${health.model_file})` : 'unknown'}
          </span>
          , chosen by lowest validation RMSE.
        </p>
      </CardFooter>
    </Card>
  )
}
