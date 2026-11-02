import { useEffect, useState } from 'react'
import { ServerCrash } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { HeroPanel } from '@/components/dashboard/HeroPanel'
import { ModelComparison } from '@/components/dashboard/ModelComparison'
import { PredictionTimeline } from '@/components/dashboard/PredictionTimeline'
import { TopBar } from '@/components/dashboard/TopBar'
import { WindowChart } from '@/components/dashboard/WindowChart'
import { getComparison, getHealth, getMeta, getPredictions, getReplay, predict } from '@/lib/api'
import type { Comparison, Health, Meta, Prediction, ReplayWindow, StoredPrediction } from '@/lib/types'

/** The replay hour can be linked to as ?window=N (1-based, like the page shows it). */
function windowFromUrl(): number {
  const wanted = Number(new URLSearchParams(window.location.search).get('window'))
  return Number.isInteger(wanted) && wanted >= 1 ? wanted - 1 : 0
}

function windowToUrl(index: number) {
  try {
    const url = new URL(window.location.href)
    url.searchParams.set('window', String(index + 1))
    window.history.replaceState(null, '', url)
  } catch {
    // ignore: the link just won't update
  }
}

const message = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason))

/** Model evidence: the replay and comparison analysis page. */
export default function EvidencePage() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [comparison, setComparison] = useState<Comparison | null>(null)
  const [comparisonError, setComparisonError] = useState<string | null>(null)

  const [index, setIndex] = useState(windowFromUrl)
  const [replay, setReplay] = useState<ReplayWindow | null>(null)
  const [prediction, setPrediction] = useState<Prediction | null>(null)
  const [busy, setBusy] = useState(false)
  const [predictionError, setPredictionError] = useState<string | null>(null)

  const [predictions, setPredictions] = useState<StoredPrediction[] | null>(null)
  const [predictionsError, setPredictionsError] = useState<string | null>(null)
  // The backend doesn't store which replay hour a prediction was for, so the
  // page remembers it for the predictions it makes itself
  const [sessionHours, setSessionHours] = useState<Record<number, string>>({})

  // Load the settings, the serving model and the results once
  useEffect(() => {
    Promise.allSettled([getMeta(), getHealth(), getComparison()]).then(
      ([metaResult, healthResult, comparisonResult]) => {
        if (metaResult.status === 'fulfilled') setMeta(metaResult.value)
        else setApiError(message(metaResult.reason))
        if (healthResult.status === 'fulfilled') setHealth(healthResult.value)
        if (comparisonResult.status === 'fulfilled') setComparison(comparisonResult.value)
        else setComparisonError(message(comparisonResult.reason))
      },
    )
  }, [])

  // For each replay hour: fetch its 24-hour window, then ask the served
  // model for the next hour through /predict (which stores the prediction),
  // then re-read the stored predictions for the timeline
  useEffect(() => {
    if (!meta) return
    if (index >= meta.window_count) {
      setIndex(meta.window_count - 1)
      return
    }
    let stale = false // set when the user moves on before this finishes
    setBusy(true)
    setPredictionError(null)
    windowToUrl(index)
    getReplay(index)
      .then(async (replayWindow) => {
        const result = await predict(replayWindow.readings)
        if (stale) return
        setReplay(replayWindow)
        setPrediction(result)
        setSessionHours((hours) => ({ ...hours, [result.id]: replayWindow.target_time }))
        try {
          const stored = await getPredictions()
          if (!stale) {
            setPredictions(stored)
            setPredictionsError(null)
          }
        } catch (reason) {
          if (!stale) setPredictionsError(message(reason))
        }
      })
      .catch((reason) => !stale && setPredictionError(message(reason)))
      .finally(() => !stale && setBusy(false))
    return () => {
      stale = true
    }
  }, [meta, index])

  return (
    <div>
      <TopBar health={health} meta={meta} comparison={comparison} />

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 xl:grid-cols-3">
        {apiError && (
          <Alert variant="destructive" className="xl:col-span-3">
            <ServerCrash aria-hidden />
            <AlertTitle>Can't reach the prediction API</AlertTitle>
            <AlertDescription>
              {apiError}. Start it from the repo root with <code className="font-mono">python -m backend.app</code>.
            </AlertDescription>
          </Alert>
        )}

        <section aria-label="Next-hour prediction" className="min-w-0 xl:row-span-2">
          <HeroPanel
            meta={meta}
            health={health}
            replay={replay}
            prediction={prediction}
            index={index}
            busy={busy}
            error={predictionError}
            onIndexChange={setIndex}
          />
        </section>

        <section aria-label="24-hour input window" className="min-w-0 xl:col-span-2">
          <WindowChart meta={meta} replay={replay} prediction={prediction} />
        </section>

        <section aria-label="Recent predictions" className="min-w-0 xl:col-span-2">
          <PredictionTimeline
            meta={meta}
            predictions={predictions}
            sessionHours={sessionHours}
            error={predictionsError}
          />
        </section>

        <section aria-label="Model comparison" className="min-w-0 xl:col-span-3">
          <ModelComparison comparison={comparison} error={comparisonError} />
        </section>
      </main>

      <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-muted-foreground sm:px-6">
        Inputs: Open-Meteo historical archive (ERA5 reanalysis), Nairobi grid cell. ICS 4111 capstone.
      </footer>
    </div>
  )
}
