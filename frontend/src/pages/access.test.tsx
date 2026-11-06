import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import App from '@/App'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AuthProvider } from '@/lib/auth'
import { DISCLAIMER } from '@/lib/copy'
import type { User } from '@/lib/types'

const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 1,
  name: 'Asha Admin',
  email: 'asha@example.org',
  organisation: 'County',
  role: 'admin',
  status: 'active',
  created_at: '2026-11-01T08:00:00',
  last_login_at: null,
  ...overrides,
})

type Handler = (init?: RequestInit) => [number, unknown]

/** A fake server: path -> handler. Unknown paths get a 404. */
function fakeServer(user: User | null, routes: Record<string, Handler> = {}) {
  const calls: { path: string; init?: RequestInit }[] = []
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, init })
    const handler = path === '/api/auth/session'
      ? (() => [200, { user, csrf_token: 'token-1' }]) as Handler
      : routes[path]
    const [status, body] = handler ? handler(init) : [404, { error: 'not found' }]
    return new Response(JSON.stringify(body), { status })
  }))
  return calls
}

function renderAt(path: string) {
  return render(
    <TooltipProvider>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    </TooltipProvider>,
  )
}

describe('access', () => {
  it('sends anyone not logged in to the login page, which shows no risk and so no disclaimer strip', async () => {
    fakeServer(null)
    renderAt('/dashboard')
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(screen.queryByRole('note', { name: 'Disclaimer' })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'About FloodWatch' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Change theme/ })).toBeInTheDocument()
  })

  it('keeps the disclaimer strip on pages that show risk', async () => {
    fakeServer(makeUser({ role: 'responder' }))
    renderAt('/dashboard')
    expect(await screen.findByRole('note', { name: 'Disclaimer' })).toHaveTextContent(DISCLAIMER)
  })

  it('has no disclaimer strip on the sign-up page either', async () => {
    fakeServer(null)
    renderAt('/signup')
    expect(await screen.findByRole('heading', { name: 'Request an account' })).toBeInTheDocument()
    expect(screen.queryByRole('note', { name: 'Disclaimer' })).not.toBeInTheDocument()
  })

  it('shows and hides the password', async () => {
    const user = userEvent.setup()
    fakeServer(null)
    renderAt('/login')
    const field = await screen.findByLabelText('Password')
    expect(field).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(field).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(field).toHaveAttribute('type', 'password')
  })

  it('gives a pending account its own clear title', async () => {
    const user = userEvent.setup()
    fakeServer(null, { '/api/auth/login': () => [403, { error: 'Your account is awaiting approval by an administrator.', code: 'awaiting_approval' }] })
    renderAt('/login')
    await user.type(await screen.findByLabelText('Email'), 'a@example.org')
    await user.type(screen.getByLabelText('Password'), 'some-long-enough')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Not approved yet')
  })

  it('puts sign-up errors by the field they are about', async () => {
    const user = userEvent.setup()
    const calls = fakeServer(null, { '/api/auth/signup': () => [409, { error: 'That email is already registered.' }] })
    renderAt('/signup')
    await user.type(await screen.findByLabelText('Name'), 'Ben')
    await user.type(screen.getByLabelText('Email'), 'b@example.org')
    await user.type(screen.getByLabelText('Organisation'), 'Red Cross')
    await user.type(screen.getByLabelText('Password'), 'long-enough-value')
    await user.type(screen.getByLabelText('Confirm password'), 'long-enough-value')
    await user.click(screen.getByRole('button', { name: 'Request account' }))
    await screen.findByRole('alert')
    const email = screen.getByLabelText('Email')
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveAccessibleDescription('That email is already registered.')
    expect(calls.some((call) => call.path === '/api/auth/signup')).toBe(true)
  })

  it('shows the server message on a failed login and clears the password', async () => {
    const user = userEvent.setup()
    fakeServer(null, { '/api/auth/login': () => [401, { error: 'Incorrect email or password.' }] })
    renderAt('/login')
    await user.type(await screen.findByLabelText('Email'), 'a@example.org')
    await user.type(screen.getByLabelText('Password'), 'not-the-right-one')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.')
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })

  it('shows "awaiting approval" for a pending account', async () => {
    const user = userEvent.setup()
    fakeServer(null, { '/api/auth/login': () => [403, { error: 'Your account is awaiting approval by an administrator.' }] })
    renderAt('/login')
    await user.type(await screen.findByLabelText('Email'), 'a@example.org')
    await user.type(screen.getByLabelText('Password'), 'some-long-enough')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('awaiting approval')
  })

  it('sends the CSRF token with login, and login and sign-up link to each other', async () => {
    const user = userEvent.setup()
    const calls = fakeServer(null, { '/api/auth/login': () => [401, { error: 'no' }] })
    renderAt('/login')
    await user.type(await screen.findByLabelText('Email'), 'a@example.org')
    await user.type(screen.getByLabelText('Password'), 'some-long-enough')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    await screen.findByRole('alert')
    const login = calls.find((call) => call.path === '/api/auth/login')
    expect(new Headers(login?.init?.headers).get('X-CSRF-Token')).toBe('token-1')

    await user.click(screen.getByRole('link', { name: 'Request one' }))
    expect(await screen.findByRole('heading', { name: 'Request an account' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Log in' })).toBeInTheDocument()
  })

  it('signs up with no role field, and says the account needs approval', async () => {
    const user = userEvent.setup()
    const calls = fakeServer(null, { '/api/auth/signup': () => [201, { status: 'pending' }] })
    renderAt('/signup')
    await user.type(await screen.findByLabelText('Name'), 'Ben')
    await user.type(screen.getByLabelText('Email'), 'b@example.org')
    await user.type(screen.getByLabelText('Organisation'), 'Red Cross')
    await user.type(screen.getByLabelText('Password'), 'long-enough-value')
    await user.type(screen.getByLabelText('Confirm password'), 'long-enough-value')
    await user.click(screen.getByRole('button', { name: 'Request account' }))
    expect(await screen.findByText('Awaiting approval')).toBeInTheDocument()
    const sent = JSON.parse(String(calls.find((call) => call.path === '/api/auth/signup')?.init?.body))
    expect(sent).not.toHaveProperty('role')
  })

  it('catches mismatched passwords before sending anything', async () => {
    const user = userEvent.setup()
    const calls = fakeServer(null)
    renderAt('/signup')
    await user.type(await screen.findByLabelText('Name'), 'Ben')
    await user.type(screen.getByLabelText('Email'), 'b@example.org')
    await user.type(screen.getByLabelText('Organisation'), 'Red Cross')
    await user.type(screen.getByLabelText('Password'), 'long-enough-value')
    await user.type(screen.getByLabelText('Confirm password'), 'different-value')
    await user.click(screen.getByRole('button', { name: 'Request account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("don't match")
    expect(calls.some((call) => call.path === '/api/auth/signup')).toBe(false)
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('aria-invalid', 'true')
  })

  it('hides Settings from a responder, and tells them they have no access if they open it', async () => {
    const calls = fakeServer(makeUser({ role: 'responder', name: 'Rita' }))
    renderAt('/settings')
    expect(await screen.findByRole('heading', { name: "You don't have access" })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Model evidence' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the Dashboard' })).toHaveAttribute('href', '/dashboard')
    // Nothing administrator-only was even asked for
    expect(calls.some((call) => call.path.startsWith('/api/admin'))).toBe(false)
  })

  it('shows a not-found page inside the app for an unknown address', async () => {
    fakeServer(makeUser({ role: 'responder' }))
    renderAt('/no-such-page')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })

  it('sends someone not logged in from an unknown address to the login page', async () => {
    fakeServer(null)
    renderAt('/no-such-page')
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
  })

  it('lets an administrator approve a pending account', async () => {
    const user = userEvent.setup()
    const pending = makeUser({ id: 2, name: 'Pat', email: 'pat@example.org', role: 'responder', status: 'pending' })
    let listed = [makeUser(), pending]
    const calls = fakeServer(makeUser(), {
      '/api/admin/users': () => [200, listed],
      '/api/admin/users/2': (init) => {
        expect(JSON.parse(String(init?.body)).action).toBe('approve')
        listed = [makeUser(), { ...pending, status: 'active' }]
        return [200, listed[1]]
      },
    })
    renderAt('/settings')
    const row = await screen.findByTestId('user-pat@example.org')
    expect(within(row).getByText('Pending approval')).toBeInTheDocument()
    await user.click(within(row).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(within(screen.getByTestId('user-pat@example.org')).getByText('Active')).toBeInTheDocument())
    const patch = calls.find((call) => call.init?.method === 'PATCH')
    expect(new Headers(patch?.init?.headers).get('X-CSRF-Token')).toBe('token-1')
  })

  it("doesn't offer an administrator ways to remove themselves, and shows a server refusal", async () => {
    const user = userEvent.setup()
    fakeServer(makeUser(), {
      '/api/admin/users': () => [200, [makeUser(), makeUser({ id: 3, name: 'Other', email: 'o@example.org' })]],
      '/api/admin/users/3': () => [409, { error: 'This is the last active administrator.' }],
    })
    renderAt('/settings')
    const self = await screen.findByTestId('user-asha@example.org')
    expect(within(self).queryByRole('button', { name: 'Disable' })).not.toBeInTheDocument()
    expect(within(self).getByRole('combobox')).toBeDisabled()
    await user.click(within(screen.getByTestId('user-o@example.org')).getByRole('button', { name: 'Disable' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('last active administrator')
  })
})
