// Fixed wording. It lives here, not only in the API, so the disclaimer
// still shows when the API can't be reached. tests/test_dashboard.py
// checks the built page contains exactly the backend's two disclaimers.

export const DISCLAIMER =
  'Risk level is hourly rainfall intensity (AMS classes), not flood probability, and is not calibrated to Nairobi flood records.'

/** When an administrator has changed the limits, they are no longer the AMS classes */
export const DISCLAIMER_OVERRIDDEN =
  'Risk level is hourly rainfall intensity (administrator-set limits), not flood probability, and is not calibrated to Nairobi flood records.'

/** Sent after an administrator saves or resets the limits */
export const THRESHOLDS_CHANGED = 'floodwatch:thresholds-changed'

export const REPLAY_LABEL = 'Replay of held-out test period (not live)'

export const DEMO_LABEL = 'Demo mode: a replay of past test data, not live. It does not raise alerts.'
