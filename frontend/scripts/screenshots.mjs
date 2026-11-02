// Dev-only visual check: 6 screenshots of the running dashboard, at three
// widths in both themes. Start Flask first (python -m backend.app), then:
//   node scripts/screenshots.mjs <label>      e.g.  node scripts/screenshots.mjs 1b
// Writes frontend/screenshots/<label>/<width>-<theme>.png (git-ignored).
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const BASE = process.env.DASHBOARD_URL ?? 'http://127.0.0.1:5000'
const label = process.argv[2] ?? 'latest'
const outDir = new URL(`../screenshots/${label}/`, import.meta.url)
mkdirSync(outDir, { recursive: true })

// Show the wettest hour of the test period, a demanding case for the page
const meta = await (await fetch(`${BASE}/api/meta`)).json()
const windowNumber = meta.wettest[0].index + 1 // the page's ?window= is 1-based

// channel 'chromium' is the full browser, still headless. It avoids needing
// Playwright's separate headless-shell download.
const browser = await chromium.launch({ channel: 'chromium' })
try {
  for (const width of [360, 768, 1280]) {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: theme })
      await page.goto(`${BASE}/dashboard?window=${windowNumber}`)
      await page.getByTestId('predicted-mm').waitFor()
      await page.waitForTimeout(900) // let the gauge needle finish moving

      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
      const file = fileURLToPath(new URL(`${width}-${theme}.png`, outDir))
      await page.screenshot({ path: file, fullPage: true })
      console.log(`${width}px ${theme}: saved, horizontal overflow ${scrollWidth > width ? `YES (${scrollWidth}px)` : 'none'}`)
      await page.close()
    }
  }
} finally {
  await browser.close()
}
