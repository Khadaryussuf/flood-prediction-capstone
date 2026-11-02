import type { ReactNode } from 'react'
import { Waves } from 'lucide-react'

import { DisclaimerStrip } from '@/components/dashboard/DisclaimerStrip'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** The layout shared by the login and sign-up screens. */
export function AuthCard({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <DisclaimerStrip />
      <main className="flex flex-1 flex-col items-center justify-center gap-5 px-4 py-8">
        <span className="flex items-center gap-2.5">
          <span className="grid size-10 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Waves className="size-5" aria-hidden />
          </span>
          <span className="text-xl font-semibold">FloodWatch</span>
        </span>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle><h1 className="text-lg font-semibold">{title}</h1></CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
      </main>
    </div>
  )
}

interface FieldProps extends React.ComponentProps<typeof Input> {
  label: string
  id: string
  hint?: string
}

export function Field({ label, id, hint, ...input }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className="h-10" aria-describedby={hint ? `${id}-hint` : undefined} {...input} />
      {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
