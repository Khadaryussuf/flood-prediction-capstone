import { useId, useState, type ReactNode } from 'react'
import { Bell, CloudRain, Eye, EyeOff, Map as MapIcon, Waves } from 'lucide-react'

import { ThemeToggle } from '@/components/theme-toggle'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/** A city skyline under rain: drawn here, so nothing is downloaded. The towers
 *  are generic, not a map of real buildings. It sits in its own box below the text,
 *  so rain and buildings never run behind the words. The rain falls only in the sky
 *  above the roofs, and the buildings are drawn over it. Motion is CSS only (index.css)
 *  and stops for anyone who asks for reduced motion. */
function RainOverCity({ className }: { className?: string }) {
  // Thin streaks spread across the sky; each starts at its own point in the cycle
  const drops = Array.from({ length: 34 }, (_, i) => ({
    x: 6 + ((i * 47) % 396),
    length: 10 + ((i * 7) % 8),
    delay: -((i * 0.37) % 2.6),
    duration: 2.2 + ((i * 13) % 9) / 10,
  }))
  // A gentle wave twice as wide as the view, so drifting by one period loops seamlessly
  const wave = 'M0 188 q50 -8 100 0' + ' t100 0'.repeat(7)
  return (
    <svg viewBox="0 0 400 200" className={className} aria-hidden focusable="false" preserveAspectRatio="xMidYMax slice">
      <g className="text-brand-accent" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.45">
        {drops.map(({ x, length, delay, duration }, i) => (
          <line key={i} className="fw-rain-drop" x1={x} y1={0} x2={x - length * 0.3} y2={length}
            style={{ animationDelay: `${delay}s`, animationDuration: `${duration}s` }} />
        ))}
      </g>
      {/* Solid, a little darker than the panel and close to it in tone: the text stands
          out, and the rain behind the roofs doesn't show through the walls */}
      <g>
        <path style={{ fill: 'color-mix(in srgb, var(--brand), black 22%)' }} d="M0 200v-68h30v-20h22v28h18v-40h26v32h20v-14h24v-24h14v-18h10v18h14v46h22v-28h30v20h18v-50h28v42h22v-22h26v36h20v-16h30v32h26v38z" />
        <path style={{ fill: 'color-mix(in srgb, var(--brand), black 38%)' }} d="M0 200v-48h24v-16h28v26h20v-10h26v-32h18v-22h8v22h18v42h26v-20h22v-36h12l8-12 8 12h12v46h24v-24h30v18h18v-34h26v40h28v-18h24v62z" />
      </g>
      <g className="fw-wave text-brand-accent">
        <path stroke="currentColor" strokeWidth="2" fill="none" opacity="0.7" d={wave} />
      </g>
    </svg>
  )
}

const POINTS = [
  { Icon: CloudRain, text: 'Hourly rainfall-intensity risk for Nairobi, from a model trained on five years of weather data' },
  { Icon: Bell, text: 'Alerts in the app and by email when Medium or High is predicted' },
  { Icon: MapIcon, text: 'A city map with the forecast rainfall around it' },
]

function BrandPanel() {
  return (
    // Two boxes, one above the other: the text, then the skyline (the bottom third on
    // wide screens). Neither is drawn over the other.
    <aside className="flex flex-col overflow-hidden bg-brand text-brand-foreground lg:h-svh lg:sticky lg:top-0" aria-label="About FloodWatch">
      <div className="flex flex-col gap-3 px-4 pt-5 pb-4 pr-16 sm:px-8 lg:flex-[2] lg:gap-8 lg:px-12 lg:pt-12 lg:pb-6">
        <span className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-brand-foreground/15 lg:size-10">
            <Waves className="size-5" aria-hidden />
          </span>
          <span className="text-lg font-semibold lg:text-xl">FloodWatch</span>
        </span>
        <div className="flex max-w-md flex-col gap-2 lg:mt-10 lg:gap-4">
          <p className="text-xl font-semibold leading-tight text-balance sm:text-2xl lg:text-4xl">
            Know when heavy rain is coming to Nairobi.
          </p>
          <p className="text-sm text-brand-muted lg:text-base">For county responders and their administrators.</p>
        </div>
        <ul className="hidden max-w-md flex-col gap-4 lg:flex">
          {POINTS.map(({ Icon, text }) => (
            <li key={text} className="flex items-start gap-3 text-brand-muted">
              <Icon className="mt-0.5 size-5 shrink-0 text-brand-accent" aria-hidden />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </div>
      <RainOverCity className="block h-20 w-full shrink-0 sm:h-24 lg:h-auto lg:min-h-40 lg:flex-1" />
    </aside>
  )
}

/** The split layout shared by the login and sign-up screens: the brand panel,
 *  and the form. There is no risk on these screens, so no disclaimer strip. */
export function AuthCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="relative grid min-h-svh grid-rows-[auto_1fr] bg-background lg:grid-cols-2 lg:grid-rows-1">
      <div className="absolute top-4 right-4 z-10"><ThemeToggle /></div>
      <BrandPanel />
      <main className="flex flex-col px-4 py-6 sm:px-8 lg:py-8">
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-6 pt-2 lg:justify-center lg:py-6">
          <div className="flex flex-col gap-1.5">
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
        <Input id={id} className={cn('h-10', trailing && 'pr-11', className)} aria-describedby={described}
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
