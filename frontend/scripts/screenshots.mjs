// Dev-only visual check of the running dashboard. Start Flask first
// (python -m backend.app, ideally with DATABASE_URL on a scratch database,
// because each page load stores a prediction), then:
//   node scripts/screenshots.mjs <label>      e.g.  node scripts/screenshots.mjs 1c
// Writes frontend/screenshots/<label>/ (git-ignored): the wettest hour at three
// widths in both themes, plus a Moderate hour at 1280 px in both themes.
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const BASE = process.env.DASHBOARD_URL ?? 'http://127.0.0.1:5000'
const label = process.argv[2] ?? 'latest'
const outDir = new URL(`../screenshots/${label}/`, import.meta.url)
mkdirSync(outDir, { recursive: true })

// The wettest hour of the test period, a demanding case for the page
const meta = await (await fetch(`${BASE}/api/meta`)).json()
const wettestWindow = meta.wettest[0].index + 1 // the page's ?window= is 1-based
// 12 May 2025, 17:00: predicted 4.03 mm, actual 3.8 mm, both Moderate
const MODERATE_WINDOW = 952

const SHOTS = [
  ...[360, 768, 1280].flatMap((width) =>
    ['light', 'dark'].map((theme) => ({ width, theme, window: wettestWindow, name: `${width}-${theme}` })),
  ),
  ...['light', 'dark'].map((theme) => ({
    width: 1280,
    theme,
    window: MODERATE_WINDOW,
    name: `moderate-1280-${theme}`,
    expectRisk: 'moderate',
  })),
]

// channel 'chromium' is the full browser, still headless. It avoids needing
// Playwright's separate headless-shell download.
const browser = await chromium.launch({ channel: 'chromium' })
try {
  for (const { width, theme, window, name, expectRisk } of SHOTS) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: theme })
    await page.goto(`${BASE}/dashboard?window=${window}`)
    await page.getByTestId('predicted-mm').waitFor()
    await page.getByTestId('comparison-table').waitFor()
    await page.getByTestId('latest-prediction').waitFor()
    await page.waitForTimeout(900) // let the gauge needle finish moving

    const risk = await page.getByTestId('hero-risk').locator('[data-risk]').getAttribute('data-risk')
    if (expectRisk && risk !== expectRisk) {
      throw new Error(`${name}: expected the ${expectRisk} class, the page shows ${risk}`)
    }

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, outDir)), fullPage: true })
    console.log(`${name}: saved, class ${risk}, horizontal overflow ${scrollWidth > width ? `YES (${scrollWidth}px)` : 'none'}`)
    if (scrollWidth > width) process.exitCode = 1
    await page.close()
  }
} finally {
  await browser.close()
}
