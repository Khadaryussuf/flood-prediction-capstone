// Plain-language findings worked out from /api/comparison, so the page's
// sentences can't drift away from the result files.
import type { ComparisonModel } from './types'
import { formatMm } from './format'

const servedModel = (models: ComparisonModel[]) => models.find((m) => m.selected)

/** Models that caught more heavy test hours than the served one. */
export function caughtMoreThanServed(models: ComparisonModel[]): string | null {
  const served = servedModel(models)
  if (!served) return null
  const better = models
    .filter((m) => m.test_heavy_hit > served.test_heavy_hit)
    .sort((a, b) => b.test_heavy_hit - a.test_heavy_hit)
  if (better.length === 0) return null
  const names = better.map((m) => `${m.model} (${m.test_heavy_hit}/${m.test_heavy_actual})`).join(' and ')
  return `${names} caught more heavy hours than the served ${served.model} (${served.test_heavy_hit}/${served.test_heavy_actual}).`
}

/** Says when the closest model's test RMSE is inside the seed spread of the served one. */
export function withinSeedSpread(models: ComparisonModel[]): string | null {
  const served = servedModel(models)
  if (!served?.seeds) return null
  const { mean, sd } = served.seeds
  const others = models.filter((m) => m !== served && m.seeds)
  const closest = others.sort(
    (a, b) =>
      Math.abs(a.seeds!.mean.test_rmse_mm - mean.test_rmse_mm) -
      Math.abs(b.seeds!.mean.test_rmse_mm - mean.test_rmse_mm),
  )[0]
  if (!closest?.seeds) return null
  const gap = Math.abs(closest.seeds.mean.test_rmse_mm - mean.test_rmse_mm)
  const largerSd = Math.max(sd.test_rmse_mm, closest.seeds.sd.test_rmse_mm)
  if (gap >= largerSd) return null
  return (
    `${served.model} and ${closest.model} can't be told apart on test RMSE: the gap of ` +
    `${formatMm(gap, 4)} mm is smaller than the larger seed SD of ${formatMm(largerSd, 4)} mm.`
  )
}
