import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ApiError, postJson } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { AuthCard, Field, PasswordField } from './AuthCard'
import { GoogleButton } from './GoogleButton'

const LOGIN_LINK = <Link to="/login" className="font-medium text-primary underline underline-offset-4">Log in</Link>
const MIN_PASSWORD = 10

type Form = { name: string; email: string; organisation: string; password: string; confirm_password: string }
type FieldErrors = Partial<Record<keyof Form, string>>

/** The same rules the server applies, checked first so the message sits by the field */
export function checkSignup(form: Form): FieldErrors {
  const errors: FieldErrors = {}
  if (form.password.length < MIN_PASSWORD) errors.password = `Use at least ${MIN_PASSWORD} characters.`
  else if (form.password.trim().toLowerCase() === form.email.trim().toLowerCase()) errors.password = "Don't use your email as the password."
  if (form.confirm_password !== form.password) errors.confirm_password = "The passwords don't match."
  return errors
}

/** Which field a server refusal is about, so it can be shown there too */
function serverField(detail: string): keyof Form | null {
  if (/already registered|valid email/i.test(detail)) return 'email'
  if (/password/i.test(detail)) return 'password'
  if (/name/i.test(detail)) return 'name'
  return null
}

/** Creates a Responder account that an administrator must approve. */
export function SignupPage() {
  const { user } = useAuth()
  const [form, setForm] = useState<Form>({ name: '', email: '', organisation: '', password: '', confirm_password: '' })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to="/dashboard" replace />

  const set = (key: keyof Form) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm((current) => ({ ...current, [key]: event.target.value }))
    setFieldErrors((current) => ({ ...current, [key]: undefined }))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    const errors = checkSignup(form)
    setFieldErrors(errors)
    if (Object.keys(errors).length) {
      setError(Object.values(errors).join(' '))
      return
    }
    setBusy(true)
    try {
      await postJson('/api/auth/signup', form)
      setDone(true)
    } catch (reason) {
      const detail = reason instanceof ApiError ? reason.detail : "Can't reach the server. Check your connection and try again."
      setError(detail)
      const field = reason instanceof ApiError ? serverField(detail) : null
      if (field) setFieldErrors({ [field]: detail })
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
        <p className="text-center text-sm">{LOGIN_LINK}</p>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Request an account" description="An administrator approves each new responder account.">
      <GoogleButton />
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertTriangle aria-hidden />
            <AlertTitle>Check the form</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Field label="Name" id="name" autoComplete="name" required value={form.name} onChange={set('name')}
          error={fieldErrors.name} />
        <Field label="Email" id="email" type="email" autoComplete="email" required value={form.email} onChange={set('email')}
          error={fieldErrors.email} />
        <Field label="Organisation" id="organisation" autoComplete="organization" required value={form.organisation} onChange={set('organisation')} />
        <PasswordField label="Password" id="password" autoComplete="new-password" required minLength={MIN_PASSWORD}
          hint={`At least ${MIN_PASSWORD} characters, and not your email.`} value={form.password} onChange={set('password')}
          error={fieldErrors.password} />
        <PasswordField label="Confirm password" id="confirm" autoComplete="new-password" required
          value={form.confirm_password} onChange={set('confirm_password')} error={fieldErrors.confirm_password} />
        <Button type="submit" size="lg" className="h-10" disabled={busy}>{busy ? 'Sending…' : 'Request account'}</Button>
      </form>
      <p className="text-center text-sm text-muted-foreground">Already registered? {LOGIN_LINK}</p>
    </AuthCard>
  )
}
