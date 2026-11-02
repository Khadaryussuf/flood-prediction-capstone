// All calls go to the same server that serves the page (Flask), so the
// paths are relative to the site root. In `npm run dev`, Vite forwards
// them to Flask (see vite.config.ts).
import type { Health, Meta, Prediction, Reading, ReplayWindow } from './types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const message = body && typeof body.error === 'string' ? body.error : response.statusText
    throw new Error(`${path}: ${response.status} ${message}`)
  }
  return body as T
}

export const getHealth = () => request<Health>('/health')

export const getMeta = () => request<Meta>('/api/meta')

export const getReplay = (index: number) => request<ReplayWindow>(`/api/replay/${index}`)

/** Runs the served model on one window. The backend stores each call,
 *  so every replay step also appears in /predictions. */
export const predict = (readings: Reading[]) =>
  request<Prediction>('/predict', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ readings }),
  })
