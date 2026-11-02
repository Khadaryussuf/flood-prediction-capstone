// Dev-only visual check of the running app, at 360 and 1280 px in both themes.
// Start Flask first, on a scratch DATABASE_URL (the Evidence and Demo pages store
// predictions), then:
//   node scripts/screenshots.mjs <label> /login /settings ...
// Pages other than /login and /signup log in first, using the FW_EMAIL and
// FW_PASSWORD environment variables. A path may end in ?query. Writes
// frontend/screenshots/<label>/ (git-ignored). Fails on horizontal overflow and
// on browser console errors.
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const BASE = process.env.DASHBOARD_URL ?? 'http://127.0.0.1:5000'
const [label = 'latest', ...paths] = process.argv.slice(2)
const outDir = new URL(`../screenshots/${label}/`, import.meta.url)
mkdirSync(outDir, { recursive: true })
const PUBLIC = new Set(['/login', '/signup'])

// channel 'chromium' is the full browser, still headless. It avoids needing
// Playwright's separate headless-shell download.
const browser = await chromium.launch({ channel: 'chromium' })
try {
  for (const path of paths) {
    for (const width of [360, 1280]) {
      for (const theme of ['light', 'dark']) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme })
        const page = await context.newPage()
        const errors = []
        page.on('pageerror', (error) => errors.push(error.message))
        page.on('console', (message) => {
          // Map tiles can be unreachable offline; that's not a page fault
          if (message.type() === 'error' && !message.text().includes('tile.openstreetmap')) errors.push(message.text())
        })

        if (!PUBLIC.has(path)) {
          await page.goto(`${BASE}/login`)
          await page.getByLabel('Email').fill(process.env.FW_EMAIL ?? '')
          await page.getByLabel('Password').fill(process.env.FW_PASSWORD ?? '')
          await page.getByRole('button', { name: 'Log in' }).click()
          await page.waitForURL('**/dashboard')
        }
        await page.goto(`${BASE}${path}`)
        await page.waitForLoadState('networkidle')
        await page.waitForTimeout(1000)

        const name = `${path.replace(/\W+/g, '-').replace(/^-|-$/g, '')}-${width}-${theme}`
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
        await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, outDir)), fullPage: true })
        // A map that collapses or never loads tiles passes every other check
        const map = page.locator('.leaflet-container')
        if (await map.count()) {
          const box = await map.boundingBox()
          const tiles = await page.locator('.leaflet-tile-loaded').count()
          console.log(`  map ${Math.round(box.width)}x${Math.round(box.height)}, ${tiles} tiles loaded`)
          if (box.height < 200) errors.push(`map collapsed to ${box.height}px`)
        }
        const overflow = scrollWidth > width
        console.log(`${name}: horizontal overflow ${overflow ? `YES (${scrollWidth}px)` : 'none'}, console errors ${errors.length ? errors.join(' | ') : 'none'}`)
        if (overflow || errors.length) process.exitCode = 1
        await context.close()
      }
    }
  }
} finally {
  await browser.close()
}
