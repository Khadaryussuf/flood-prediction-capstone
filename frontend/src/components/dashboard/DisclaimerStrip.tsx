import { Info } from 'lucide-react'

import { DISCLAIMER } from '@/lib/copy'

/** Always rendered, whatever the API returns, so the caveat can't be missed. */
export function DisclaimerStrip() {
  return (
    <div role="note" aria-label="Disclaimer" className="border-b bg-accent text-accent-foreground">
      <p className="mx-auto flex max-w-7xl items-start gap-2 px-4 py-2 text-sm sm:px-6">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{DISCLAIMER}</span>
      </p>
    </div>
  )
}
