// Shapes of the JSON returned by the Flask API (backend/app.py)

export type Feature =
  | 'precipitation'
  | 'temperature_2m'
  | 'relative_humidity_2m'
  | 'surface_pressure'
  | 'wind_speed_10m'

export type Reading = Record<Feature, number>

/** GET /health */
export interface Health {
  status: string
  model: string
  model_file: string
}

/** GET /api/meta */
export interface Meta {
  disclaimer: string
  data_label: string
  timezone: string
  thresholds: { below_mm: number; label: string }[]
  highest_risk: string
  test_period: { start: string; end: string }
  window_hours: number
  window_count: number
  wettest: { index: number; actual_mm: number; target_time: string }[]
}

/** GET /api/replay/<index> */
export interface ReplayWindow {
  index: number
  window_count: number
  window_start: string
  window_end: string
  target_time: string
  times: string[]
  readings: Reading[]
  actual_next_mm: number
}

/** POST /predict */
export interface Prediction {
  id: number
  predicted_mm: number
  risk_level: string
  thresholds: string
}
