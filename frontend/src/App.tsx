import { useEffect, useState } from 'react'
import { ServerCrash } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { DisclaimerStrip } from '@/components/dashboard/DisclaimerStrip'
import { HeroPanel } from '@/components/dashboard/HeroPanel'
import { TopBar } from '@/components/dashboard/TopBar'
import { getHealth, getMeta, getReplay, predict } from '@/lib/api'
import type { Health, Meta, Prediction, ReplayWindow } from '@/lib/types'

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

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)

  const [index, setIndex] = useState(windowFromUrl)
  const [replay, setReplay] = useState<ReplayWindow | null>(null)
  const [prediction, setPrediction] = useState<Prediction | null>(null)
  const [busy, setBusy] = useState(false)
  const [predictionError, setPredictionError] = useState<string | null>(null)

  // Load the settings and the serving model once
  useEffect(() => {
    Promise.allSettled([getMeta(), getHealth()]).then(([metaResult, healthResult]) => {
      if (metaResult.status === 'fulfilled') setMeta(metaResult.value)
      else setApiError(message(metaResult.reason))
      if (healthResult.status === 'fulfilled') setHealth(healthResult.value)
    })
  }, [])

  // For each replay hour: fetch its 24-hour window, then ask the served
  // model for the next hour through /predict (which stores the prediction)
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
      })
      .catch((reason) => !stale && setPredictionError(message(reason)))
      .finally(() => !stale && setBusy(false))
    return () => {
      stale = true
    }
  }, [meta, index])

  return (
    <div className="min-h-svh bg-background">
      <TopBar health={health} meta={meta} />
      <DisclaimerStrip />

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-6 md:grid-cols-2 xl:grid-cols-3">
        {apiError && (
          <Alert variant="destructive" className="md:col-span-2 xl:col-span-3">
            <ServerCrash aria-hidden />
            <AlertTitle>Can't reach the prediction API</AlertTitle>
            <AlertDescription>
              {apiError}. Start it from the repo root with <code className="font-mono">python -m backend.app</code>.
            </AlertDescription>
          </Alert>
        )}

        <section aria-label="Next-hour prediction" className="md:col-span-2 xl:col-span-1">
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
      </main>

      <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-muted-foreground sm:px-6">
        Inputs: Open-Meteo historical archive (ERA5 reanalysis), Nairobi grid cell. ICS 4111 capstone.
      </footer>
    </div>
  )
}
