import { useEffect, useState } from 'react'
import { Pause, Play, TriangleAlert } from 'lucide-react'

import { HeroPanel } from '@/components/dashboard/HeroPanel'
import { WindowChart } from '@/components/dashboard/WindowChart'
import { Button } from '@/components/ui/button'
import { getHealth, getMeta, getReplay, predict } from '@/lib/api'
import { DEMO_LABEL } from '@/lib/copy'
import type { Health, Meta, Prediction, ReplayWindow } from '@/lib/types'

/** Starts shortly before the 11-13 May 2025 wet spell, so the demo reaches Medium. */
export const DEMO_START_INDEX = 930
const BASE_STEP_MS = 2500
export const SPEEDS = [1, 2, 4]

export const stepDelay = (speed: number) => BASE_STEP_MS / speed

/** The replay as a demonstration: clearly labelled, with play, pause and speed.
 *  It runs the served model through /predict, and never raises alerts. */
export function DemoPage() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [index, setIndex] = useState(DEMO_START_INDEX)
  const [replay, setReplay] = useState<ReplayWindow | null>(null)
  const [prediction, setPrediction] = useState<Prediction | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)

  useEffect(() => {
    getMeta().then(setMeta).catch((reason) => setError(String(reason?.message ?? reason)))
    getHealth().then(setHealth).catch(() => {})
  }, [])

  // Predict the hour on screen
  useEffect(() => {
    if (!meta) return
    let stale = false
    setBusy(true)
    setError(null)
    getReplay(index)
      .then(async (replayWindow) => {
        const result = await predict(replayWindow.readings)
        if (stale) return
        setReplay(replayWindow)
        setPrediction(result)
      })
      .catch((reason) => {
        if (stale) return
        setError(String(reason?.message ?? reason))
        setPlaying(false)
      })
      .finally(() => !stale && setBusy(false))
    return () => {
      stale = true
    }
  }, [meta, index])

  // While playing, move on once the current hour has finished
  useEffect(() => {
    if (!playing || busy || !meta) return
    if (index >= meta.window_count - 1) {
      setPlaying(false)
      return
    }
    const timer = setTimeout(() => setIndex((current) => current + 1), stepDelay(speed))
    return () => clearTimeout(timer)
  }, [playing, busy, index, speed, meta])

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4 sm:p-6">
      <div role="note" aria-label="Demo mode" data-testid="demo-label"
        className="flex items-start gap-2 rounded-lg border border-risk-moderate/40 bg-risk-moderate-bg p-3 font-semibold text-risk-moderate">
        <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
        <span>{DEMO_LABEL}</span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button className="h-9" onClick={() => setPlaying((current) => !current)} disabled={!meta}>
          {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
          {playing ? 'Pause' : 'Play'}
        </Button>
        <div role="group" aria-label="Speed" className="inline-flex rounded-lg border bg-muted p-1">
          {SPEEDS.map((value) => (
            <Button key={value} size="sm" className="h-7" variant={speed === value ? 'default' : 'ghost'}
              aria-pressed={speed === value} onClick={() => setSpeed(value)}>
              {value}×
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <section aria-label="Replayed prediction" className="min-w-0">
          <HeroPanel meta={meta} health={health} replay={replay} prediction={prediction} index={index}
            busy={busy} error={error} onIndexChange={setIndex} />
        </section>
        <section aria-label="24-hour input window" className="min-w-0 xl:col-span-2">
          <WindowChart meta={meta} replay={replay} prediction={prediction} />
        </section>
      </div>
    </div>
  )
}
