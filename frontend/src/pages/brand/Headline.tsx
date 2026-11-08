import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { HEADLINE, PHRASES } from './headlineText'

const FIRST_FLIP_MS = 4000
const FLIP_EVERY_MS = 3200

const motionAllowed = () => typeof window.matchMedia === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Splits text into words of letters. Letters rise and turn into place on load
 *  (CSS, index.css); each word lifts and glows under a mouse. */
function Letters({ text, start }: { text: string; start: number }) {
  let n = start
  const words = text.split(' ')
  return words.map((word, w) => (
    <span key={w}>
      <span className="fw-word">
        {[...word].map((letter, i) => <span key={i} className="fw-letter" style={{ '--n': n++ } as CSSProperties}>{letter}</span>)}
      </span>
      {w < words.length - 1 ? ' ' : null}
    </span>
  ))
}

/** The panel's headline. The visible version is hidden from screen readers, which
 *  read the heading's label instead, so the cycling words are never announced. */
export function Headline({ className }: { className?: string }) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (!motionAllowed()) return
    let every: ReturnType<typeof setInterval> | undefined
    const first = setTimeout(() => {
      const flip = () => { if (!document.hidden) setIndex((current) => (current + 1) % PHRASES.length) }
      flip()
      every = setInterval(flip, FLIP_EVERY_MS)
    }, FIRST_FLIP_MS)
    return () => {
      clearTimeout(first)
      clearInterval(every)
    }
  }, [])

  const lead = 'Know when'
  const tail = 'coming to Nairobi.'
  const state = (i: number): string => (i === index ? 'in' : i === (index + PHRASES.length - 1) % PHRASES.length ? 'out' : 'next')
  const flipLine: ReactNode = PHRASES.map((phrase, i) => (
    <span key={phrase} className="fw-flip-item" data-state={state(i)}>
      {/* Only the first phrase arrives letter by letter; the others flip in later */}
      {i === 0 ? <Letters text={phrase} start={lead.length} /> : phrase}
    </span>
  ))

  return (
    <h2 aria-label={HEADLINE} className={cn('fw-headline', className)}>
      <span aria-hidden className="block">
        <span className="block"><Letters text={lead} start={0} /></span>
        <span className="fw-flip block text-brand-accent" data-testid="headline-cycle">{flipLine}</span>
        <span className="block"><Letters text={tail} start={lead.length + PHRASES[0].length} /></span>
      </span>
    </h2>
  )
}
