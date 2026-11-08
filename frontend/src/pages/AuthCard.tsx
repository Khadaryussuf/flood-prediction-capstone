import { forwardRef, useId, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { Bell, CloudRain, Eye, EyeOff, Map as MapIcon, Waves } from 'lucide-react'

import { ThemeToggle } from '@/components/theme-toggle'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { RainCanvas } from './RainCanvas'

/** Blocks of buildings for one layer of the skyline, the same on every load */
function blocks(seed: number, minHeight: number, maxHeight: number, minWidth: number, maxWidth: number) {
  let state = seed
  const next = () => ((state = (state * 16807) % 2147483647) / 2147483647)
  const list: { x: number; width: number; height: number }[] = []
  for (let x = 0; x < 400;) {
    const width = Math.round(minWidth + next() * (maxWidth - minWidth))
    list.push({ x, width, height: Math.round(minHeight + next() ** 1.4 * (maxHeight - minHeight)) })
    x += width
  }
  const d = 'M0 186' + list.map(({ x, width, height }) => `V${186 - height}H${Math.min(400, x + width)}`).join('') + 'V186Z'
  return { d, list, next }
}

const FAR = blocks(7, 34, 104, 10, 22)
const MID = blocks(41, 22, 74, 14, 30)
const NEAR = blocks(97, 10, 44, 18, 38)
// A few softly lit windows on the nearer layers; some flicker slowly
const WINDOWS = [MID, NEAR].flatMap((layer, depth) =>
  layer.list.flatMap(({ x, width, height }) => {
    if (layer.next() > 0.55 || width < 14) return []
    const count = 1 + Math.floor(layer.next() * 2)
    return Array.from({ length: count }, () => ({
      x: x + 3 + Math.floor(layer.next() * (width - 8)),
      y: 186 - height + 5 + Math.floor(layer.next() * Math.max(1, height - 14)),
      flicker: layer.next() < 0.3,
      bright: depth === 1,
    }))
  }))

/** A city skyline at dusk: three layers of generic towers (not a map of real
 *  buildings) against a glow along the horizon, standing in a strip of water.
 *  Drawn here, so nothing is downloaded; it is a box of its own below the words. */
const Skyline = forwardRef<SVGSVGElement, { className?: string }>(function Skyline({ className }, ref) {
  const wave = 'M0 190 q50 -5 100 0' + ' t100 0'.repeat(7)
  return (
    <svg ref={ref} viewBox="0 0 400 200" className={className} aria-hidden focusable="false" preserveAspectRatio="xMidYMax slice">
      <defs>
        <linearGradient id="fw-horizon" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--brand-accent)', stopOpacity: 0 }} />
          <stop offset="1" style={{ stopColor: 'var(--brand-accent)', stopOpacity: 0.5 }} />
        </linearGradient>
        <linearGradient id="fw-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: 'color-mix(in srgb, var(--brand-sky-bottom), var(--brand-accent) 28%)' }} />
          <stop offset="1" style={{ stopColor: 'var(--brand-sky-top)' }} />
        </linearGradient>
        <filter id="fw-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="1.4" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <rect x="0" y="110" width="400" height="76" fill="url(#fw-horizon)" />
      <path d={FAR.d} style={{ fill: 'color-mix(in srgb, var(--brand-sky-bottom), var(--brand-accent) 30%)' }} opacity="0.6" />
      <path d={MID.d} style={{ fill: 'color-mix(in srgb, var(--brand-sky-bottom), white 14%)' }} />
      <path d={NEAR.d} style={{ fill: 'color-mix(in srgb, var(--brand-sky-top), var(--brand-sky-bottom) 55%)', stroke: 'var(--brand-accent)' }}
        strokeOpacity="0.3" strokeWidth="0.6" />
      <g filter="url(#fw-glow)">
        {WINDOWS.map(({ x, y, flicker, bright }, i) => (
          <rect key={i} x={x} y={y} width="2.6" height="3.4" rx="0.4" fill="#FCD9A0"
            opacity={bright ? 0.85 : 0.6} className={flicker ? 'fw-window' : undefined}
            style={flicker ? { animationDelay: `${-(i % 7)}s` } : undefined} />
        ))}
      </g>
      <rect x="0" y="186" width="400" height="14" fill="url(#fw-water)" />
      <g className="fw-wave" style={{ color: 'var(--brand-accent)' }}>
        <path stroke="currentColor" strokeWidth="1.2" fill="none" opacity="0.55" d={wave} />
      </g>
    </svg>
  )
})

const HEADLINE = 'Know when heavy rain is coming to Nairobi.'

const POINTS = [
  { Icon: CloudRain, text: 'Hourly rainfall-intensity risk for Nairobi, from a model trained on five years of weather data' },
  { Icon: Bell, text: 'Alerts in the app and by email when Medium or High is predicted' },
  { Icon: MapIcon, text: 'A city map with the forecast rainfall around it' },
]

const wantsMotion = () => typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Tilts a glass card a little toward a mouse cursor, and lights its edge there */
function tilt(event: PointerEvent<HTMLElement>) {
  if (event.pointerType !== 'mouse' || !wantsMotion()) return
  const card = event.currentTarget
  const box = card.getBoundingClientRect()
  const x = (event.clientX - box.left) / box.width
  const y = (event.clientY - box.top) / box.height
  card.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`)
  card.style.setProperty('--my', `${(y * 100).toFixed(1)}%`)
  card.style.setProperty('--ry', `${((x - 0.5) * 7).toFixed(2)}deg`)
  card.style.setProperty('--rx', `${((0.5 - y) * 7).toFixed(2)}deg`)
}
function untilt(event: PointerEvent<HTMLElement>) {
  for (const name of ['--rx', '--ry']) event.currentTarget.style.setProperty(name, '0deg')
}

function BrandPanel() {
  const skyline = useRef<SVGSVGElement>(null)
  return (
    // A dark sky in both themes. Two boxes, one above the other: the words, then the
    // skyline (the bottom third on wide screens). The rain canvas spans both, under the words.
    <aside className="fw-sky relative isolate flex flex-col overflow-hidden text-brand-foreground lg:sticky lg:top-0 lg:h-svh" aria-label="About FloodWatch">
      <RainCanvas skyline={skyline} className="pointer-events-none absolute inset-0 z-[1] size-full" />
      <div className="relative z-[2] flex flex-col gap-3 px-4 pt-5 pr-20 pb-3 sm:px-8 sm:pr-24 lg:flex-[2] lg:gap-7 lg:px-12 lg:pt-12 lg:pb-6">
        <span className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg border border-brand-foreground/20 bg-brand-foreground/10 lg:size-10">
            <Waves className="size-5 text-brand-accent" aria-hidden />
          </span>
          <span className="text-lg font-semibold lg:text-xl">FloodWatch</span>
        </span>
        <div className="flex max-w-lg flex-col gap-2 lg:mt-6 lg:gap-4">
          <p className="fw-headline text-xl leading-tight font-semibold text-balance sm:text-2xl lg:text-[2.6rem] lg:leading-[1.1]">
            {HEADLINE.split(' ').map((word, i) => (
              <span key={i}>
                <span className="fw-word" style={{ '--i': i } as CSSProperties}>{word}</span>{' '}
              </span>
            ))}
          </p>
          <p className="fw-rise text-sm text-brand-muted lg:text-base" style={{ '--i': 8 } as CSSProperties}>
            For county responders and their administrators.
          </p>
        </div>
        <ul className="hidden max-w-md flex-col gap-3 lg:flex">
          {POINTS.map(({ Icon, text }, i) => (
            <li key={text} className="fw-glass fw-rise flex items-start gap-3 rounded-xl px-4 py-3 text-sm text-brand-muted"
              style={{ '--i': 10 + i } as CSSProperties} onPointerMove={tilt} onPointerLeave={untilt}>
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-accent/15">
                <Icon className="size-4 text-brand-accent" aria-hidden />
              </span>
              <span className="pt-1.5">{text}</span>
            </li>
          ))}
        </ul>
      </div>
      <Skyline ref={skyline} className="relative z-0 block h-24 w-full shrink-0 [mask-image:linear-gradient(to_bottom,transparent,#000_45%)] sm:h-28 lg:h-auto lg:min-h-40 lg:flex-1 lg:[mask-image:none]" />
    </aside>
  )
}

/** The split layout shared by the login and sign-up screens: the brand panel, and
 *  the form in a frosted card. There is no risk on these screens, so no disclaimer
 *  strip. The card's contents fade in once the session is known, so the Google
 *  button never pops in and pushes the form down. */
export function AuthCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const { loading } = useAuth()
  return (
    <div className="relative grid min-h-svh grid-rows-[auto_1fr] bg-background lg:grid-cols-2 lg:grid-rows-1">
      <div className="absolute top-5 right-5 z-20 sm:top-6 sm:right-6 lg:top-8 lg:right-8"><ThemeToggle /></div>
      <BrandPanel />
      <main className="fw-auth-side relative isolate flex flex-col overflow-hidden px-4 py-5 sm:px-8 lg:px-12 lg:py-8">
        <div className="fw-orb fw-orb-a" aria-hidden />
        <div className="fw-orb fw-orb-b" aria-hidden />
        <div className={cn('fw-frost mx-auto flex w-full max-w-md flex-col gap-5 rounded-2xl p-5 transition-opacity duration-300 sm:p-7 lg:my-auto',
          loading ? 'opacity-0' : 'opacity-100')}>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  )
}

interface FieldProps extends React.ComponentProps<typeof Input> {
  label: string
  id: string
  hint?: string
  /** Shown under the field, which is then marked invalid */
  error?: string | null
  /** Something inside the input's right edge, such as the show/hide button */
  trailing?: ReactNode
}

export function Field({ label, id, hint, error, trailing, className, ...input }: FieldProps) {
  const described = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input id={id} className={cn('h-10 bg-background/70 dark:bg-background/50', trailing && 'pr-11', className)} aria-describedby={described}
          aria-invalid={error ? true : undefined} {...input} />
        {trailing}
      </div>
      {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p id={`${id}-error`} className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  )
}

/** A password field with a show/hide button. */
export function PasswordField(props: Omit<FieldProps, 'type' | 'trailing'>) {
  const [visible, setVisible] = useState(false)
  const toggleId = useId()
  return (
    <Field
      {...props}
      type={visible ? 'text' : 'password'}
      trailing={
        <button
          id={toggleId}
          type="button"
          className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          aria-label={visible ? `Hide ${props.label.toLowerCase()}` : `Show ${props.label.toLowerCase()}`}
          aria-pressed={visible}
          aria-controls={props.id}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      }
    />
  )
}
