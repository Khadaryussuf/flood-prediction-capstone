import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { fixtures } from '@/test/mockApi'
import { DEMO_START_INDEX, DemoPage, stepDelay } from './DemoPage'

// Leaflet needs real browser layout; the marker stand-in shows the icon's HTML
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: ReactNode }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  CircleMarker: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Marker: ({ icon }: { icon: { options: { html: string } } }) =>
    <div data-testid="risk-marker" dangerouslySetInnerHTML={{ __html: icon.options.html }} />,
}))

/** The first replayed hour is Low, the next Medium */
function serve() {
  const paths: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    paths.push(path)
    if (path === '/api/meta') return new Response(JSON.stringify(fixtures.meta))
    if (path === '/health') return new Response(JSON.stringify(fixtures.health))
    const replay = path.match(/^\/api\/replay\/(\d+)$/)
    if (replay) return new Response(JSON.stringify({ ...fixtures.replay0, index: Number(replay[1]) }))
    if (path === '/predict' && init?.method === 'POST') {
      const step = paths.filter((p) => p === '/predict').length
      return new Response(JSON.stringify(step === 1 ? fixtures.predict0
        : { ...fixtures.predict0, predicted_mm: 4.03, risk_level: 'moderate' }))
    }
    return new Response('{}', { status: 404 })
  }))
  return paths
}

describe('Demo page map', () => {
  it('shows the Nairobi map, and its marker follows the replay', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      const paths = serve()
      render(<TooltipProvider><DemoPage /></TooltipProvider>)
      await waitFor(() => expect(screen.getByTestId('replay-map')).toHaveAttribute('data-risk', 'low'))
      expect(screen.getByTestId('risk-marker')).toHaveTextContent('Low 0.06 mm')
      expect(screen.getByText('Mathare')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Play' }))
      await act(async () => { await vi.advanceTimersByTimeAsync(stepDelay(1) + 50) })
      await waitFor(() => expect(screen.getByTestId('replay-map')).toHaveAttribute('data-risk', 'moderate'))
      expect(screen.getByTestId('risk-marker')).toHaveTextContent('Medium 4.03 mm')
      expect(paths).toContain(`/api/replay/${DEMO_START_INDEX + 1}`)

      // The replay only ever calls /predict: no alert, map-forecast or live route
      expect(paths.filter((p) => p.startsWith('/api/alerts') || p.startsWith('/api/map') || p.startsWith('/api/live'))).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})
