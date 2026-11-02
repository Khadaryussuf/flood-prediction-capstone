import { useEffect, useState } from 'react'
import { AlertTriangle, Download } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ReferenceArea, XAxis, YAxis } from 'recharts'

import { RiskBadge } from '@/components/dashboard/RiskBadge'
import { riskStyle } from '@/components/dashboard/risk'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { getHistory } from '@/lib/api'
import { formatClock, formatDay, formatHour, formatMm } from '@/lib/format'
import type { HistoryRange, HistoryResponse } from '@/lib/types'

const RANGES: { key: HistoryRange; label: string }[] = [
  { key: '24h', label: '24 hours' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
]

const BAND_COLOUR: Record<string, string> = {
  low: 'var(--risk-low-solid)',
  moderate: 'var(--risk-moderate-solid)',
  high: 'var(--risk-high-solid)',
}

/** The chart's shaded risk bands, from the API's limits, up to the chart's top. */
export function riskBands(history: HistoryResponse, top: number) {
  const bands: { level: string; from: number; to: number; limit: number | null }[] = []
  let from = 0
  for (const { below_mm, label } of history.thresholds) {
    if (from < top) bands.push({ level: label, from, to: Math.min(below_mm, top), limit: below_mm })
    from = below_mm
  }
  if (from < top) bands.push({ level: history.highest_risk, from, to: top, limit: null })
  return bands
}

function TrendChart({ history }: { history: HistoryResponse }) {
  const peak = Math.max(0, ...history.rows.map((row) => row.predicted_mm))
  // Always shows where Medium starts, so a low period reads as low
  const top = Number((Math.max(peak, history.thresholds[0]?.below_mm ?? 1) * 1.15).toFixed(1))
  const short = history.range === '24h'
  const bands = riskBands(history, top)
  return (
    <>
      <ChartContainer config={{}} className="aspect-auto h-64 w-full" aria-hidden>
        <LineChart data={history.rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          {bands.map((band) => (
            <ReferenceArea key={band.level} y1={band.from} y2={band.to} fill={BAND_COLOUR[band.level]} fillOpacity={0.14} stroke="none" ifOverflow="hidden" />
          ))}
          <CartesianGrid vertical={false} />
          <XAxis dataKey="time" tickLine={false} minTickGap={48} tickFormatter={short ? formatClock : formatDay} />
          <YAxis tickLine={false} axisLine={false} width={44} domain={[0, top]} />
          <ChartTooltip
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as HistoryResponse['rows'][number] | undefined
              if (!active || !row) return null
              return (
                <div className="rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
                  <p className="font-medium">{formatHour(row.time)}</p>
                  <p className="tabular-nums">{formatMm(row.predicted_mm)} mm, {riskStyle(row.risk_level).label}</p>
                </div>
              )
            }}
          />
          <Line dataKey="predicted_mm" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ChartContainer>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Chart shading">
        {bands.map((band) => (
          <li key={band.level} className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm border" style={{ backgroundColor: BAND_COLOUR[band.level], opacity: 0.5 }} aria-hidden />
            {riskStyle(band.level).label}: {band.limit === null ? `${band.from} mm and above` : `${band.from} to ${band.limit} mm`}
          </li>
        ))}
      </ul>
    </>
  )
}

export function TrendsPage() {
  const [range, setRange] = useState<HistoryRange>('24h')
  const [history, setHistory] = useState<HistoryResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stale = false
    getHistory(range).then((body) => {
      if (stale) return
      setHistory(body)
      setError(null)
    }).catch(() => !stale && setError("Can't load the history. Try again."))
    return () => {
      stale = true
    }
  }, [range])

  const rows = history?.rows ?? []
  const hasBackfill = rows.some((row) => row.source === 'backfill')

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Period" className="inline-flex rounded-lg border bg-muted p-1">
          {RANGES.map(({ key, label }) => (
            <Button key={key} size="sm" variant={range === key ? 'default' : 'ghost'} aria-pressed={range === key}
              className="h-8" onClick={() => setRange(key)}>
              {label}
            </Button>
          ))}
        </div>
        <Button asChild variant="outline" className="h-9">
          <a href={`/api/history.csv?range=${range}`} download>
            <Download aria-hidden />
            Export CSV
          </a>
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertTriangle aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!history && !error && <Skeleton className="h-64" />}
      {history && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">No predictions for this period yet. They build up hour by hour.</p>
      )}

      {history && rows.length > 0 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Predicted rainfall</CardTitle>
              <CardDescription>The model's next-hour prediction, in mm, shaded by risk class. Nairobi time.</CardDescription>
            </CardHeader>
            <CardContent><TrendChart history={history} /></CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Predictions</CardTitle>
              <CardDescription>
                {rows.length} {rows.length === 1 ? 'hour' : 'hours'}, newest first. The class is as recorded at the time.
                {hasBackfill && ' "Backfill" hours were calculated when FloodWatch first ran, from past forecast data, and never raised alerts.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Scrolls by keyboard too, so a long period doesn't bury the page */}
              <div className="max-h-96 overflow-y-auto" tabIndex={0} role="region" aria-label="Prediction table">
                <Table data-testid="history-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Hour</TableHead>
                      <TableHead className="text-right">Predicted</TableHead>
                      <TableHead>Class</TableHead>
                      <TableHead className="hidden sm:table-cell">Source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...rows].reverse().map((row) => (
                      <TableRow key={row.time}>
                        <TableCell>{formatHour(row.time)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMm(row.predicted_mm)} mm</TableCell>
                        <TableCell><RiskBadge level={row.risk_level} short /></TableCell>
                        <TableCell className="hidden capitalize sm:table-cell">{row.source}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
