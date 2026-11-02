import { AlertTriangle } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, ErrorBar, LabelList, XAxis, YAxis } from 'recharts'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer } from '@/components/ui/chart'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { caughtMoreThanServed, withinSeedSpread } from '@/lib/comparison'
import { formatMm } from '@/lib/format'
import type { Comparison, ComparisonModel } from '@/lib/types'

interface ModelComparisonProps {
  comparison: Comparison | null
  error: string | null
}

const meanSd = (mean: number, sd: number, decimals: number) =>
  `${formatMm(mean, decimals)} ± ${formatMm(sd, decimals)}`

/** Panel 4: the real results, with the baselines, from the two docs/ CSV files. */
export function ModelComparison({ comparison, error }: ModelComparisonProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Model comparison</CardTitle>
        <CardDescription>
          {comparison
            ? `Selected on ${comparison.selection_rule}; test numbers were not used to choose. Heavy hours are hours with at least ${comparison.heavy_rain_mm} mm of actual rain. Source: ${comparison.sources.join(', ')}.`
            : 'Loading the results'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden />
            <AlertTitle>Comparison unavailable</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {!comparison && !error && <Skeleton className="h-48 w-full" />}
        {comparison && <ComparisonBody comparison={comparison} />}
      </CardContent>
    </Card>
  )
}

function ComparisonBody({ comparison }: { comparison: Comparison }) {
  const { models } = comparison
  const findings = [caughtMoreThanServed(models), withinSeedSpread(models)].filter(Boolean) as string[]
  const nSeeds = models.find((m) => m.seeds)?.seeds?.n_seeds

  return (
    <>
      <Table data-testid="comparison-table">
        <TableHeader>
          <TableRow>
            <TableHead>Model</TableHead>
            <TableHead className="text-right">Validation RMSE</TableHead>
            <TableHead className="text-right">Test RMSE</TableHead>
            <TableHead className="text-right">Heavy hours caught</TableHead>
            <TableHead className="text-right">Test RMSE, seed mean ± SD</TableHead>
            <TableHead className="text-right">Heavy hours, seed mean ± SD</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {models.map((m) => (
            <TableRow key={m.model} data-model={m.model} className={m.selected ? 'bg-accent/60' : undefined}>
              <TableCell className="font-medium">
                <span className="flex items-center gap-2">
                  {m.model}
                  {m.selected && <Badge>Served</Badge>}
                  {m.is_baseline && <Badge variant="outline">Baseline</Badge>}
                </span>
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">{formatMm(m.val_rmse_mm, 4)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{formatMm(m.test_rmse_mm, 4)}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">{m.test_heavy_hit}/{m.test_heavy_actual}</TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {m.seeds ? meanSd(m.seeds.mean.test_rmse_mm, m.seeds.sd.test_rmse_mm, 4) : <SingleRun />}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {m.seeds ? meanSd(m.seeds.mean.test_heavy_hit, m.seeds.sd.test_heavy_hit, 1) : <SingleRun />}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        RMSE in mm. The validation RMSE, test RMSE and heavy-hour columns are the published seed-42 runs.
        {nSeeds ? ` Seed columns cover ${nSeeds} seeds of the same model.` : ''}
      </p>

      {findings.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm" data-testid="comparison-findings">
          {findings.map((finding) => <li key={finding}>{finding}</li>)}
        </ul>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <MetricChart
          title="Test RMSE (mm), lower is better"
          models={models}
          value={(m) => m.seeds?.mean.test_rmse_mm ?? m.test_rmse_mm}
          sd={(m) => m.seeds?.sd.test_rmse_mm ?? 0}
          decimals={4}
          domainMax="auto"
        />
        <MetricChart
          title={`Heavy test hours caught (of ${models[0]?.test_heavy_actual}), higher is better`}
          models={models}
          value={(m) => m.seeds?.mean.test_heavy_hit ?? m.test_heavy_hit}
          sd={(m) => m.seeds?.sd.test_heavy_hit ?? 0}
          decimals={1}
          domainMax={models[0]?.test_heavy_actual ?? 'auto'}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Bars start at zero. Neural models show the seed mean with an SD whisker; ARIMA and Persistence are single runs.
      </p>
    </>
  )
}

function SingleRun() {
  return <span className="font-sans text-muted-foreground">single run</span>
}

interface MetricChartProps {
  title: string
  models: ComparisonModel[]
  value: (m: ComparisonModel) => number
  sd: (m: ComparisonModel) => number
  decimals: number
  domainMax: number | 'auto'
}

function MetricChart({ title, models, value, sd, decimals, domainMax }: MetricChartProps) {
  const rows = models.map((m) => ({
    name: m.is_baseline ? `${m.model} (baseline)` : m.selected ? `${m.model} (served)` : m.model,
    value: value(m),
    sd: sd(m),
    fill: m.selected ? 'var(--chart-1)' : m.is_baseline ? 'var(--chart-4)' : 'var(--chart-2)',
  }))
  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 text-sm font-medium">{title}</figcaption>
      <ChartContainer config={{}} className="aspect-auto h-56 w-full" aria-hidden>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" domain={[0, domainMax]} tickLine={false} />
          <YAxis type="category" dataKey="name" width={118} tickLine={false} axisLine={false} interval={0} />
          <Bar dataKey="value" radius={[0, 2, 2, 0]} isAnimationActive={false}>
            {rows.map((row) => <Cell key={row.name} fill={row.fill} />)}
            <ErrorBar dataKey="sd" direction="x" width={6} stroke="var(--foreground)" />
            <LabelList
              dataKey="value"
              content={({ x, y, width, height, index }) => {
                const row = rows[index ?? 0]
                // Bars start at zero, so the whisker's length is proportional to
                // the bar's. The value goes just past the end of the whisker.
                const end = Number(x) + Number(width) * (1 + row.sd / row.value)
                return (
                  <text
                    x={end + 8}
                    y={Number(y) + Number(height) / 2}
                    dominantBaseline="central"
                    className="fill-foreground font-mono text-xs"
                  >
                    {formatMm(row.value, decimals)}
                  </text>
                )
              }}
            />
          </Bar>
        </BarChart>
      </ChartContainer>
    </figure>
  )
}
