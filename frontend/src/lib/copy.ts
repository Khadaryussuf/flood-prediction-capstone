// Fixed wording. It lives here, not only in the API, so the disclaimer
// still shows when the API can't be reached. tests/test_dashboard.py
// checks the built page contains exactly the backend's DISCLAIMER.

export const DISCLAIMER =
  'Risk level is hourly rainfall intensity (AMS classes), not flood probability, and is not calibrated to Nairobi flood records.'

export const REPLAY_LABEL = 'Replay of held-out test period (not live)'
