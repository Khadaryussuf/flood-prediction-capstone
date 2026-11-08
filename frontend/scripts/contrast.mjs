// Checks the colour pairs in src/index.css against WCAG 2 contrast ratios,
// in both themes. Run with: npm run contrast  (exits 1 if any pair fails)
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')

/** The hex custom properties in one CSS block, e.g. ":root" or ".dark" */
function tokens(selector) {
  const start = css.indexOf(`${selector} {`)
  const block = css.slice(start, css.indexOf('}', start))
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]))
}

// WCAG 2 relative luminance and contrast ratio
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** a with t of b mixed in, like CSS color-mix(in srgb, a, b t) */
function mix(a, b, t) {
  const channel = (hex, i) => parseInt(hex.slice(i, i + 2), 16)
  return '#' + [1, 3, 5].map((i) => Math.round(channel(a, i) * (1 - t) + channel(b, i) * t).toString(16).padStart(2, '0')).join('')
}
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// [foreground, background, minimum ratio]: 4.5 for text, 3 for graphics
const PAIRS = [
  ['foreground', 'background', 4.5],
  ['card-foreground', 'card', 4.5],
  ['muted-foreground', 'background', 4.5],
  ['muted-foreground', 'card', 4.5],
  ['muted-foreground', 'muted', 4.5],
  ['primary-foreground', 'primary', 4.5],
  ['primary', 'card', 4.5],
  ['secondary-foreground', 'secondary', 4.5],
  ['accent-foreground', 'accent', 4.5],
  ['destructive', 'card', 4.5],
  ['risk-low', 'risk-low-bg', 4.5],
  ['risk-moderate', 'risk-moderate-bg', 4.5],
  ['risk-high', 'risk-high-bg', 4.5],
  ['risk-low-solid', 'card', 3],
  ['risk-moderate-solid', 'card', 3],
  ['risk-high-solid', 'card', 3],
  ['ring', 'background', 3],
  ['brand-foreground', 'brand', 4.5],
  ['brand-muted', 'brand', 4.5],
  ['brand-accent', 'brand', 3],
  // The login sky is a gradient: check text on its ends too, and on the horizon glow
  ['brand-foreground', 'brand-sky-top', 4.5],
  ['brand-foreground', 'brand-sky-bottom', 4.5],
  ['brand-muted', 'brand-sky-top', 4.5],
  ['brand-muted', 'brand-sky-bottom', 4.5],
  ['brand-muted', 'sky glow', 4.5],
  ['brand-muted', 'glass card', 4.5],
  // The frosted form card, over the brightest part of the light behind it
  ['card-foreground', 'frosted card', 4.5],
  ['muted-foreground', 'frosted card', 4.5],
  ['primary', 'frosted card', 4.5],
  ['destructive', 'frosted card', 4.5],
]

// Surfaces that are mixes of tokens, as index.css draws them (.fw-sky, .fw-glass,
// .fw-auth-side, .fw-orb-a and .fw-frost), at their least favourable point
const SURFACES = {
  'sky glow': (t) => mix(t['brand-sky-bottom'], t['brand-accent'], 0.12),
  'glass card': (t) => mix(t['brand-sky-bottom'], t['brand-foreground'], 0.10),
  'frosted card': (t, dark) => mix(t.card, mix(t.background, t.primary, dark ? 0.16 : 0.22), 0.28),
}

let failed = 0
for (const [theme, selector] of [['light', ':root'], ['dark', '.dark']]) {
  const t = tokens(selector)
  console.log(`\n${theme}`)
  for (const [fg, bg, min] of PAIRS) {
    const r = ratio(t[fg], SURFACES[bg] ? SURFACES[bg](t, theme === 'dark') : t[bg])
    const ok = r >= min
    if (!ok) failed++
    console.log(`  ${ok ? 'pass' : 'FAIL'}  ${r.toFixed(2).padStart(5)}:1 (min ${min})  ${fg} on ${bg}`)
  }
}
console.log(failed ? `\n${failed} pair(s) below the minimum` : '\nAll pairs pass')
process.exit(failed ? 1 : 0)
