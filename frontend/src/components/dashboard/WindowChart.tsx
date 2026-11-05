import { Bar, CartesianGrid, ComposedChart, Line, LineChart, ReferenceLine, Scatter, XAxis, YAxis } from 'recharts'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatClock, formatHour, formatMm } from '@/lib/format'
import type { Feature, Meta, Prediction, ReplayWindow } from '@/lib/types'
import { RiskMarker } from './RiskMarker'
import { riskStyle } from './risk'

// Wind is km/h: pipeline/fetch_data.py uses Open-Meteo's default unit
const OTHER_FEATURES: { key: Feature; tab: string; label: string; unit: string }[] = [
  { key: 'temperature_2m', tab: 'Temp', label: 'Temperature', unit: '°C' },
  { key: 'relative_humidity_2m', tab: 'Humidity', label: 'Relative humidity', unit: '%' },
  { key: 'surface_pressure', tab: 'Pressure', label: 'Station pressure', unit: 'hPa' },
  { key: 'wind_speed_10m', tab: 'Wind', label: 'Wind speed', unit: 'km/h' },
]

const PREDICTED = 'next-predicted'
const ACTUAL = 'next-actual'

interface RainRow {
  slot: string
  title: string
  rain?: number
  predicted?: number
  actual?: number
}

interface WindowChartProps {
  meta: Meta | null
  replay: ReplayWindow | null
  prediction: Prediction | null
}

function Tip({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
      <p className="font-medium">{title}</p>
      {lines.map((line) => (
        <p key={line} className="font-mono tabular-nums">{line}</p>
      ))}
    </div>
  )
}

/** Panel 2: the 24 hours the model saw, then what it predicted and what happened. */
export function WindowChart({ meta, replay, prediction }: WindowChartProps) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>The 24-hour input window</CardTitle>
        <CardDescription>
          {replay
            ? `${formatHour(replay.window_start)} to ${formatHour(replay.window_end)}, from the held-out test data`
            : 'Loading the replay window'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {replay && prediction && meta ? (
          <WindowTabs meta={meta} replay={replay} prediction={prediction} />
        ) : (
          <Skeleton className="h-64 w-full" />
        )}
      </CardContent>
    </Card>
  )
}

function WindowTabs({ meta, replay, prediction }: { meta: Meta; replay: ReplayWindow; prediction: Prediction }) {
  const rows: RainRow[] = [
    ...replay.times.map((time, i) => ({
      slot: time,
      title: formatHour(time),
      rain: replay.readings[i].precipitation,
    })),
    { slot: PREDICTED, title: `Predicted for ${formatHour(replay.target_time)}`, predicted: prediction.predicted_mm },
    { slot: ACTUAL, title: `Actual at ${formatHour(replay.target_time)}`, actual: replay.actual_next_mm },
  ]
  // One label every 6 hours, then the next-hour slot
  const ticks = [...replay.times.filter((_, i) => i % 6 === 0), PREDICTED]
  const heavyLimit = meta.thresholds[0]?.below_mm

  return (
    <Tabs defaultValue="rain">
      <TabsList className="flex w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto">
        <TabsTrigger value="rain">Rainfall</TabsTrigger>
        {OTHER_FEATURES.map(({ key, tab }) => (
          <TabsTrigger key={key} value={key}>{tab}</TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="rain" className="flex flex-col gap-3 pt-2">
        <ChartContainer config={{}} className="aspect-auto h-64 w-full" aria-hidden>
          <ComposedChart data={rows} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="slot"
              ticks={ticks}
              interval={0}
              tickLine={false}
              tickFormatter={(slot: string) => (slot === PREDICTED ? 'Next' : formatClock(slot))}
            />
            <YAxis tickLine={false} axisLine={false} width={44} domain={[0, 'auto']} />
            {heavyLimit !== undefined && (
              <ReferenceLine y={heavyLimit} stroke="var(--muted-foreground)" strokeDasharray="4 4" ifOverflow="hidden" />
            )}
            <ChartTooltip
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as RainRow | undefined
                if (!active || !row) return null
                const mm = row.rain ?? row.predicted ?? row.actual ?? 0
                return <Tip title={row.title} lines={[`${formatMm(mm, 2)} mm`]} />
              }}
            />
            <Bar dataKey="rain" fill="var(--chart-1)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
            <Scatter
              dataKey="predicted"
              isAnimationActive={false}
              shape={(point: { cx?: number; cy?: number }) =>
                Number.isFinite(point.cy) && Number.isFinite(point.cx) ? (
                  <RiskMarker level={prediction.risk_level} cx={point.cx!} cy={point.cy!} size={7} />
                ) : (
                  <g />
                )
              }
            />
            <Scatter
              dataKey="actual"
              isAnimationActive={false}
              shape={(point: { cx?: number; cy?: number }) =>
                Number.isFinite(point.cy) && Number.isFinite(point.cx) ? (
                  <circle cx={point.cx} cy={point.cy} r={5.5} fill="var(--card)" stroke="var(--foreground)" strokeWidth={2} />
                ) : (
                  <g />
                )
              }
            />
          </ComposedChart>
        </ChartContainer>

        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-chart-1" aria-hidden />
            Input rainfall (mm)
          </li>
          <li className="flex items-center gap-1.5">
            <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
              <RiskMarker level={prediction.risk_level} cx={8} cy={8} size={6} />
            </svg>
            Predicted: <span className="font-mono text-foreground">{formatMm(prediction.predicted_mm)} mm</span>
            <span>({riskStyle(prediction.risk_level).label})</span>
          </li>
          <li className="flex items-center gap-1.5">
            <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden>
              <circle cx={8} cy={8} r={5} fill="var(--card)" stroke="var(--foreground)" strokeWidth={2} />
            </svg>
            Actual: <span className="font-mono text-foreground">{formatMm(replay.actual_next_mm, 1)} mm</span>
          </li>
          {heavyLimit !== undefined && (
            <li className="flex items-center gap-1.5">
              <span className="w-4 border-t-2 border-dashed border-muted-foreground" aria-hidden />
              {heavyLimit} mm: Low / Moderate limit (shown if in range)
            </li>
          )}
        </ul>

        <div className="sr-only"><table data-testid="window-table">
          <caption>Input rainfall by hour, then the predicted and actual next hour</caption>
          <tbody>
            {rows.map((row) => (
              <tr key={row.slot}>
                <th scope="row">{row.title}</th>
                <td>{formatMm(row.rain ?? row.predicted ?? row.actual ?? 0, 2)} mm</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </TabsContent>

      {OTHER_FEATURES.map(({ key, label, unit }) => {
        const featureRows = replay.times.map((time, i) => ({
          slot: time,
          title: formatHour(time),
          value: replay.readings[i][key],
        }))
        return (
          <TabsContent key={key} value={key} className="flex flex-col gap-2 pt-2">
            <ChartContainer config={{}} className="aspect-auto h-64 w-full" aria-hidden>
              <LineChart data={featureRows} margin={{ top: 12, right: 8, left: -4, bottom: 0 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="slot"
                  ticks={replay.times.filter((_, i) => i % 6 === 0)}
                  interval={0}
                  tickLine={false}
                  tickFormatter={formatClock}
                />
                <YAxis tickLine={false} axisLine={false} width={48} domain={['auto', 'auto']} />
                <ChartTooltip
                  content={({ active, payload }) => {
                    const row = payload?.[0]?.payload as (typeof featureRows)[number] | undefined
                    if (!active || !row) return null
                    return <Tip title={row.title} lines={[`${row.value} ${unit}`]} />
                  }}
                />
                <Line dataKey="value" stroke="var(--chart-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ChartContainer>
            <p className="text-xs text-muted-foreground">{label} ({unit}) over the same 24 hours. The axis doesn't start at zero.</p>
            <div className="sr-only"><table>
              <caption>{label} by hour</caption>
              <tbody>
                {featureRows.map((row) => (
                  <tr key={row.slot}>
                    <th scope="row">{row.title}</th>
                    <td>{row.value} {unit}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </TabsContent>
        )
      })}
    </Tabs>
  )
}
