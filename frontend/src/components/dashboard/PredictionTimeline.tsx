import { AlertTriangle } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { formatHour, formatMm, formatRequestTime } from '@/lib/format'
import type { Meta, StoredPrediction } from '@/lib/types'
import { RiskMarker } from './RiskMarker'
import { RISK_STYLES, riskStyle } from './risk'

interface PredictionTimelineProps {
  meta: Meta | null
  predictions: StoredPrediction[] | null
  /** Prediction id -> replay hour. Known only for predictions made since this page loaded. */
  sessionHours: Record<number, string>
  error: string | null
}

const replayHour = (id: number, hours: Record<number, string>) =>
  hours[id] ? formatHour(hours[id]) : 'not recorded'

/** Panel 3: the most recent /predict calls, coloured and shaped by risk class. */
export function PredictionTimeline({ meta, predictions, sessionHours, error }: PredictionTimelineProps) {
  // The API sends newest first; a timeline reads oldest to newest
  const rows = predictions ? [...predictions].reverse() : []
  const latest = rows.at(-1)
  const top = Math.ceil(Math.max(3, ...rows.map((row) => row.predicted_mm)) * 1.15)

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Recent predictions</CardTitle>
        <CardDescription>
          The last {rows.length || 20} calls to /predict, oldest to newest. Times are when the request was made, not
          the weather hour. Earlier rows may come from a previously served model; predictions don't record the model.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden />
            <AlertTitle>Recent predictions unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {!predictions && !error && <Skeleton className="h-44 w-full" />}
        {predictions && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No predictions stored yet.</p>
        )}

        {rows.length > 0 && (
          <>
            <ChartContainer config={{}} className="aspect-auto h-44 w-full" aria-hidden>
              <LineChart data={rows} margin={{ top: 12, right: 12, left: -12, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="id" tick={false} tickLine={false} />
                <YAxis tickLine={false} axisLine={false} width={44} domain={[0, top]} allowDecimals={false} />
                {meta?.thresholds.map(({ below_mm }) => (
                  <ReferenceLine key={below_mm} y={below_mm} stroke="var(--muted-foreground)" strokeDasharray="4 4" ifOverflow="hidden" />
                ))}
                <ChartTooltip
                  content={({ active, payload }) => {
                    const row = payload?.[0]?.payload as StoredPrediction | undefined
                    if (!active || !row) return null
                    return (
                      <div className="rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
                        <p className="font-mono font-medium tabular-nums">
                          {formatMm(row.predicted_mm)} mm, {riskStyle(row.risk_level).label}
                        </p>
                        <p>Requested {formatRequestTime(row.created_at)}</p>
                        <p>Replay hour: {replayHour(row.id, sessionHours)}</p>
                      </div>
                    )
                  }}
                />
                <Line
                  dataKey="predicted_mm"
                  stroke="var(--border)"
                  strokeWidth={1.5}
                  isAnimationActive={false}
                  dot={(point: { cx?: number; cy?: number; payload?: StoredPrediction; index?: number }) => (
                    <g key={point.payload?.id ?? point.index}>
                      {point.payload && Number.isFinite(point.cx) && Number.isFinite(point.cy) && (
                        <RiskMarker level={point.payload.risk_level} cx={point.cx!} cy={point.cy!} />
                      )}
                    </g>
                  )}
                />
              </LineChart>
            </ChartContainer>

            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Risk classes">
              {Object.entries(RISK_STYLES).map(([level, { label }]) => (
                <li key={level} className="flex items-center gap-1.5">
                  <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
                    <RiskMarker level={level} cx={8} cy={8} size={6} />
                  </svg>
                  {label}
                </li>
              ))}
              <li className="flex items-center gap-1.5">
                <span className="w-4 border-t-2 border-dashed border-muted-foreground" aria-hidden />
                Class limits (mm)
              </li>
            </ul>

            {latest && (
              <p className="text-sm" data-testid="latest-prediction">
                Latest: <span className="font-mono font-medium tabular-nums">{formatMm(latest.predicted_mm)} mm</span>,{' '}
                {riskStyle(latest.risk_level).label}. Requested {formatRequestTime(latest.created_at)}. Replay hour:{' '}
                {replayHour(latest.id, sessionHours)}.
              </p>
            )}

            <div className="sr-only"><table data-testid="timeline-table">
              <caption>Recent predictions, oldest to newest</caption>
              <thead>
                <tr>
                  <th scope="col">Requested</th>
                  <th scope="col">Predicted</th>
                  <th scope="col">Class</th>
                  <th scope="col">Replay hour</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{formatRequestTime(row.created_at)}</td>
                    <td>{formatMm(row.predicted_mm)} mm</td>
                    <td>{riskStyle(row.risk_level).label}</td>
                    <td>{replayHour(row.id, sessionHours)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
