import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { AuthCard, Field, PasswordField } from './AuthCard'

/** A title for each kind of refusal, so the reason is clear at a glance */
function errorTitle(error: ApiError | null): string {
  if (error?.code === 'awaiting_approval') return 'Not approved yet'
  if (error?.code === 'disabled') return 'Account disabled'
  if (error?.status === 429) return 'Too many attempts'
  if (error?.status === 401) return "Those details didn't match"
  return "Couldn't log in"
}

export function LoginPage() {
  const { user, login } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<{ title: string; detail: string } | null>(null)
  const [busy, setBusy] = useState(false)

  if (user) {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from ?? '/dashboard'} replace />
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email, password)
    } catch (reason) {
      setError(reason instanceof ApiError
        ? { title: errorTitle(reason), detail: reason.detail }
        : { title: errorTitle(null), detail: "Can't reach the server. Check your connection and try again." })
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthCard title="Log in" description="For registered responders and administrators.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertTriangle aria-hidden />
            <AlertTitle>{error.title}</AlertTitle>
            <AlertDescription>{error.detail}</AlertDescription>
          </Alert>
        )}
        <Field label="Email" id="email" type="email" autoComplete="username" required autoFocus
          value={email} onChange={(event) => setEmail(event.target.value)} />
        <PasswordField label="Password" id="password" autoComplete="current-password" required
          value={password} onChange={(event) => setPassword(event.target.value)} />
        <Button type="submit" size="lg" className="h-10" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">
        No account? <Link to="/signup" className="font-medium text-primary underline underline-offset-4">Request one</Link>
      </p>
    </AuthCard>
  )
}
