# Deviations from the approved proposal and Chapter 4

Every change from the approved proposal and Chapter 4, with the reason. For the
proposal revision and the supervisor.

| Area | Approved | Built | Reason |
|---|---|---|---|
| Registration | No self-registration; admins create accounts | Sign-up added, creating a pending Responder that an administrator must approve. Administrators can still add accounts directly | Requested during the build. Nobody gains access without approval, and the role is never taken from the request |
| Risk thresholds | 10 and 50 mm | Hourly 2.5 and 7.6 mm by default, from the American Meteorological Society's rain intensity classes (`pipeline/config.py`). Administrators can override them in the database | The model predicts hourly rainfall, and the test period's wettest hour was 9.3 mm, so the original values would almost never trigger. The classes are not calibrated to Nairobi flood records, and the page says so |
| Weather source | OpenWeatherMap | Open-Meteo: historical archive (ERA5) for training, forecast API for live data | Free, no API key, and provides the same variables as the training data. Live inputs still differ from ERA5, and the dashboard says so |
| Alerts | SMS through Twilio | Email and in-app | No paid SMS service or credentials are needed. Each recipient's delivery status is recorded, including when email isn't configured |
| Database | PostgreSQL | SQLite | Enough for a single-server capstone. The code reads `DATABASE_URL`, so changing later needs a different URL and driver |
| Risk label | Not specified | The screens show "Medium" for the API value `moderate` | Requested for responders. API values are unchanged |
| Radar layer | RainViewer radar on the map, if it shows rain over Nairobi | Dropped | Tested on 2 November 2026: all 13 frames (2 hours) had 0 pixels of data on the Nairobi tile at zoom 6 and 7, while a control tile over Germany had data. This can't separate "no radar here" from "no rain at that time", so it should be re-tested during rain if the layer is wanted |
| Session endpoint | Only `/health`, sign-up and login are open | `GET /api/auth/session` is also open | Login and sign-up need a CSRF token before a session exists. It returns only that token and whether you're logged in |
| Alert recipients | Responders receive alert emails | Every active account gets a row and an email, including administrators | So an alert still reaches someone if there are no responders, and administrators see the same bell count |
| History before first run | Not specified | The first run fills about 30 days by running the model on past forecast data, marked "backfill". These hours never raise alerts | So Historical Trends and the threshold preview work from day one |
| Google sign-in | Email and password only | "Continue with Google" on the login and sign-up pages, through server-side OpenID Connect (Authlib 1.9.5). It appears only when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set. A new Google user becomes a pending Responder; an existing account is matched on Google-verified email only and keeps its own role and status | Requested during the build. Approval still gates every new account, and the role never comes from Google. Not tried against Google's real servers: no OAuth client was available, so the flow is tested with stand-ins for Google's answers |
| Apple sign-in | Not specified | Not added | Requested only as Google. Sign in with Apple needs a paid Apple Developer account and a hosted domain for its return address, which a local capstone server doesn't have |
| Missed hours | Not specified | When the hourly run missed hours (the computer slept or the server was off), the next run predicts them from the forecast API's past data, marked "backfill". They never raise alerts. Gaps older than 31 days, or hours without 24 complete hours of inputs, are left empty | Seen on 3 Nov 2026 (19:00 and 20:00 missing). Alerting for an hour that is already over would only mislead |
| Sidebar | Five items | The five items, plus Demo mode set apart at the bottom | Demo mode needed a home and shouldn't look like a live screen |
