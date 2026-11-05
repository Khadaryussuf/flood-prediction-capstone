import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { AuthContext } from '@/lib/auth'
import { DISCLAIMER, DISCLAIMER_OVERRIDDEN, THRESHOLDS_CHANGED } from '@/lib/copy'
import { formatHourRange } from '@/lib/format'
import { DisclaimerStrip } from './DisclaimerStrip'

function serveOverride(state: { overridden: boolean }) {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ disclaimer: '', thresholds_overridden: state.overridden }))))
}

const someone = { id: 1, name: 'A', email: 'a@example.org', organisation: '', role: 'responder', status: 'active', created_at: '', last_login_at: null } as const

const renderStrip = (loggedIn = true) => render(
  <AuthContext.Provider value={{ user: loggedIn ? someone : null, loading: false, login: async () => {}, logout: async () => {} }}>
    <MemoryRouter><DisclaimerStrip /></MemoryRouter>
  </AuthContext.Provider>,
)

describe('disclaimer strip', () => {
  it('names the AMS classes while the defaults are in use', async () => {
    serveOverride({ overridden: false })
    renderStrip()
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/disclaimer', undefined))
    expect(screen.getByRole('note', { name: 'Disclaimer' })).toHaveTextContent(DISCLAIMER)
  })

  it('says "administrator-set limits" when an administrator has overridden them', async () => {
    serveOverride({ overridden: true })
    renderStrip()
    expect(await screen.findByText(DISCLAIMER_OVERRIDDEN)).toBeInTheDocument()
    expect(DISCLAIMER_OVERRIDDEN).not.toContain('AMS')
  })

  it('updates as soon as the limits are saved or reset', async () => {
    const state = { overridden: false }
    serveOverride(state)
    renderStrip()
    await screen.findByText(DISCLAIMER)
    state.overridden = true
    act(() => { window.dispatchEvent(new Event(THRESHOLDS_CHANGED)) })
    expect(await screen.findByText(DISCLAIMER_OVERRIDDEN)).toBeInTheDocument()
  })

  it("doesn't ask the server before anyone has logged in", () => {
    serveOverride({ overridden: true })
    renderStrip(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.getByRole('note', { name: 'Disclaimer' })).toHaveTextContent(DISCLAIMER)
  })

  it('still shows the disclaimer when the server is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    renderStrip()
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.getByRole('note', { name: 'Disclaimer' })).toHaveTextContent(DISCLAIMER)
  })
})

describe('hour range', () => {
  it('names the hour that ends at the target time', () => {
    expect(formatHourRange('2026-11-03T22:00:00')).toBe('21:00 to 22:00, 3 Nov 2026')
  })
  it('dates an hour ending at midnight by its start', () => {
    expect(formatHourRange('2026-11-04T00:00:00')).toBe('23:00 to 00:00, 3 Nov 2026')
    expect(formatHourRange('2027-01-01T00:00:00')).toBe('23:00 to 00:00, 31 Dec 2026')
  })
})
