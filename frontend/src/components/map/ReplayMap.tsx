import { useMemo } from 'react'
import { divIcon } from 'leaflet'
import { CircleMarker, MapContainer, Marker, TileLayer, Tooltip } from 'react-leaflet'

import { riskStyle } from '@/components/dashboard/risk'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatHourRange } from '@/lib/format'
import type { Meta } from '@/lib/types'
import { MARKER_ANCHOR, OSM_ATTRIBUTION, riskMarkerHtml, ZONE_LABEL_OFFSET, ZONE_LABEL_SIDE } from './RiskMap'

interface ReplayMapProps {
  map: NonNullable<Meta['map']>
  /** The replayed hour's prediction, or null before the first one */
  level: string | null
  mm: number | null
  targetTime: string | null
}

/** The Demo page's Nairobi map. The marker follows the replay's prediction.
 *  There are no rainfall layers: no forecast exists for the replayed hours, and
 *  today's forecast would not match them. Nothing here raises an alert. */
export function ReplayMap({ map, level, mm, targetTime }: ReplayMapProps) {
  const icon = useMemo(() => divIcon({
    className: '',
    html: level ? riskMarkerHtml(level, mm ?? 0) : '<span class="fw-risk-marker">Waiting…</span>',
    iconSize: [130, 26],
    iconAnchor: MARKER_ANCHOR,
  }), [level, mm])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nairobi map (replay)</CardTitle>
        <CardDescription>
          The marker is the model's risk for one grid cell in the replayed hour
          {targetTime ? `, ${formatHourRange(targetTime)}` : ''}. No rainfall layers: there is no forecast for past hours.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="isolate h-72 min-w-0 overflow-hidden rounded-lg border lg:h-80" data-testid="replay-map"
          data-risk={level ?? ''}>
          <MapContainer center={[map.centre.lat, map.centre.lon]} zoom={11} scrollWheelZoom={false} className="h-full w-full">
            <TileLayer attribution={OSM_ATTRIBUTION} url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {map.zones.map((zone) => (
              <CircleMarker key={zone.name} center={[zone.lat, zone.lon]} radius={7}
                pathOptions={{ color: '#0f1b2a', weight: 2, fillColor: '#ffffff', fillOpacity: 1 }}>
                <Tooltip permanent direction={ZONE_LABEL_SIDE[zone.name] ?? 'top'} offset={ZONE_LABEL_OFFSET[ZONE_LABEL_SIDE[zone.name] ?? 'top']}>
                  {zone.name}
                </Tooltip>
              </CircleMarker>
            ))}
            <CircleMarker center={[map.centre.lat, map.centre.lon]} radius={4} interactive={false}
              pathOptions={{ color: '#0f1b2a', weight: 2, fillColor: riskStyle(level ?? '').solid, fillOpacity: 1 }} />
            <Marker position={[map.centre.lat, map.centre.lon]} icon={icon} keyboard={false} zIndexOffset={1000}
              title="Model risk for this one grid cell, replayed" />
          </MapContainer>
        </div>
      </CardContent>
    </Card>
  )
}
