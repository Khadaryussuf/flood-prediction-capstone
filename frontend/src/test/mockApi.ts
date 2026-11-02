// A fake fetch that answers like the Flask API. The fixtures are real
// responses captured from the app (see fixtures/), not made-up numbers.
import { vi } from 'vitest'

import comparison from './fixtures/comparison.json'
import health from './fixtures/health.json'
import meta from './fixtures/meta.json'
import predict0 from './fixtures/predict_0.json'
import predict1 from './fixtures/predict_1.json'
import predictions from './fixtures/predictions.json'
import replay0 from './fixtures/replay_0.json'
import replay1 from './fixtures/replay_1.json'

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

export interface MockApiCall {
  path: string
  method: string
  body?: unknown
}

/** Installs a fetch stub and returns the list of calls it receives. */
export function mockApi() {
  const calls: MockApiCall[] = []
  const replays: Record<string, typeof replay0> = { '0': replay0, '1': replay1 }

  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ path: input, method, body })

      if (input === '/health') return json(health)
      if (input === '/api/auth/session') return json({ user: null, csrf_token: 'test-token' })
      if (input === '/api/meta') return json(meta)
      if (input === '/api/comparison') return json(comparison)
      if (input === '/predictions') return json(predictions)
      const replay = input.match(/^\/api\/replay\/(\d+)$/)
      if (replay) return replays[replay[1]] ? json(replays[replay[1]]) : json({ error: 'not in fixtures' }, 400)
      if (input === '/predict' && method === 'POST') {
        // Answer with the prediction for whichever fixture window was sent
        const sent = JSON.stringify(body.readings)
        return json(sent === JSON.stringify(replay1.readings) ? predict1 : predict0)
      }
      return json({ error: 'unexpected call' }, 404)
    }),
  )
  return calls
}

/** A fetch stub where every call fails, as when the server is down. */
export function mockApiDown() {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
}

export const fixtures = { comparison, health, meta, predict0, predict1, predictions, replay0, replay1 }
