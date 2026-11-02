import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ApiError, postJson } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { AuthCard, Field } from './AuthCard'

const LOGIN_LINK = <Link to="/login" className="font-medium text-primary underline underline-offset-4">Log in</Link>

/** Creates a Responder account that an administrator must approve. */
export function SignupPage() {
  const { user } = useAuth()
  const [form, setForm] = useState({ name: '', email: '', organisation: '', password: '', confirm_password: '' })
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to="/dashboard" replace />

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (form.password !== form.confirm_password) {
      setError("The passwords don't match.")
      return
    }
    setBusy(true)
    try {
      await postJson('/api/auth/signup', form)
      setDone(true)
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.detail : "Can't reach the server. Try again.")
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <AuthCard title="Request received" description="Your account now needs approval.">
        <Alert role="status">
          <CheckCircle2 aria-hidden />
          <AlertTitle>Awaiting approval</AlertTitle>
          <AlertDescription>An administrator must approve your account before you can log in.</AlertDescription>
        </Alert>
        <p className="mt-4 text-center text-sm">{LOGIN_LINK}</p>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Request an account" description="An administrator approves each new responder account.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertTriangle aria-hidden />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Field label="Name" id="name" autoComplete="name" required value={form.name} onChange={set('name')} />
        <Field label="Email" id="email" type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
        <Field label="Organisation" id="organisation" autoComplete="organization" required value={form.organisation} onChange={set('organisation')} />
        <Field label="Password" id="password" type="password" autoComplete="new-password" required minLength={10}
          hint="At least 10 characters, and not your email." value={form.password} onChange={set('password')} />
        <Field label="Confirm password" id="confirm" type="password" autoComplete="new-password" required
          value={form.confirm_password} onChange={set('confirm_password')} />
        <Button type="submit" size="lg" className="h-10" disabled={busy}>{busy ? 'Sending…' : 'Request account'}</Button>
        <p className="text-center text-sm text-muted-foreground">Already registered? {LOGIN_LINK}</p>
      </form>
    </AuthCard>
  )
}
