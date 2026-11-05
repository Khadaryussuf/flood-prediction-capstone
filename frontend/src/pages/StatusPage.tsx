import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Compass, ShieldOff, type LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'

function StatusPage({ Icon, title, children }: { Icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-7" aria-hidden />
      </span>
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="text-sm text-muted-foreground">{children}</div>
      <Button asChild className="h-10">
        <Link to="/dashboard">Go to the Dashboard</Link>
      </Button>
    </div>
  )
}

/** For a signed-in user who opens an administrator page. The server refuses the
 *  page's data with 403 either way; this only explains it. */
export function NoAccessPage() {
  return (
    <StatusPage Icon={ShieldOff} title="You don't have access">
      <p>This page is for administrators. If you need it, ask an administrator to change your role.</p>
    </StatusPage>
  )
}

/** Any address the app doesn't know. */
export function NotFoundPage() {
  return (
    <StatusPage Icon={Compass} title="Page not found">
      <p>There's no page at this address. It may have been mistyped, or the link is out of date.</p>
    </StatusPage>
  )
}
