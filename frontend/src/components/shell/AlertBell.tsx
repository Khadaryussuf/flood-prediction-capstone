import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ALERTS_CHANGED, getUnreadAlerts } from '@/lib/api'

const REFRESH_MS = 60 * 1000

/** The top bar's bell: this user's alerts that haven't been acknowledged. */
export function AlertBell() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const load = () => {
      getUnreadAlerts().then((body) => setCount(body.count)).catch(() => {})
    }
    load()
    const timer = setInterval(load, REFRESH_MS)
    window.addEventListener(ALERTS_CHANGED, load)
    return () => {
      clearInterval(timer)
      window.removeEventListener(ALERTS_CHANGED, load)
    }
  }, [])

  const label = count === 0 ? 'Alerts: none unread' : `Alerts: ${count} unread`
  return (
    <Button asChild variant="outline" size="icon" className="relative">
      <Link to="/alerts" aria-label={label}>
        <Bell aria-hidden />
        {count > 0 && (
          <span data-testid="unread-count" aria-hidden
            className="absolute -top-1.5 -right-1.5 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-destructive px-1 text-[11px] font-semibold text-card">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </Link>
    </Button>
  )
}
