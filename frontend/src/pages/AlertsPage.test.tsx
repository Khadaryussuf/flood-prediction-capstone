import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { AlertsPage } from './AlertsPage'
import { AlertBell } from '@/components/shell/AlertBell'
import { DashboardPage } from './DashboardPage'
import type { AlertRow, LiveCurrent } from '@/lib/types'

vi.mock('@/components/map/RiskMap', () => ({ RiskMap: () => null }))

const row = (overrides: Partial<AlertRow> = {}): AlertRow => ({
  id: 1,
  at: '2026-11-02T15:02:00',
  risk_level: 'moderate',
  predicted_mm: 4.03,
  target_time: '2026-11-02T16:00:00',
  recipient: 'Rita Otieno',
  recipient_email: 'rita@example.org',
  delivery_status: 'not sent: email not configured',
  acknowledged_at: null,
  acknowledged_by: null,
  can_acknowledge: true,
  ...overrides,
})

/** A fake API whose alerts can change, with a running unread count. */
function fakeApi(initial: AlertRow[]) {
  let rows = initial
  const paths: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    paths.push(path)
    if (path.startsWith('/api/alerts/unread')) {
      return new Response(JSON.stringify({ count: rows.filter((r) => !r.acknowledged_at).length }))
    }
    const ack = path.match(/\/api\/alerts\/(\d+)\/ack/)
    if (ack && init?.method === 'POST') {
      rows = rows.map((r) => (r.id === Number(ack[1])
        ? { ...r, acknowledged_at: '2026-11-02T15:30:00', acknowledged_by: 'me@example.org', can_acknowledge: false }
        : r))
      return new Response(JSON.stringify({ status: 'acknowledged' }))
    }
    if (path.startsWith('/api/alerts')) {
      const term = new URLSearchParams(path.split('?')[1]).get('q') ?? ''
      return new Response(JSON.stringify(rows.filter((r) => r.recipient.toLowerCase().includes(term.toLowerCase()))))
    }
    return new Response('{}', { status: 404 })
  }))
  return paths
}

describe('AlertsPage', () => {
  it('shows timestamp, Medium for moderate, recipient and delivery status', async () => {
    fakeApi([row()])
    render(<AlertsPage />)
    const item = await screen.findByTestId('alert-1')
    expect(within(item).getByText('Medium intensity')).toBeInTheDocument()
    expect(item).toHaveTextContent('Raised 2 Nov 2026, 15:02')
    expect(item).toHaveTextContent('Rita Otieno')
    expect(within(item).getByTestId('delivery-status')).toHaveTextContent('not sent: email not configured')
  })

  it('acknowledges, and the bell count falls', async () => {
    const user = userEvent.setup()
    fakeApi([row(), row({ id: 2 })])
    render(<MemoryRouter><AlertBell /><AlertsPage /></MemoryRouter>)
    expect(await screen.findByTestId('unread-count')).toHaveTextContent('2')
    expect(screen.getByRole('link', { name: 'Alerts: 2 unread' })).toHaveAttribute('href', '/alerts')
    const item = await screen.findByTestId('alert-1')
    await user.click(within(item).getByRole('button', { name: 'Acknowledge' }))
    await waitFor(() => expect(screen.getByTestId('unread-count')).toHaveTextContent('1'))
    await waitFor(() => expect(within(screen.getByTestId('alert-1')).getByText(/Acknowledged 2 Nov 2026, 15:30/)).toBeInTheDocument())
  })

  it("offers no button on someone else's alert", async () => {
    fakeApi([row({ can_acknowledge: false })])
    render(<AlertsPage />)
    const item = await screen.findByTestId('alert-1')
    expect(within(item).queryByRole('button')).not.toBeInTheDocument()
    expect(item).toHaveTextContent('Not acknowledged')
  })

  it('searches on the server', async () => {
    const user = userEvent.setup()
    const paths = fakeApi([row(), row({ id: 2, recipient: 'Ben Kariuki' })])
    render(<AlertsPage />)
    await screen.findByTestId('alert-2')
    await user.type(screen.getByRole('searchbox', { name: 'Search alerts' }), 'ben')
    await waitFor(() => expect(screen.queryByTestId('alert-1')).not.toBeInTheDocument())
    expect(paths.some((path) => path.includes('q=ben'))).toBe(true)
    await user.clear(screen.getByRole('searchbox', { name: 'Search alerts' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search alerts' }), 'nobody')
    expect(await screen.findByText('No alerts match that search.')).toBeInTheDocument()
  })

  it('explains an empty list', async () => {
    fakeApi([])
    render(<AlertsPage />)
    expect(await screen.findByText(/raised when the prediction reaches Medium or High/)).toBeInTheDocument()
  })

  it('hides the count when nothing is unread', async () => {
    fakeApi([])
    render(<MemoryRouter><AlertBell /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: 'Alerts: none unread' })).toBeInTheDocument()
    expect(screen.queryByTestId('unread-count')).not.toBeInTheDocument()
  })
})

describe('Dashboard alert banner', () => {
  const live = (alert: LiveCurrent['alert']): LiveCurrent => ({
    freshness: 'Live',
    thresholds: [{ below_mm: 2.5, label: 'low' }, { below_mm: 7.6, label: 'moderate' }],
    highest_risk: 'high',
    thresholds_overridden: false,
    source_note: 'x',
    timezone: 'Africa/Nairobi',
    last_error: null,
    last_updated: '2026-11-02T15:02:00',
    target_time: '2026-11-02T16:00:00',
    predicted_mm: 0.5,
    risk_level: 'low',
    window: [],
    forecast: [],
    alert,
  })

  function renderDashboard(alert: LiveCurrent['alert']) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(live(alert)))))
    render(<MemoryRouter><DashboardPage /></MemoryRouter>)
  }

  it('says when an alert was sent, to whom, and links to Alerts', async () => {
    renderDashboard({ at: '2026-11-02T15:02:00', risk_level: 'moderate', predicted_mm: 4.03, target_time: '2026-11-02T16:00:00', recipients: 3, emails_sent: 2 })
    const banner = await screen.findByTestId('alert-banner')
    expect(banner).toHaveTextContent('Medium alert raised 2 Nov 2026, 15:02')
    expect(banner).toHaveTextContent('3 recipients, 2 emails sent')
    expect(within(banner).getByRole('link', { name: 'View alerts' })).toHaveAttribute('href', '/alerts')
  })

  it('shows nothing when there is no recent alert', async () => {
    renderDashboard(null)
    await screen.findByTestId('risk-banner')
    expect(screen.queryByTestId('alert-banner')).not.toBeInTheDocument()
  })
})
