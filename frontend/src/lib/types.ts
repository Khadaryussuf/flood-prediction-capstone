// Shapes of the JSON returned by the Flask API (backend/app.py)

export type Role = 'responder' | 'admin'
export type AccountStatus = 'pending' | 'active' | 'rejected' | 'disabled'

/** An account, as the API shows it. It never includes the password. */
export interface User {
  id: number
  name: string
  email: string
  organisation: string
  role: Role
  status: AccountStatus
  created_at: string
  last_login_at: string | null
}

export type Freshness = 'Live' | 'Stale' | 'Fallback' | 'Unavailable'

/** GET /api/live/current */
export interface LiveCurrent {
  freshness: Freshness
  thresholds: { below_mm: number; label: string }[]
  highest_risk: string
  thresholds_overridden: boolean
  source_note: string
  timezone: string
  last_error: string | null
  last_updated: string | null
  target_time: string | null
  predicted_mm: number | null
  risk_level: string | null
  window: ({ time: string } & Reading)[]
  forecast: { time: string; precipitation: number }[]
}

/** GET /api/map/forecast: weather forecast, not model risk */
export interface MapForecast {
  available: boolean
  stale?: boolean
  label: string
  times: string[]
  now_index: number
  centre: { lat: number; lon: number }
  peak: { hours: number; mm: number; time: string } | null
  grid: { lat: number; lon: number; rain: number[] }[]
  cell: { lat: number; lon: number }
  zones: { name: string; lat: number; lon: number; rain: number[] }[]
}

/** One row of GET /api/admin/audit */
export interface AuditEntry {
  id: number
  at: string
  actor: string
  action: string
  target: string
  detail: string
}

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

/** One row of GET /predictions */
export interface StoredPrediction {
  id: number
  created_at: string
  input: Reading[]
  predicted_mm: number
  risk_level: string
}

/** One model in GET /api/comparison. The seed values are null for ARIMA and
 *  Persistence, which are single runs. */
export interface ComparisonModel {
  model: string
  run: string
  is_baseline: boolean
  selected: boolean
  val_rmse_mm: number
  val_mae_mm: number
  val_heavy_hit: number
  val_heavy_actual: number
  test_rmse_mm: number
  test_mae_mm: number
  test_r2: number
  test_heavy_hit: number
  test_heavy_actual: number
  test_heavy_recall: number
  test_max_pred_mm: number
  test_max_actual_mm: number
  seeds: {
    n_seeds: number
    seed_list: number[]
    mean: { val_rmse_mm: number; test_rmse_mm: number; test_heavy_hit: number }
    sd: { val_rmse_mm: number; test_rmse_mm: number; test_heavy_hit: number }
  } | null
}

/** GET /api/comparison */
export interface Comparison {
  selection_rule: string
  heavy_rain_mm: number
  sources: string[]
  models: ComparisonModel[]
}

/** POST /predict */
export interface Prediction {
  id: number
  predicted_mm: number
  risk_level: string
  thresholds: string
}
