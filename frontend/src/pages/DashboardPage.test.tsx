import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { ACTIONS, DashboardPage, thresholdNote } from './DashboardPage'
import type { LiveCurrent } from '@/lib/types'

const reading = (hour: number) => ({
  time: `2026-11-02T${String(hour).padStart(2, '0')}:00:00`,
  precipitation: hour === 15 ? 2.4 : 0.1,
  temperature_2m: 21.26,
  relative_humidity_2m: 74,
  surface_pressure: 838.4,
  wind_speed_10m: 12.2,
})

const live = (overrides: Partial<LiveCurrent> = {}): LiveCurrent => ({
  freshness: 'Live',
  thresholds: [{ below_mm: 2.5, label: 'low' }, { below_mm: 7.6, label: 'moderate' }],
  highest_risk: 'high',
  thresholds_overridden: false,
  source_note: 'Inputs differ from the ERA5 data the model was trained on.',
  timezone: 'Africa/Nairobi',
  last_error: null,
  last_updated: '2026-11-02T15:02:00',
  target_time: '2026-11-02T16:00:00',
  predicted_mm: 4.03,
  risk_level: 'moderate',
  window: [reading(14), reading(15)],
  forecast: [],
  alert: null,
  ...overrides,
})

// The map has its own tests, and Leaflet needs real browser layout
vi.mock('@/components/map/RiskMap', () => ({ RiskMap: () => <div data-testid="risk-map" /> }))

function renderWith(body: LiveCurrent | Error) {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (body instanceof Error) throw body
    return new Response(JSON.stringify(body), { status: 200 })
  }))
  return render(<MemoryRouter><DashboardPage /></MemoryRouter>)
}

describe('DashboardPage', () => {
  it('shows "Medium" for moderate, the mm, the action and the threshold note', async () => {
    renderWith(live())
    const banner = await screen.findByTestId('risk-banner')
    expect(banner).toHaveAttribute('data-risk', 'moderate')
    expect(within(banner).getByText('Medium')).toBeInTheDocument()
    expect(within(banner).getByText('4.03')).toBeInTheDocument()
    expect(screen.getByTestId('action-line')).toHaveTextContent(ACTIONS.moderate)
    expect(banner).toHaveTextContent('Medium starts at 2.5 mm/h and High at 7.6 mm/h.')
  })

  it.each(['low', 'moderate', 'high'])('has one plain action line for %s', (level) => {
    expect(ACTIONS[level]).toBeTruthy()
  })

  it.each(['Live', 'Stale', 'Fallback'] as const)('shows the %s chip and last-updated time', async (freshness) => {
    renderWith(live({ freshness }))
    expect(await screen.findByTestId('freshness')).toHaveTextContent(freshness)
    expect(screen.getByText(/Last updated 2 Nov 2026, 15:02/)).toBeInTheDocument()
  })

  it('shows the five current readings from the latest hour', async () => {
    renderWith(live())
    expect(await screen.findByTestId('reading-precipitation')).toHaveTextContent('2.4 mm')
    expect(screen.getByTestId('reading-temperature_2m')).toHaveTextContent('21.3 °C')
    expect(screen.getByTestId('reading-relative_humidity_2m')).toHaveTextContent('74 %')
    expect(screen.getByTestId('reading-surface_pressure')).toHaveTextContent('838 hPa')
    expect(screen.getByTestId('reading-wind_speed_10m')).toHaveTextContent('12 km/h')
  })

  it('lists the rainfall chart values for screen readers and attributes Open-Meteo', async () => {
    renderWith(live())
    const rows = within(await screen.findByTestId('rain-table')).getAllByRole('row')
    expect(rows).toHaveLength(2)
    expect(rows[1]).toHaveTextContent('2.4 mm')
    expect(screen.getByRole('link', { name: 'Open-Meteo' })).toBeInTheDocument()
    expect(screen.getByText(/differ from the ERA5/)).toBeInTheDocument()
    expect(screen.getByTestId('risk-map')).toBeInTheDocument()
  })

  it('says it is waiting when there is no reading yet, instead of showing a false Low', async () => {
    renderWith(live({ freshness: 'Unavailable', predicted_mm: null, risk_level: null, window: [], last_updated: null, last_error: 'Forecast API failed' }))
    expect(await screen.findByText('Waiting for the first reading')).toBeInTheDocument()
    expect(screen.getByText(/Forecast API failed/)).toBeInTheDocument()
    expect(screen.queryByTestId('risk-banner')).not.toBeInTheDocument()
  })

  it('says so when the server cannot be reached', async () => {
    renderWith(new TypeError('Failed to fetch'))
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach the FloodWatch server")
  })

  it('notes when an administrator has set the limits', () => {
    expect(thresholdNote(live({ thresholds_overridden: true }))).toContain('Set by an administrator')
  })
})
