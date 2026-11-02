import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { AlertTriangle } from 'lucide-react'

import { ROLE_LABELS } from '@/components/shell/AppShell'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ApiError, postJson, request } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { formatRequestTime } from '@/lib/format'
import type { AccountStatus, AuditEntry, Role, User } from '@/lib/types'
import { Field } from './AuthCard'

const STATUS_STYLE: Record<AccountStatus, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-risk-low-bg text-risk-low border-risk-low/30' },
  pending: { label: 'Pending approval', className: 'bg-risk-moderate-bg text-risk-moderate border-risk-moderate/30' },
  rejected: { label: 'Rejected', className: 'bg-muted text-muted-foreground' },
  disabled: { label: 'Disabled', className: 'bg-muted text-muted-foreground' },
}

const errorText = (reason: unknown) => (reason instanceof ApiError ? reason.detail : 'Something went wrong. Try again.')

function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <Alert variant="destructive" role="alert">
      <AlertTriangle aria-hidden />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}

function UserRow({ user, isSelf, onAction }: {
  user: User
  isSelf: boolean
  onAction: (user: User, action: string, role?: Role) => void
}) {
  const status = STATUS_STYLE[user.status]
  return (
    <li className="flex flex-col gap-3 border-b py-3 last:border-b-0 md:flex-row md:items-center md:justify-between" data-testid={`user-${user.email}`}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          <span className="break-all">{user.name}</span>
          {isSelf && <span className="text-xs font-normal text-muted-foreground">(you)</span>}
          <Badge variant="outline" className={status.className}>{status.label}</Badge>
        </p>
        <p className="break-all text-sm text-muted-foreground">{user.email}{user.organisation && ` · ${user.organisation}`}</p>
        <p className="text-xs text-muted-foreground">
          Last login: {user.last_login_at ? formatRequestTime(user.last_login_at) : 'never'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-sm">
          <span className="sr-only">Role for {user.email}</span>
          <select
            className="h-8 rounded-md border border-input bg-card px-2 text-sm"
            value={user.role}
            disabled={isSelf || user.status !== 'active'}
            onChange={(event) => onAction(user, 'set_role', event.target.value as Role)}
          >
            <option value="responder">{ROLE_LABELS.responder}</option>
            <option value="admin">{ROLE_LABELS.admin}</option>
          </select>
        </label>
        {user.status === 'pending' && (
          <>
            <Button size="sm" className="h-8" onClick={() => onAction(user, 'approve')}>Approve</Button>
            <Button size="sm" variant="outline" className="h-8" onClick={() => onAction(user, 'reject')}>Reject</Button>
          </>
        )}
        {user.status === 'rejected' && (
          <Button size="sm" variant="outline" className="h-8" onClick={() => onAction(user, 'approve')}>Approve</Button>
        )}
        {user.status === 'active' && !isSelf && (
          <Button size="sm" variant="outline" className="h-8" onClick={() => onAction(user, 'disable')}>Disable</Button>
        )}
        {user.status === 'disabled' && (
          <Button size="sm" variant="outline" className="h-8" onClick={() => onAction(user, 'enable')}>Enable</Button>
        )}
      </div>
    </li>
  )
}

const EMPTY_FORM = { name: '', email: '', organisation: '', password: '', role: 'responder' as Role }

function UsersTab() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState<User[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(() => {
    request<User[]>('/api/admin/users').then(setUsers).catch((reason) => setError(errorText(reason)))
  }, [])
  useEffect(load, [load])

  const act = async (user: User, action: string, role?: Role) => {
    setError(null)
    try {
      await postJson(`/api/admin/users/${user.id}`, { action, role }, 'PATCH')
    } catch (reason) {
      setError(errorText(reason))
    }
    load()
  }

  const add = async (event: FormEvent) => {
    event.preventDefault()
    setFormError(null)
    try {
      await postJson('/api/admin/users', form)
      setForm(EMPTY_FORM)
      load()
    } catch (reason) {
      setFormError(errorText(reason))
    }
  }

  const pending = users?.filter((user) => user.status === 'pending').length ?? 0

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Users{pending > 0 && ` · ${pending} awaiting approval`}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <ErrorNote message={error} />
          {!users && !error && <Skeleton className="h-32" />}
          {users && (
            <ul>
              {users.map((user) => (
                <UserRow key={user.id} user={user} isSelf={user.id === me?.id} onAction={act} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Add a user</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={add} className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2"><ErrorNote message={formError} /></div>
            <Field label="Name" id="new-name" required value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })} />
            <Field label="Email" id="new-email" type="email" required value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })} />
            <Field label="Organisation" id="new-org" value={form.organisation}
              onChange={(event) => setForm({ ...form, organisation: event.target.value })} />
            <Field label="Temporary password" id="new-password" type="password" autoComplete="new-password" required minLength={10}
              hint="At least 10 characters." value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })} />
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Role
              <select className="h-10 rounded-md border border-input bg-card px-2 font-normal" value={form.role}
                onChange={(event) => setForm({ ...form, role: event.target.value as Role })}>
                <option value="responder">{ROLE_LABELS.responder}</option>
                <option value="admin">{ROLE_LABELS.admin}</option>
              </select>
            </label>
            <div className="flex items-end"><Button type="submit" className="h-10">Add user</Button></div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function ActivityTab() {
  const [rows, setRows] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    request<AuditEntry[]>('/api/admin/audit').then(setRows).catch((reason) => setError(errorText(reason)))
  }, [])
  return (
    <Card>
      <CardHeader><CardTitle>Activity</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-2">
        <ErrorNote message={error} />
        {!rows && !error && <Skeleton className="h-32" />}
        {rows?.length === 0 && <p className="text-sm text-muted-foreground">No administrator actions yet.</p>}
        <ul>
          {rows?.map((row) => (
            <li key={row.id} className="border-b py-2 text-sm last:border-b-0">
              <p><span className="font-medium">{row.actor}</span>: {row.action.replace('_', ' ')} {row.target}{row.detail && ` (${row.detail})`}</p>
              <p className="text-xs text-muted-foreground">{formatRequestTime(row.at)}</p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

/** Administrators only. The server enforces this on every /api/admin route. */
export function SettingsPage() {
  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="pt-3"><UsersTab /></TabsContent>
        <TabsContent value="activity" className="pt-3"><ActivityTab /></TabsContent>
      </Tabs>
    </div>
  )
}
