import { useId, useState, type ReactNode } from 'react'
import { Bell, CloudRain, Eye, EyeOff, Map as MapIcon, Waves } from 'lucide-react'

import { ThemeToggle } from '@/components/theme-toggle'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/** A city skyline under rain: drawn here, so nothing is downloaded. The towers
 *  are generic, not a map of real buildings. */
function RainOverCity({ className }: { className?: string }) {
  const drops = Array.from({ length: 42 }, (_, i) => ({
    x: (i * 37) % 400,
    y: (i * 53) % 150,
    length: 12 + ((i * 7) % 10),
  }))
  return (
    <svg viewBox="0 0 400 260" className={className} aria-hidden focusable="false" preserveAspectRatio="xMidYMax slice">
      <g className="text-brand-accent" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.55">
        {drops.map(({ x, y, length }, i) => (
          <line key={i} x1={x} y1={y + 20} x2={x - length * 0.35} y2={y + 20 + length} />
        ))}
      </g>
      <g className="text-brand-foreground" fill="currentColor">
        <path opacity="0.16" d="M0 260V200h30v-24h22v34h18v-50h26v40h20v-18h24v-30h14v-22h10v22h14v58h22v-36h30v26h18v-62h28v52h22v-28h26v46h20v-20h30v40h26v48z" />
        <path opacity="0.32" d="M0 260v-38h24v-20h28v34h20v-14h26v-40h18v-28h8v28h18v54h26v-26h22v-46h12l8-14 8 14h12v60h24v-30h30v22h18v-42h26v50h28v-24h24v54z" />
      </g>
      <path className="text-brand-accent" stroke="currentColor" strokeWidth="2.5" fill="none" opacity="0.9"
        d="M0 246c40-8 70 8 110 0s70-10 110 0 70 8 110 0 50-6 70-2" />
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
    <aside className="relative isolate overflow-hidden bg-brand text-brand-foreground" aria-label="About FloodWatch">
      <RainOverCity className="absolute inset-x-0 bottom-0 -z-10 h-14 w-full sm:h-20 lg:h-2/5" />
      <div className="flex flex-col gap-3 px-4 pt-5 pb-16 pr-16 sm:px-8 sm:pb-24 lg:h-full lg:gap-8 lg:px-12 lg:pt-12 lg:pb-12">
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
