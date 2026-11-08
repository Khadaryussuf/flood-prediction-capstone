import { useId, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { Bell, CloudRain, Eye, EyeOff, Map as MapIcon, Waves } from 'lucide-react'

import { ThemeToggle } from '@/components/theme-toggle'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { Headline } from './brand/Headline'
import { Skyline } from './brand/Skyline'
import { useCityScene } from './brand/useCityScene'
import { RainCanvas } from './RainCanvas'

/** The three features. Each card floats at its own depth (px toward the viewer). */
const POINTS = [
  { Icon: CloudRain, text: 'Hourly rainfall-intensity risk for Nairobi, from a model trained on five years of weather data', depth: 26 },
  { Icon: Bell, text: 'Alerts in the app and by email when Medium or High is predicted', depth: 6 },
  { Icon: MapIcon, text: 'A city map with the forecast rainfall around it', depth: 16 },
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
  card.style.setProperty('--ry', `${((x - 0.5) * 8).toFixed(2)}deg`)
  card.style.setProperty('--rx', `${((0.5 - y) * 8).toFixed(2)}deg`)
}
function untilt(event: PointerEvent<HTMLElement>) {
  for (const name of ['--rx', '--ry']) event.currentTarget.style.setProperty(name, '0deg')
}

function BrandPanel() {
  const panel = useRef<HTMLElement>(null)
  const skyline = useRef<SVGSVGElement>(null)
  const { mode, canvasRef } = useCityScene(panel)
  return (
    // A dark sky in both themes. Two boxes, one above the other: the words, then the
    // picture's box (the bottom third on wide screens). The picture is the 3D city when
    // it can run; otherwise the drawn skyline with canvas rain. Either way it sits under
    // the words, and the boxes never change size, so nothing moves when it switches.
    <aside ref={panel} data-scene={mode} className="fw-sky relative isolate flex flex-col overflow-hidden text-brand-foreground lg:sticky lg:top-0 lg:h-svh" aria-label="About FloodWatch">
      {mode !== '3d' && <RainCanvas skyline={skyline} className="pointer-events-none absolute inset-0 z-[1] size-full" />}
      {mode !== 'css' && (
        <canvas ref={canvasRef} aria-hidden data-testid="city-scene"
          className={cn('pointer-events-none absolute inset-0 z-[1] size-full transition-opacity duration-1000', mode === '3d' ? 'opacity-100' : 'opacity-0')} />
      )}
      <div className="relative z-[2] flex flex-col gap-3 px-4 pt-5 pr-20 pb-3 sm:px-8 sm:pr-24 lg:flex-[2] lg:gap-7 lg:px-12 lg:pt-12 lg:pb-6">
        <span className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg border border-brand-foreground/20 bg-brand-foreground/10 lg:size-10">
            <Waves className="size-5 text-brand-accent" aria-hidden />
          </span>
          <span className="text-lg font-semibold lg:text-xl">FloodWatch</span>
        </span>
        <div className="flex max-w-lg flex-col gap-2 lg:mt-4 lg:gap-4">
          <Headline className="text-xl leading-tight font-semibold sm:text-2xl lg:text-[2.6rem] lg:leading-[1.1]" />
          <p className="fw-rise text-sm text-brand-muted lg:text-base" style={{ '--i': 9 } as CSSProperties}>
            For county responders and their administrators.
          </p>
        </div>
        <ul className="hidden max-w-md flex-col gap-3 lg:flex">
          {POINTS.map(({ Icon, text, depth }, i) => (
            <li key={text} className="fw-rise" style={{ '--i': 11 + i } as CSSProperties}>
              <div className="fw-glass fw-float flex items-start gap-3 rounded-xl px-4 py-3 text-sm text-brand-muted"
                style={{ '--z': `${depth}px`, '--float-delay': `${-i * 1.7}s` } as CSSProperties}
                onPointerMove={tilt} onPointerLeave={untilt}>
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-accent/15">
                  <Icon className="size-4 text-brand-accent" aria-hidden />
                </span>
                <span className="pt-1.5">{text}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <Skyline ref={skyline} className={cn('relative z-0 block h-24 w-full shrink-0 transition-opacity duration-1000 [mask-image:linear-gradient(to_bottom,transparent,#000_45%)] sm:h-28 lg:h-auto lg:min-h-40 lg:flex-1 lg:[mask-image:none]',
        mode === '3d' && 'opacity-0')} />
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
