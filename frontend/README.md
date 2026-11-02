# Dashboard frontend

The source of the dashboard served by Flask at `/dashboard`. It is built with
Vite, React, TypeScript, Tailwind CSS and shadcn/ui.

You don't need Node to run the dashboard: the built page is committed in
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

`scripts/screenshots.mjs` is a development-only visual check. It takes the
wettest test hour at 360, 768 and 1280 px in both themes, plus a Moderate hour
at 1280 px in both themes, and fails on horizontal overflow. Images go to the
git-ignored `screenshots/` folder.

Each page load stores a prediction, so point Flask at a scratch database. From
the repo root, in PowerShell:

```
$env:DATABASE_URL = "sqlite:///C:/path/to/scratch.db"
python -m backend.app
```

Then, in this folder, the first time only:

```
npx playwright install chromium
```

And to take the screenshots:

```
node scripts/screenshots.mjs <label>
```

## Where things are

- `src/App.tsx`: page state and layout
- `src/components/dashboard/`: the panels
- `src/components/ui/`: components copied from shadcn/ui
- `src/lib/`: API calls, response types, formatting, computed findings, fixed wording
- `src/test/`: test setup and real API responses used as fixtures

Numbers on the page come from the Flask API, and the risk class and thresholds
are never worked out here. The disclaimer is also kept in `src/lib/copy.ts`, so
it still shows when the API can't be reached.
