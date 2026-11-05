import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, BellRing, Clock, Droplets, Gauge, Thermometer, Waves, Wind, type LucideIcon } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from 'recharts'

import { riskStyle } from '@/components/dashboard/risk'
import { RiskMap } from '@/components/map/RiskMap'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { getLive } from '@/lib/api'
import { formatClock, formatHour, formatHourRange, formatMm } from '@/lib/format'
import type { Feature, Freshness, LiveCurrent } from '@/lib/types'
import { cn } from '@/lib/utils'

const REFRESH_MS = 5 * 60 * 1000

/** One plain instruction per class. This is rain intensity, not a flood forecast. */
export const ACTIONS: Record<string, string> = {
  low: 'No action needed. Keep monitoring.',
  moderate: 'Check known flood spots and drains, and have teams ready.',
  high: 'Heavy rain expected next hour. Alert field teams and watch known flood spots now.',
}

const FRESHNESS: Record<Freshness, { className: string; note: string }> = {
  Live: { className: 'bg-risk-low-bg text-risk-low border-risk-low/30', note: 'Live: updated within the last 90 minutes.' },
  Stale: { className: 'bg-risk-moderate-bg text-risk-moderate border-risk-moderate/30', note: 'Stale: this reading is over 90 minutes old.' },
  Fallback: { className: 'bg-risk-high-bg text-risk-high border-risk-high/30', note: "Fallback: the latest fetch failed, so this is the last good reading." },
  Unavailable: { className: 'bg-muted text-foreground', note: 'No live reading has been received yet.' },
}

const BANNER: Record<string, string> = {
  low: 'bg-risk-low-bg text-risk-low border-risk-low/40',
  moderate: 'bg-risk-moderate-bg text-risk-moderate border-risk-moderate/40',
  high: 'bg-risk-high-bg text-risk-high border-risk-high/40',
}

const CARDS: { key: Feature; label: string; unit: string; Icon: LucideIcon; decimals: number }[] = [
  { key: 'precipitation', label: 'Rainfall', unit: 'mm', Icon: Droplets, decimals: 1 },
  { key: 'temperature_2m', label: 'Temperature', unit: '°C', Icon: Thermometer, decimals: 1 },
  { key: 'relative_humidity_2m', label: 'Humidity', unit: '%', Icon: Waves, decimals: 0 },
  { key: 'surface_pressure', label: 'Station pressure', unit: 'hPa', Icon: Gauge, decimals: 0 },
  { key: 'wind_speed_10m', label: 'Wind', unit: 'km/h', Icon: Wind, decimals: 0 },
]

/** "Medium starts at 2.5 mm/h and High at 7.6 mm/h", from the API's limits */
export function thresholdNote(live: LiveCurrent): string {
  const [first, second] = live.thresholds
  const note = second
    ? `Medium starts at ${first.below_mm} mm/h and High at ${second.below_mm} mm/h.`
    : `Limits start at ${first?.below_mm} mm/h.`
  return live.thresholds_overridden ? `${note} Set by an administrator.` : note
}

function RiskBanner({ live }: { live: LiveCurrent }) {
  const level = live.risk_level ?? ''
  const { label, Icon } = riskStyle(level)
  return (
    <section aria-label="Current risk" data-testid="risk-banner" data-risk={level}
      className={cn('flex flex-col gap-3 rounded-xl border p-5', BANNER[level] ?? 'bg-muted')}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <p className="flex items-center gap-3">
          <Icon className="size-10 shrink-0" aria-hidden />
          <span className="text-4xl font-bold sm:text-5xl">{label}</span>
        </p>
        <p className="flex items-baseline gap-1.5">
          <span className="text-4xl font-semibold tabular-nums sm:text-5xl">{formatMm(live.predicted_mm ?? 0)}</span>
          <span className="text-lg">mm predicted</span>
        </p>
      </div>
      <p className="text-lg font-medium" data-testid="action-line">{ACTIONS[level]}</p>
      <p className="text-sm">
        {live.target_time && <>Rainfall predicted for {formatHourRange(live.target_time)} (Nairobi time). </>}
        {thresholdNote(live)}
      </p>
    </section>
  )
}

function FreshnessChip({ live }: { live: LiveCurrent }) {
  const { className, note } = FRESHNESS[live.freshness]
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <Badge variant="outline" className={cn('h-7 px-2.5 text-sm font-semibold', className)} data-testid="freshness">
        {live.freshness}
      </Badge>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Clock className="size-4" aria-hidden />
        {live.last_updated ? `Last updated ${formatHour(live.last_updated)}` : 'Not updated yet'}
      </span>
      <span className="text-muted-foreground">{note}</span>
    </div>
  )
}

function AlertBanner({ alert }: { alert: NonNullable<LiveCurrent['alert']> }) {
  const { recipients, emails_sent: sent } = alert
  return (
    <Alert role="status" data-testid="alert-banner">
      <BellRing aria-hidden />
      <AlertTitle>{riskStyle(alert.risk_level).label} alert raised {formatHour(alert.at)}</AlertTitle>
      <AlertDescription>
        <p>
          {formatMm(alert.predicted_mm)} mm predicted for {formatHour(alert.target_time)}.
          {' '}{recipients} {recipients === 1 ? 'recipient' : 'recipients'}, {sent} {sent === 1 ? 'email' : 'emails'} sent.
          {' '}<Link to="/alerts" className="font-medium underline underline-offset-4">View alerts</Link>
        </p>
      </AlertDescription>
    </Alert>
  )
}

function Readings({ live }: { live: LiveCurrent }) {
  const latest = live.window.at(-1)
  if (!latest) return null
  return (
    <section aria-label="Current conditions" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {CARDS.map(({ key, label, unit, Icon, decimals }) => (
        <Card key={key} size="sm" className="last:col-span-2 md:last:col-span-1">
          <CardContent className="flex flex-col gap-1">
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Icon className="size-4" aria-hidden />
              {label}
            </p>
            <p className="text-2xl font-semibold tabular-nums" data-testid={`reading-${key}`}>
              {formatMm(latest[key], decimals)} <span className="text-sm font-normal text-muted-foreground">{unit}</span>
            </p>
          </CardContent>
        </Card>
      ))}
    </section>
  )
}

function RainChart({ live }: { live: LiveCurrent }) {
  const limit = live.thresholds[0]?.below_mm
  const top = Math.max(...live.window.map((row) => row.precipitation), 1) * 1.15
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rainfall, last 24 hours</CardTitle>
        <CardDescription>Open-Meteo hourly rainfall for this grid cell, in mm.</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={{}} className="aspect-auto h-52 w-full" aria-hidden>
          <BarChart data={live.window} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="time" tickLine={false} tickFormatter={formatClock} minTickGap={32} />
            <YAxis tickLine={false} axisLine={false} width={44} domain={[0, Number(top.toFixed(1))]} />
            {limit !== undefined && <ReferenceLine y={limit} stroke="var(--muted-foreground)" strokeDasharray="4 4" ifOverflow="hidden" />}
            <ChartTooltip
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as LiveCurrent['window'][number] | undefined
                if (!active || !row) return null
                return (
                  <div className="rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
                    <p className="font-medium">{formatHour(row.time)}</p>
                    <p className="tabular-nums">{formatMm(row.precipitation, 1)} mm</p>
                  </div>
                )
              }}
            />
            <Bar dataKey="precipitation" fill="var(--chart-1)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ChartContainer>
        <div className="sr-only">
          <table data-testid="rain-table">
            <caption>Rainfall by hour, last 24 hours</caption>
            <tbody>
              {live.window.map((row) => (
                <tr key={row.time}><th scope="row">{formatHour(row.time)}</th><td>{formatMm(row.precipitation, 1)} mm</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

export function DashboardPage() {
  const [live, setLive] = useState<LiveCurrent | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    getLive().then((body) => {
      setLive(body)
      setError(null)
    }).catch(() => setError("Can't reach the FloodWatch server. The figures shown may be out of date."))
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => clearInterval(timer)
  }, [load])

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4 sm:p-6">
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertTriangle aria-hidden />
          <AlertTitle>Connection problem</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!live && !error && <Skeleton className="h-48" />}
      {live && live.predicted_mm === null && (
        <Alert role="status">
          <Clock aria-hidden />
          <AlertTitle>Waiting for the first reading</AlertTitle>
          <AlertDescription>
            The server fetches live data when it starts and then every hour.{live.last_error && ` Last attempt: ${live.last_error}.`}
          </AlertDescription>
        </Alert>
      )}
      {live && live.predicted_mm !== null && (
        <>
          {live.alert && <AlertBanner alert={live.alert} />}
          <RiskBanner live={live} />
          <FreshnessChip live={live} />
          <Readings live={live} />
          <RiskMap live={live} />
          <RainChart live={live} />
          <p className="text-xs text-muted-foreground">
            {live.source_note} Weather data by{' '}
            <a className="underline" href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>.
          </p>
        </>
      )}
    </div>
  )
}
