import { useEffect, useState, type FormEvent } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError, postJson, request } from '@/lib/api'
import { formatMm } from '@/lib/format'
import type { ThresholdPreview, ThresholdSettings } from '@/lib/types'
import { Field } from './AuthCard'

const errorText = (reason: unknown) => (reason instanceof ApiError ? reason.detail : 'Something went wrong. Try again.')

/** "Last 30 days would have raised 2 alerts" */
export function previewLine(preview: ThresholdPreview): string {
  const { days, alerts, hours_checked: hours } = preview
  if (hours === 0) return `No predictions from the last ${days} days to check yet.`
  return `Last ${days} days would have raised ${alerts} ${alerts === 1 ? 'alert' : 'alerts'}.`
}

/** Edit the risk limits, with a preview before saving. */
export function ThresholdsTab() {
  const [settings, setSettings] = useState<ThresholdSettings | null>(null)
  const [form, setForm] = useState({ medium_from: '', high_from: '', cooldown_hours: '' })
  const [preview, setPreview] = useState<ThresholdPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const show = (body: ThresholdSettings) => {
    setSettings(body)
    setForm({
      medium_from: String(body.medium_from),
      high_from: String(body.high_from),
      cooldown_hours: String(body.cooldown_hours),
    })
  }

  useEffect(() => {
    request<ThresholdSettings>('/api/admin/thresholds').then(show).catch((reason) => setError(errorText(reason)))
  }, [])

  const values = () => ({
    medium_from: Number(form.medium_from),
    high_from: Number(form.high_from),
    cooldown_hours: Number(form.cooldown_hours),
  })

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [key]: event.target.value })
    setPreview(null) // the old preview no longer matches
    setSaved(null)
  }

  const runPreview = async () => {
    setError(null)
    try {
      setPreview(await postJson<ThresholdPreview>('/api/admin/thresholds/preview', values()))
    } catch (reason) {
      setError(errorText(reason))
    }
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    try {
      show(await postJson<ThresholdSettings>('/api/admin/thresholds', values(), 'PUT'))
      setSaved('Saved. New predictions use these limits.')
    } catch (reason) {
      setError(errorText(reason))
    }
  }

  const reset = async () => {
    setError(null)
    setPreview(null)
    try {
      show(await request<ThresholdSettings>('/api/admin/thresholds', { method: 'DELETE' }))
      setSaved('Back to the defaults.')
    } catch (reason) {
      setError(errorText(reason))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Risk limits</CardTitle>
        <CardDescription>
          {settings
            ? `Defaults: Medium from ${settings.default_medium_from} mm/h and High from ${settings.default_high_from} mm/h, the American Meteorological Society's rain intensity classes. These aren't calibrated to Nairobi flood records. ${settings.overridden ? 'Currently overridden.' : 'Currently using the defaults.'}`
            : 'Loading'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!settings && !error && <Skeleton className="h-40" />}
        {error && (
          <Alert variant="destructive" role="alert" className="mb-4">
            <AlertTriangle aria-hidden />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {settings && (
          <form onSubmit={save} className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Medium from (mm/h)" id="medium-from" type="number" step="any" min="0" required value={form.medium_from} onChange={set('medium_from')} />
              <Field label="High from (mm/h)" id="high-from" type="number" step="any" min="0" required value={form.high_from} onChange={set('high_from')} />
              <Field label="Alert cool-down (hours)" id="cooldown" type="number" step="1" min="0" max="48" required value={form.cooldown_hours} onChange={set('cooldown_hours')} />
            </div>

            {preview && (
              <div role="status" className="rounded-lg border bg-muted/50 p-3 text-sm" data-testid="threshold-preview">
                <p className="font-medium">{previewLine(preview)}</p>
                {preview.hours_checked > 0 && (
                  <p className="text-muted-foreground">
                    Checked {preview.hours_checked} hours: {preview.medium_hours} Medium and {preview.high_hours} High.
                    Highest prediction {formatMm(preview.highest_prediction_mm ?? 0)} mm.
                  </p>
                )}
              </div>
            )}
            {saved && (
              <p role="status" className="flex items-center gap-1.5 text-sm text-risk-low">
                <CheckCircle2 className="size-4" aria-hidden />
                {saved}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" className="h-9" onClick={runPreview}>Preview</Button>
              <Button type="submit" className="h-9">Save</Button>
              <Button type="button" variant="outline" className="h-9" onClick={reset} disabled={!settings.overridden}>Reset to defaults</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
