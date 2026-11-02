import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Search } from 'lucide-react'

import { RiskBadge } from '@/components/dashboard/RiskBadge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { acknowledgeAlert, ApiError, getAlerts, notifyAlertsChanged } from '@/lib/api'
import { formatHour, formatMm } from '@/lib/format'
import type { AlertRow } from '@/lib/types'

function DeliveryStatus({ status }: { status: string }) {
  const sent = status === 'sent'
  const failed = status.startsWith('failed')
  const className = sent
    ? 'bg-risk-low-bg text-risk-low border-risk-low/30'
    : failed
      ? 'bg-risk-high-bg text-risk-high border-risk-high/30'
      : 'bg-muted text-foreground'
  return (
    <Badge variant="outline" className={`h-auto whitespace-normal ${className}`} data-testid="delivery-status">
      Email: {status}
    </Badge>
  )
}

function AlertItem({ row, onAcknowledge }: { row: AlertRow; onAcknowledge: (row: AlertRow) => void }) {
  return (
    <li className="flex flex-col gap-3 border-b py-3 last:border-b-0 md:flex-row md:items-center md:justify-between" data-testid={`alert-${row.id}`}>
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="flex flex-wrap items-center gap-2">
          <RiskBadge level={row.risk_level} />
          <span className="font-medium tabular-nums">{formatMm(row.predicted_mm)} mm</span>
          <span className="text-sm text-muted-foreground">for {formatHour(row.target_time)}</span>
        </p>
        <p className="text-sm">
          <span className="text-muted-foreground">Raised {formatHour(row.at)}, to </span>
          {row.recipient} <span className="break-all text-muted-foreground">({row.recipient_email})</span>
        </p>
        <p><DeliveryStatus status={row.delivery_status} /></p>
      </div>
      <div className="shrink-0">
        {row.acknowledged_at ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 shrink-0" aria-hidden />
            <span>Acknowledged {formatHour(row.acknowledged_at)}<br /><span className="break-all">by {row.acknowledged_by}</span></span>
          </p>
        ) : row.can_acknowledge ? (
          <Button size="lg" className="h-9" onClick={() => onAcknowledge(row)}>Acknowledge</Button>
        ) : (
          <p className="text-sm text-muted-foreground">Not acknowledged</p>
        )}
      </div>
    </li>
  )
}

export function AlertsPage() {
  const [rows, setRows] = useState<AlertRow[] | null>(null)
  const [term, setTerm] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback((search: string) => {
    getAlerts(search).then((body) => {
      setRows(body)
      setError(null)
    }).catch(() => setError("Can't load alerts. Try again."))
  }, [])

  // Waits for a pause in typing before searching
  useEffect(() => {
    const timer = setTimeout(() => load(term), 200)
    return () => clearTimeout(timer)
  }, [term, load])

  const acknowledge = async (row: AlertRow) => {
    setError(null)
    try {
      await acknowledgeAlert(row.id)
      notifyAlertsChanged()
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.detail : "Can't acknowledge that alert. Try again.")
    }
    load(term)
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <div className="relative">
        <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          aria-label="Search alerts"
          placeholder="Search by name, email, level or status"
          className="h-10 pl-9"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
      </div>

      {error && (
        <Alert variant="destructive" role="alert">
          <AlertTriangle aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent>
          {!rows && !error && <Skeleton className="h-32" />}
          {rows?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {term ? 'No alerts match that search.' : 'No alerts yet. An alert is raised when the prediction reaches Medium or High.'}
            </p>
          )}
          {rows && rows.length > 0 && (
            <ul>{rows.map((row) => <AlertItem key={row.id} row={row} onAcknowledge={acknowledge} />)}</ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
