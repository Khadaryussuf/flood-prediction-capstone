# FloodWatch build log

One line per module. Each entry passed pytest, Vitest, the build, screenshots at 360 and 1280 px in both themes opened by eye, and the 228-protected-file hash check before its local commit.

- **Module 1, auth, roles and sidebar shell:** sign-up with approval, server-side sessions, CSRF, lockout, admin Users and Activity tabs, sidebar shell; the analysis page moved to `/evidence`; RainViewer tested and dropped.
- **Module 2, live data, scheduler and Dashboard:** hourly Open-Meteo fetch in a background thread through the same prediction path as /predict, retries and fallback, 30-day backfill, risk banner, freshness chip, five readings and 24-hour rainfall chart. Real run: 0.02 mm, Low.
