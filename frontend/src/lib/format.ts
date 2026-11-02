// The API sends times as Nairobi local time without an offset, for example
// "2025-04-03T02:00:00". They are formatted from the text itself, not with
// Date, so the browser's own time zone can't shift them.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function parts(iso: string) {
  const [date, time = '00:00'] = iso.split('T')
  const [year, month, day] = date.split('-').map(Number)
  return { year, month, day, hhmm: time.slice(0, 5) }
}

/** "3 Apr 2025, 02:00" */
export function formatHour(iso: string): string {
  const { year, month, day, hhmm } = parts(iso)
  return `${day} ${MONTHS[month - 1]} ${year}, ${hhmm}`
}

/** "3 Apr 2025" */
export function formatDay(iso: string): string {
  const { year, month, day } = parts(iso)
  return `${day} ${MONTHS[month - 1]} ${year}`
}

/** Rainfall in mm with a fixed number of decimals, e.g. "0.06" */
export function formatMm(mm: number, decimals = 2): string {
  return mm.toFixed(decimals)
}

export const formatCount = (n: number) => n.toLocaleString('en-GB')
