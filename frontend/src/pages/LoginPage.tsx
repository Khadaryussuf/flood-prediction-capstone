import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { AuthCard, Field } from './AuthCard'

export function LoginPage() {
  const { user, login } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
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
      setError(reason instanceof ApiError ? reason.detail : "Can't reach the server. Try again.")
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
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Field label="Email" id="email" type="email" autoComplete="username" required
          value={email} onChange={(event) => setEmail(event.target.value)} />
        <Field label="Password" id="password" type="password" autoComplete="current-password" required
          value={password} onChange={(event) => setPassword(event.target.value)} />
        <Button type="submit" size="lg" className="h-10" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          No account? <Link to="/signup" className="font-medium text-primary underline underline-offset-4">Request one</Link>
        </p>
      </form>
    </AuthCard>
  )
}
