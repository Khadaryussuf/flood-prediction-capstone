import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import App from '@/App'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/lib/auth'

function serveSession(google: boolean | undefined) {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    if (path === '/api/auth/session') {
      const providers = google === undefined ? undefined : { google }
      return new Response(JSON.stringify({ user: null, csrf_token: 't', providers }))
    }
    return new Response('{}', { status: 404 })
  }))
}

const renderAt = (path: string) => render(
  <TooltipProvider>
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider><App /></AuthProvider>
    </MemoryRouter>
  </TooltipProvider>,
)

describe('Continue with Google', () => {
  it.each(['/login', '/signup'])('shows on %s when the server has Google set up, as a link to the server', async (path) => {
    serveSession(true)
    renderAt(path)
    const link = await screen.findByRole('link', { name: 'Continue with Google' })
    expect(link).toHaveAttribute('href', '/api/auth/google/login')
  })

  it.each([false, undefined])('is hidden when Google is not set up (providers: %s)', async (google) => {
    serveSession(google)
    renderAt('/login')
    await screen.findByRole('heading', { name: 'Log in' })
    expect(screen.queryByRole('link', { name: 'Continue with Google' })).not.toBeInTheDocument()
  })

  it('explains a refused Google sign-in', async () => {
    serveSession(true)
    renderAt('/login?google=google_unverified')
    expect(await screen.findByRole('alert')).toHaveTextContent("Google hasn't verified that email")
  })

  it('tells a new Google user their account awaits approval', async () => {
    serveSession(true)
    renderAt('/login?google=google_pending')
    expect(await screen.findByRole('status')).toHaveTextContent('Awaiting approval')
  })

  it('ignores an unknown result code', async () => {
    serveSession(true)
    renderAt('/login?google=<script>')
    await screen.findByRole('heading', { name: 'Log in' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
