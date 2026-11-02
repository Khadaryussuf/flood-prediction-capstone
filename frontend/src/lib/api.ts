// All calls go to the same server that serves the page (Flask), so the
// paths are relative to the site root. In `npm run dev`, Vite forwards
// them to Flask (see vite.config.ts).
import type { Comparison, Health, LiveCurrent, Meta, Prediction, Reading, ReplayWindow, StoredPrediction } from './types'

/** The session's CSRF token, sent on every request that changes something. */
let csrfToken = ''
export const setCsrfToken = (token: string) => {
  csrfToken = token
}

export class ApiError extends Error {
  status: number
  code?: string
  /** The server's own message, without the request path, for showing to people */
  detail: string
  constructor(path: string, status: number, detail: string, code?: string) {
    super(`${path}: ${status} ${detail}`)
    this.status = status
    this.code = code
    this.detail = detail
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? 'GET'
  const send = method === 'GET' ? init : { ...init, headers: { ...init?.headers, 'X-CSRF-Token': csrfToken } }
  const response = await fetch(path, send)
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = body && typeof body.error === 'string' ? body.error : response.statusText
    // The session ended (expired, logged out elsewhere, account disabled)
    if (response.status === 401 && !path.startsWith('/api/auth/')) {
      window.dispatchEvent(new Event('floodwatch:session-ended'))
    }
    throw new ApiError(path, response.status, detail, body?.code)
  }
  return body as T
}

export const postJson = <T>(path: string, body: unknown, method = 'POST') =>
  request<T>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

export const getHealth = () => request<Health>('/health')

export const getMeta = () => request<Meta>('/api/meta')

export const getLive = () => request<LiveCurrent>('/api/live/current')

export const getReplay = (index: number) => request<ReplayWindow>(`/api/replay/${index}`)

export const getComparison = () => request<Comparison>('/api/comparison')

/** The 20 most recent stored predictions, newest first */
export const getPredictions = () => request<StoredPrediction[]>('/predictions')

/** Runs the served model on one window. The backend stores each call,
 *  so every replay step also appears in /predictions. */
export const predict = (readings: Reading[]) =>
  postJson<Prediction>('/predict', { readings })
