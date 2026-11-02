import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { peakLine, rainColour, riskMarkerHtml, RiskMap, timeLabel } from './RiskMap'
import type { LiveCurrent, MapForecast } from '@/lib/types'

// Leaflet needs real browser layout, so these stand in for its components.
// The screenshots check the real map.
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: ({ attribution }: { attribution: string }) => <div data-testid="tiles">{attribution}</div>,
  Rectangle: ({ pathOptions }: { pathOptions: { fillColor: string } }) => <div data-testid="cell" data-colour={pathOptions.fillColor} />,
  CircleMarker: ({ children }: { children: ReactNode }) => <div data-testid="zone">{children}</div>,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Marker: () => <div data-testid="risk-marker" />,
}))

const times = Array.from({ length: 37 }, (_, h) =>
  new Date(Date.UTC(2026, 10, 1, 21 + h)).toISOString().slice(0, 16))
const rain = (now: number, later: number) => times.map((_, h) => (h < 24 ? 0 : h === 24 ? now : later))

const forecast = (overrides: Partial<MapForecast> = {}): MapForecast => ({
  available: true,
  stale: false,
  label: 'Weather forecast from Open-Meteo, not model risk.',
  times,
  now_index: 24,
  centre: { lat: -1.2921, lon: 36.8219 },
  peak: { hours: 3, mm: 1.24, time: times[27] },
  grid: [{ lat: -1.28, lon: 36.82, rain: rain(3, 0) }, { lat: -1.24, lon: 36.82, rain: rain(0, 0) }],
  cell: { lat: 0.04, lon: 0.05 },
  zones: [{ name: 'Mathare', lat: -1.26, lon: 36.86, rain: rain(0.4, 1) }, { name: 'Kibera', lat: -1.31, lon: 36.79, rain: rain(0, 0) }, { name: 'CBD', lat: -1.29, lon: 36.82, rain: rain(0, 0) }],
  ...overrides,
})
const live = { risk_level: 'moderate', predicted_mm: 4.03 } as LiveCurrent

function renderMap(body: MapForecast | { available: false; label: string } | Error = forecast()) {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (body instanceof Error) throw body
    return new Response(JSON.stringify(body), { status: 200 })
  }))
  return render(<RiskMap live={live} />)
}

describe('RiskMap', () => {
  it('labels the zones as forecast and never as model risk', async () => {
    renderMap()
    expect(await screen.findByText('Mathare: 0.4 mm forecast')).toBeInTheDocument()
    expect(screen.getByText('Kibera: 0.0 mm forecast')).toBeInTheDocument()
    expect(screen.getByText('CBD: 0.0 mm forecast')).toBeInTheDocument()
    expect(screen.getByText(/Weather forecast from Open-Meteo, not model risk/)).toBeInTheDocument()
    expect(screen.getByText(/the model's risk, for one grid cell only/)).toBeInTheDocument()
  })

  it('colours the grid by forecast rain, with colours separate from the risk ones', async () => {
    renderMap()
    const cells = await screen.findAllByTestId('cell')
    expect(cells).toHaveLength(1) // the dry cell is left out
    expect(cells[0]).toHaveAttribute('data-colour', rainColour(3))
    for (const mm of [0.2, 1, 3, 9]) expect(rainColour(mm)).toMatch(/^#/)
    expect(rainColour(0.05)).toBeNull()
  })

  it('moves through time with the slider and comes back to now', async () => {
    const user = userEvent.setup()
    renderMap()
    expect(await screen.findByTestId('map-time')).toHaveTextContent('(now)')
    fireEvent.change(screen.getByRole('slider'), { target: { value: '30' } })
    expect(screen.getByTestId('map-time')).toHaveTextContent('(in 6 h)')
    expect(screen.getByText('Mathare: 1.0 mm forecast')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0' } })
    expect(screen.getByTestId('map-time')).toHaveTextContent('(24 h ago)')
    await user.click(screen.getByRole('button', { name: 'Now' }))
    expect(screen.getByTestId('map-time')).toHaveTextContent('(now)')
    expect(screen.getByRole('slider')).toHaveAttribute('max', '36')
  })

  it('turns layers off and on from the panel', async () => {
    const user = userEvent.setup()
    renderMap()
    expect(await screen.findAllByTestId('zone')).toHaveLength(3)
    await user.click(screen.getByRole('checkbox', { name: 'Watch zones' }))
    expect(screen.queryByTestId('zone')).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Forecast rainfall grid' }))
    expect(screen.queryByTestId('cell')).not.toBeInTheDocument()
    expect(screen.getByTestId('risk-marker')).toBeInTheDocument()
  })

  it('states the peak, or that no rain is forecast', async () => {
    renderMap()
    expect(await screen.findByTestId('peak-line')).toHaveTextContent('Peak expected in 3 hours: 1.2 mm around 00:00.')
    expect(peakLine(forecast({ peak: { hours: 1, mm: 0.5, time: times[25] } }))).toContain('in 1 hour:')
    expect(peakLine(forecast({ peak: null }))).toBe('No rain above 0.1 mm forecast in the next 12 hours.')
  })

  it('shows the risk marker as a shape and text', () => {
    expect(riskMarkerHtml('moderate', 4.03)).toContain('◆')
    expect(riskMarkerHtml('moderate', 4.03)).toContain('Medium 4.03 mm')
    expect(riskMarkerHtml('high', 9)).toContain('▲')
    expect(riskMarkerHtml('low', 0)).toContain('●')
  })

  it('attributes OpenStreetMap and Open-Meteo', async () => {
    renderMap()
    expect(await screen.findByTestId('tiles')).toHaveTextContent('OpenStreetMap')
    expect(screen.getByRole('link', { name: 'Open-Meteo' })).toBeInTheDocument()
  })

  it('says so when the forecast is unavailable, without hiding the risk', async () => {
    renderMap({ available: false, label: 'x' })
    expect(await screen.findByRole('status')).toHaveTextContent("isn't available right now")
    expect(screen.queryByTestId('map')).not.toBeInTheDocument()
  })

  it('labels times', () => {
    expect(timeLabel(forecast(), 26)).toContain('in 2 h')
  })
})
