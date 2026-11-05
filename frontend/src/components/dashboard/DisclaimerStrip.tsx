import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Info } from 'lucide-react'

import { getDisclaimer } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { DISCLAIMER, DISCLAIMER_OVERRIDDEN, THRESHOLDS_CHANGED } from '@/lib/copy'

/** Always rendered, whatever the API returns, so the caveat can't be missed.
 *  It names the administrator's limits when they replace the AMS classes. */
export function DisclaimerStrip() {
  const [overridden, setOverridden] = useState(false)
  const { pathname } = useLocation()
  const { user } = useAuth()
  const loggedIn = Boolean(user)

  useEffect(() => {
    if (!loggedIn) return // the route needs a session; the default wording stays
    let stale = false
    const load = () => {
      getDisclaimer()
        .then((body) => !stale && setOverridden(body.thresholds_overridden))
        .catch(() => {}) // keep the last known wording
    }
    load()
    window.addEventListener(THRESHOLDS_CHANGED, load)
    return () => {
      stale = true
      window.removeEventListener(THRESHOLDS_CHANGED, load)
    }
  }, [pathname, loggedIn])

  return (
    <div role="note" aria-label="Disclaimer" className="border-b bg-accent text-accent-foreground">
      <p className="mx-auto flex max-w-7xl items-start gap-2 px-4 py-2 text-sm sm:px-6">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{overridden ? DISCLAIMER_OVERRIDDEN : DISCLAIMER}</span>
      </p>
    </div>
  )
}
