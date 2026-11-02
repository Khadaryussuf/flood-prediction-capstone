import { useEffect, useMemo, useState } from 'react'
import { divIcon } from 'leaflet'
import { CircleMarker, MapContainer, Marker, Rectangle, TileLayer, Tooltip } from 'react-leaflet'
import { AlertTriangle, CloudRain } from 'lucide-react'

import { riskStyle } from '@/components/dashboard/risk'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { getMapForecast } from '@/lib/api'
import { formatClock, formatHour, formatMm } from '@/lib/format'
import type { LiveCurrent, MapForecast } from '@/lib/types'

const REFRESH_MS = 30 * 60 * 1000
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

/** Blues for forecast rain: deliberately not the risk colours, so nobody reads a
 *  neighbourhood's forecast as the model's risk for it. */
const RAIN_SCALE: { from: number; colour: string; label: string }[] = [
  { from: 7.6, colour: '#08306b', label: '7.6 mm or more' },
  { from: 2.5, colour: '#2171b5', label: '2.5 to 7.6 mm' },
  { from: 0.5, colour: '#6baed6', label: '0.5 to 2.5 mm' },
  { from: 0.1, colour: '#c6dbef', label: '0.1 to 0.5 mm' },
]

// The zones and the marker are close together, so each label goes its own way
const ZONE_LABEL_SIDE: Record<string, 'top' | 'bottom' | 'left'> = { Mathare: 'top', CBD: 'left', Kibera: 'bottom' }
const ZONE_LABEL_OFFSET: Record<string, [number, number]> = { top: [0, -6], bottom: [0, 6], left: [-6, 0] }

export function rainColour(mm: number): string | null {
  return RAIN_SCALE.find((band) => mm >= band.from)?.colour ?? null
}

/** "Peak expected in 3 hours: 1.2 mm around 18:00" */
export function peakLine(forecast: MapForecast): string {
  if (!forecast.peak) return 'No rain above 0.1 mm forecast in the next 12 hours.'
  const { hours, mm, time } = forecast.peak
  return `Peak expected in ${hours} ${hours === 1 ? 'hour' : 'hours'}: ${formatMm(mm, 1)} mm around ${formatClock(time)}.`
}

/** The slider's position in words */
export function timeLabel(forecast: MapForecast, index: number): string {
  const offset = index - forecast.now_index
  const when = offset === 0 ? 'now' : offset < 0 ? `${-offset} h ago` : `in ${offset} h`
  return `${formatHour(forecast.times[index])} (${when})`
}

/** The model's risk, for this one grid cell: a shape and text, not just a colour. */
export function riskMarkerHtml(level: string, mm: number): string {
  const { label, solid } = riskStyle(level)
  const shape = level === 'high' ? '▲' : level === 'moderate' ? '◆' : '●'
  return `<span class="fw-risk-marker"><span style="color:${solid}" aria-hidden="true">${shape}</span> ${label} ${formatMm(mm)} mm</span>`
}

function MapBody({ forecast, live }: { forecast: MapForecast; live: LiveCurrent }) {
  const [index, setIndex] = useState(forecast.now_index)
  const [showGrid, setShowGrid] = useState(true)
  const [showZones, setShowZones] = useState(true)

  const icon = useMemo(() => divIcon({
    className: '',
    html: riskMarkerHtml(live.risk_level ?? '', live.predicted_mm ?? 0),
    iconSize: [130, 26],
    // Sits just to the right of the cell's centre, clear of the zone labels
    iconAnchor: [-6, 13],
  }), [live.risk_level, live.predicted_mm])

  const lastIndex = forecast.times.length - 1
  const hour = timeLabel(forecast, index)

  return (
    <>
      <p className="flex items-center gap-2 font-medium" data-testid="peak-line">
        <CloudRain className="size-4 shrink-0" aria-hidden />
        {peakLine(forecast)}
      </p>
      {forecast.stale && (
        <p className="text-sm text-muted-foreground">The latest forecast fetch failed, so this is the last good copy.</p>
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* isolate keeps the map's own stacking inside this box, under menus and sheets */}
        <div className="isolate h-80 min-w-0 overflow-hidden rounded-lg border lg:h-[26rem] lg:flex-1" data-testid="map-frame">
          <MapContainer center={[forecast.centre.lat, forecast.centre.lon]} zoom={11} scrollWheelZoom={false} className="h-full w-full">
            <TileLayer attribution={OSM_ATTRIBUTION} url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {showGrid && forecast.grid.map((cell) => {
              const colour = rainColour(cell.rain[index])
              if (!colour) return null
              return (
                <Rectangle
                  key={`${cell.lat},${cell.lon}`}
                  bounds={[[cell.lat - forecast.cell.lat / 2, cell.lon - forecast.cell.lon / 2],
                    [cell.lat + forecast.cell.lat / 2, cell.lon + forecast.cell.lon / 2]]}
                  pathOptions={{ color: colour, fillColor: colour, fillOpacity: 0.45, weight: 0 }}
                  interactive={false}
                />
              )
            })}
            {showZones && forecast.zones.map((zone) => (
              <CircleMarker key={zone.name} center={[zone.lat, zone.lon]} radius={7}
                pathOptions={{ color: '#0f1b2a', weight: 2, fillColor: '#ffffff', fillOpacity: 1 }}>
                <Tooltip permanent direction={ZONE_LABEL_SIDE[zone.name] ?? 'top'} offset={ZONE_LABEL_OFFSET[ZONE_LABEL_SIDE[zone.name] ?? 'top']}>
                  {zone.name}: {formatMm(zone.rain[index], 1)} mm forecast
                </Tooltip>
              </CircleMarker>
            ))}
            <Marker position={[forecast.centre.lat, forecast.centre.lon]} icon={icon} keyboard={false} zIndexOffset={1000}
              title="Model risk for this one grid cell" />
          </MapContainer>
        </div>

        <aside className="flex flex-col gap-4 lg:w-64" aria-label="Map layers">
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1 font-medium">Layers</legend>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="size-4" checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} />
              Forecast rainfall grid
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="size-4" checked={showZones} onChange={(event) => setShowZones(event.target.checked)} />
              Watch zones
            </label>
          </fieldset>

          {showGrid && (
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground" aria-label="Forecast rainfall key">
              {[...RAIN_SCALE].reverse().map((band) => (
                <li key={band.from} className="flex items-center gap-2">
                  <span className="size-3 rounded-sm ring-1 ring-border" style={{ backgroundColor: band.colour }} aria-hidden />
                  {band.label}
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-col gap-1 rounded-lg border bg-muted/50 p-3 text-xs">
            <p className="font-medium">How to read this map</p>
            <p><span className="font-medium">Marker:</span> the model's risk, for one grid cell only.</p>
            <p><span className="font-medium">Grid and zones:</span> {forecast.label} Squares can repeat because the forecast's cells are coarse.</p>
          </div>
        </aside>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="map-time" className="text-sm font-medium">
          Forecast rain shown: <span data-testid="map-time">{hour}</span>
        </label>
        <input
          id="map-time"
          type="range"
          className="w-full accent-primary"
          min={0}
          max={lastIndex}
          value={index}
          aria-valuetext={hour}
          onChange={(event) => setIndex(Number(event.target.value))}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Past 24 h</span>
          <button type="button" className="underline underline-offset-2" onClick={() => setIndex(forecast.now_index)}>Now</button>
          <span>Next 12 h</span>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Map data by <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors.
        Forecast by <a className="underline" href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>.
      </p>
    </>
  )
}

/** The Dashboard's Nairobi map. */
export function RiskMap({ live }: { live: LiveCurrent }) {
  const [forecast, setForecast] = useState<MapForecast | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const load = () => {
      getMapForecast().then((body) => {
        setForecast(body)
        setFailed(!body.available)
      }).catch(() => setFailed(true))
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => clearInterval(timer)
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nairobi map</CardTitle>
        <CardDescription>The model's risk applies to one grid cell. Rainfall layers are a weather forecast.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {failed && !forecast?.available && (
          <Alert role="status">
            <AlertTriangle aria-hidden />
            <AlertDescription>The map forecast isn't available right now. The risk above isn't affected.</AlertDescription>
          </Alert>
        )}
        {!forecast && !failed && <Skeleton className="h-80" />}
        {forecast?.available && <MapBody key={forecast.times[0]} forecast={forecast} live={live} />}
      </CardContent>
    </Card>
  )
}
