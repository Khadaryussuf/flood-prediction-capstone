import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import App from './App'
import { ThemeProvider } from '@/components/theme-provider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DISCLAIMER } from '@/lib/copy'
import { fixtures, mockApi, mockApiDown } from '@/test/mockApi'

function renderApp() {
  return render(
    <ThemeProvider>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </ThemeProvider>,
  )
}

beforeEach(() => {
  window.history.replaceState(null, '', '/dashboard')
})

describe('App', () => {
  it('shows the disclaimer word for word even when the API is down', async () => {
    mockApiDown()
    renderApp()
    expect(screen.getByRole('note', { name: 'Disclaimer' })).toHaveTextContent(DISCLAIMER)
    expect(DISCLAIMER).toBe(fixtures.meta.disclaimer) // same text as the backend
    expect(await screen.findByText("Can't reach the prediction API")).toBeInTheDocument()
  })

  it('shows the serving model from /health and the prediction for the first hour', async () => {
    const calls = mockApi()
    renderApp()

    expect(await screen.findByTestId('predicted-mm')).toHaveTextContent('0.06')
    expect(screen.getByTestId('served-model')).toHaveTextContent('cnn_lstm (cnn_lstm_model.keras)')
    expect(screen.getAllByText('Low intensity').length).toBeGreaterThan(0)
    expect(screen.getByText('0.0570 mm')).toBeInTheDocument()
    expect(screen.getAllByText(/3 Apr 2025, 02:00/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Replay of held-out test period \(not live\)/)).toBeInTheDocument()

    // The replayed window goes through /predict, so the backend stores it
    const posts = calls.filter((c) => c.path === '/predict')
    expect(posts).toHaveLength(1)
    expect(posts[0].body).toEqual({ readings: fixtures.replay0.readings })
  })

  it('steps to the next hour and predicts it through /predict', async () => {
    const calls = mockApi()
    const user = userEvent.setup()
    renderApp()

    await screen.findByTestId('predicted-mm')
    expect(screen.getByRole('button', { name: 'Previous hour' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Next hour' }))

    await waitFor(() => expect(screen.getByText('0.0576 mm')).toBeInTheDocument())
    expect(calls.some((c) => c.path === '/api/replay/1')).toBe(true)
    const posts = calls.filter((c) => c.path === '/predict')
    expect(posts.at(-1)?.body).toEqual({ readings: fixtures.replay1.readings })
    expect(window.location.search).toBe('?window=2')
    expect(screen.getByRole('textbox', { name: /Window number/ })).toHaveValue('2')
  })
})
