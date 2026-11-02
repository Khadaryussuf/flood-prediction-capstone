# FloodWatch frontend

The source of the FloodWatch web app served by Flask. It is built with Vite, React,
TypeScript, Tailwind CSS, shadcn/ui, React Router and Leaflet.

You don't need Node to run the app: the built page is committed in
`backend/static/app/`. You need Node 24 or newer only to change it.

## Commands

Run these in this folder:

```
npm ci               # install the exact locked versions
npm run dev          # dev server; forwards API calls to Flask on port 5000
npm run build        # type-check, then write the page to ../backend/static/app
npm test             # Vitest
npm run contrast     # check the colour pairs against WCAG contrast ratios
npm run third-party  # regenerate ../THIRD_PARTY.md from the lockfile
```

After changing anything here, run `npm run build` and commit
`backend/static/app/`, because that copy is what Flask serves. After changing
dependencies, also run `npm run third-party`.

## Screenshots

`scripts/screenshots.mjs` is a development-only visual check. It takes the pages
you name at 360 and 1280 px in both themes, and fails on horizontal overflow, a
collapsed map, or a browser console error. Images go to the git-ignored
`screenshots/` folder.

Some pages store predictions, so point Flask at a scratch database. From the repo
root, in PowerShell, with an account in that database:

```
$env:DATABASE_URL = "sqlite:///C:/path/to/scratch.db"
python -m backend.app
```

Set `FW_EMAIL` and `FW_PASSWORD` for the account the script should log in with.

Then, in this folder, the first time only:

```
npx playwright install chromium
```

And to take the screenshots:

```
node scripts/screenshots.mjs <label> /login /dashboard /alerts
```

## Where things are

- `src/App.tsx`: the routes and who can see them
- `src/pages/`: one file per screen
- `src/components/shell/`: sidebar and top bar
- `src/components/map/`: the Nairobi map
- `src/components/dashboard/`: risk badge, gauge and the Model evidence panels
- `src/components/ui/`: components copied from shadcn/ui
- `src/lib/`: API calls, response types, formatting, computed findings, fixed wording
- `src/test/`: test setup and real API responses used as fixtures

Numbers on the page come from the Flask API, and the risk class and thresholds
are never worked out here. The server enforces who can do what; hiding a link here
is only a convenience. The disclaimer is also kept in `src/lib/copy.ts`, so
it still shows when the API can't be reached.
