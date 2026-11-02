# FloodWatch build log

One line per module. Each entry passed pytest, Vitest, the build, screenshots at 360 and 1280 px in both themes opened by eye, and the 228-protected-file hash check before its local commit.

- **Module 1, auth, roles and sidebar shell:** sign-up with approval, server-side sessions, CSRF, lockout, admin Users and Activity tabs, sidebar shell; the analysis page moved to `/evidence`; RainViewer tested and dropped.
- **Module 2, live data, scheduler and Dashboard:** hourly Open-Meteo fetch in a background thread through the same prediction path as /predict, retries and fallback, 30-day backfill, risk banner, freshness chip, five readings and 24-hour rainfall chart. Real run: 0.02 mm, Low.
- **Module 3, map and layers:** Nairobi map with OpenStreetMap tiles, the model's risk marker for the one grid cell as a shape and text, forecast rainfall grid and three watch zones labelled as weather forecast, time slider, peak line. RainViewer stayed out, per its test in Module 1.
- **Module 4, alert engine, email and Alerts page:** in-app and email alerts on Medium or High, one row per recipient with delivery status, 3-hour cool-down that a rise in level can break, bell with unread count, Acknowledge and search, Dashboard banner. SMTP is exercised with a stand-in in the tests; no real email has been sent. Note: the first Module 3 commit was redone because it had picked up Module 4 files and a failing collection; the redone commit passed all 115 tests in a clean checkout.
