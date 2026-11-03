import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEMO_START_INDEX, DemoPage, stepDelay } from './DemoPage'
import { previewLine, ThresholdsTab } from './ThresholdsTab'
import { riskBands, TrendsPage } from './TrendsPage'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DEMO_LABEL } from '@/lib/copy'
import type { HistoryResponse, ThresholdPreview, ThresholdSettings } from '@/lib/types'
import { fixtures } from '@/test/mockApi'

const history = (range: HistoryResponse['range'], rows: HistoryResponse['rows']): HistoryResponse => ({
  range,
  thresholds: [{ below_mm: 2.5, label: 'low' }, { below_mm: 7.6, label: 'moderate' }],
  highest_risk: 'high',
  rows,
})

describe('TrendsPage', () => {
  function serve() {
    const paths: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (path: string) => {
      paths.push(path)
      const range = new URLSearchParams(path.split('?')[1]).get('range') as HistoryResponse['range']
      const rows = range === '24h'
        ? [{ time: '2026-11-02T10:00:00', predicted_mm: 0.5, risk_level: 'low', source: 'backfill' },
            { time: '2026-11-02T11:00:00', predicted_mm: 3.2, risk_level: 'moderate', source: 'live' }]
        : [{ time: '2026-11-01T10:00:00', predicted_mm: 8.2, risk_level: 'high', source: 'live' }]
      return new Response(JSON.stringify(history(range, rows)))
    }))
    return paths
  }

  it('lists predictions newest first, showing Medium for moderate', async () => {
    serve()
    render(<TrendsPage />)
    const rows = within(await screen.findByTestId('history-table')).getAllByRole('row')
    expect(rows).toHaveLength(3)
    expect(rows[1]).toHaveTextContent('2 Nov 2026, 11:00')
    expect(rows[1]).toHaveTextContent('3.20 mm')
    expect(rows[1]).toHaveTextContent('Medium')
    expect(rows[2]).toHaveTextContent(/backfill/i)
    expect(screen.getByText(/never raised alerts/)).toBeInTheDocument()
  })

  it('states the real limits in the key, not where the chart stops', async () => {
    serve()
    render(<TrendsPage />)
    const key = await screen.findByRole('list', { name: 'Chart shading' })
    expect(key).toHaveTextContent('Medium: 2.5 to 7.6 mm')
  })

  it('switches period and points the CSV export at it', async () => {
    const user = userEvent.setup()
    const paths = serve()
    render(<TrendsPage />)
    await screen.findByTestId('history-table')
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', '/api/history.csv?range=24h')
    await user.click(screen.getByRole('button', { name: '30 days' }))
    expect(await screen.findByText('8.20 mm')).toBeInTheDocument()
    expect(paths).toContain('/api/history?range=30d')
    expect(screen.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', '/api/history.csv?range=30d')
  })

  it('shades from the API limits, cut off at the top of the chart', () => {
    const body = history('24h', [])
    // The shading stops at the chart's top, but the real limit is kept for the legend
    expect(riskBands(body, 3)).toEqual([
      { level: 'low', from: 0, to: 2.5, limit: 2.5 },
      { level: 'moderate', from: 2.5, to: 3, limit: 7.6 },
    ])
    expect(riskBands(body, 10).at(-1)).toEqual({ level: 'high', from: 7.6, to: 10, limit: null })
  })

  it('explains an empty period', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(history('24h', [])))))
    render(<TrendsPage />)
    expect(await screen.findByText(/No predictions for this period yet/)).toBeInTheDocument()
  })
})

describe('ThresholdsTab', () => {
  const settings = (overrides: Partial<ThresholdSettings> = {}): ThresholdSettings => ({
    medium_from: 2.5, high_from: 7.6, cooldown_hours: 3, default_medium_from: 2.5, default_high_from: 7.6, overridden: false, ...overrides,
  })
  const preview: ThresholdPreview = { days: 30, hours_checked: 720, alerts: 2, medium_hours: 5, high_hours: 1, highest_prediction_mm: 8.1 }

  function serve() {
    const calls: { method: string; path: string; body?: unknown }[] = []
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ method, path, body })
      if (path.endsWith('/preview')) return new Response(JSON.stringify(preview))
      if (method === 'PUT' && body.medium_from >= body.high_from) {
        return new Response(JSON.stringify({ error: 'Medium must be above 0 and below High.' }), { status: 400 })
      }
      if (method === 'PUT') return new Response(JSON.stringify(settings({ ...body, overridden: true })))
      return new Response(JSON.stringify(settings()))
    }))
    return calls
  }

  it('previews before saving, without saving', async () => {
    const user = userEvent.setup()
    const calls = serve()
    render(<ThresholdsTab />)
    const medium = await screen.findByLabelText('Medium from (mm/h)')
    await user.clear(medium)
    await user.type(medium, '1')
    await user.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await screen.findByTestId('threshold-preview')).toHaveTextContent('Last 30 days would have raised 2 alerts.')
    const sent = calls.find((call) => call.path.endsWith('/preview'))
    expect(sent?.body).toEqual({ medium_from: 1, high_from: 7.6, cooldown_hours: 3 })
    expect(calls.some((call) => call.method === 'PUT')).toBe(false)

    await user.type(medium, '.5') // changing a value clears the old preview
    expect(screen.queryByTestId('threshold-preview')).not.toBeInTheDocument()
  })

  it('saves, and shows a server refusal', async () => {
    const user = userEvent.setup()
    serve()
    render(<ThresholdsTab />)
    const medium = await screen.findByLabelText('Medium from (mm/h)')
    await user.clear(medium)
    await user.type(medium, '9')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('below High')
    await user.clear(medium)
    await user.type(medium, '1')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/New predictions use these limits/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeEnabled()
  })

  it('accepts limits finer than 0.1 mm, such as 0.01', async () => {
    serve()
    render(<ThresholdsTab />)
    // A step of 0.1 made browsers refuse 0.01 or 2.55 and silently block Save
    expect(await screen.findByLabelText('Medium from (mm/h)')).toHaveAttribute('step', 'any')
    expect(screen.getByLabelText('High from (mm/h)')).toHaveAttribute('step', 'any')
  })

  it('words the preview correctly', () => {
    expect(previewLine({ ...preview, alerts: 1 })).toBe('Last 30 days would have raised 1 alert.')
    expect(previewLine({ ...preview, alerts: 0 })).toBe('Last 30 days would have raised 0 alerts.')
    expect(previewLine({ ...preview, hours_checked: 0 })).toContain('No predictions')
  })
})

describe('DemoPage', () => {
  afterEach(() => vi.useRealTimers())

  function serve() {
    const replayed: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/meta') return new Response(JSON.stringify(fixtures.meta))
      if (path === '/health') return new Response(JSON.stringify(fixtures.health))
      if (path.startsWith('/api/replay/')) {
        replayed.push(path)
        return new Response(JSON.stringify(fixtures.replay0))
      }
      if (path === '/predict' && init?.method === 'POST') return new Response(JSON.stringify(fixtures.predict0))
      return new Response('{}', { status: 404 })
    }))
    return replayed
  }

  const renderDemo = () => render(<TooltipProvider><DemoPage /></TooltipProvider>)

  it('is clearly labelled as a demo and not live', async () => {
    serve()
    renderDemo()
    expect(screen.getByTestId('demo-label')).toHaveTextContent(DEMO_LABEL)
    expect(DEMO_LABEL).toMatch(/not live/i)
    expect(await screen.findByTestId('predicted-mm')).toBeInTheDocument()
  })

  it('plays, pauses, and speeds up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const replayed = serve()
    renderDemo()
    await screen.findByTestId('predicted-mm')
    expect(replayed).toEqual([`/api/replay/${DEMO_START_INDEX}`])

    // Nothing moves until Play
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    expect(replayed).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Play' }))
    await user.click(screen.getByRole('button', { name: '4×' }))
    expect(screen.getByRole('button', { name: '4×' })).toHaveAttribute('aria-pressed', 'true')
    await act(async () => { await vi.advanceTimersByTimeAsync(stepDelay(4) + 50) })
    await waitFor(() => expect(replayed).toContain(`/api/replay/${DEMO_START_INDEX + 1}`))

    await user.click(screen.getByRole('button', { name: 'Pause' }))
    const steps = replayed.length
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    expect(replayed).toHaveLength(steps)
  })

  it('goes faster at higher speeds', () => {
    expect(stepDelay(4)).toBe(stepDelay(1) / 4)
  })
})
