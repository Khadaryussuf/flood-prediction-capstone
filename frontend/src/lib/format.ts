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

/** The hour that ends at `iso`, as Open-Meteo's hourly rainfall does:
 *  "21:00 to 22:00, 3 Nov 2026" (the date is the hour's start) */
export function formatHourRange(iso: string): string {
  const { year, month, day, hhmm } = parts(iso)
  const [hours, minutes] = hhmm.split(':').map(Number)
  const start = new Date(Date.UTC(year, month - 1, day, hours - 1, minutes))
  const pad = (n: number) => String(n).padStart(2, '0')
  const startText = `${pad(start.getUTCHours())}:${pad(start.getUTCMinutes())}`
  return `${startText} to ${hhmm}, ${start.getUTCDate()} ${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`
}

/** "3 Apr 2025" */
export function formatDay(iso: string): string {
  const { year, month, day } = parts(iso)
  return `${day} ${MONTHS[month - 1]} ${year}`
}

/** "02:00" */
export function formatClock(iso: string): string {
  return parts(iso).hhmm
}

/** When a request was stored. The backend records UTC: "3 Apr 2025, 02:00:15 UTC" */
export function formatRequestTime(iso: string): string {
  const { year, month, day } = parts(iso)
  const time = (iso.split('T')[1] ?? '').slice(0, 8)
  return `${day} ${MONTHS[month - 1]} ${year}, ${time} UTC`
}

/** Rainfall in mm with a fixed number of decimals, e.g. "0.06" */
export function formatMm(mm: number, decimals = 2): string {
  return mm.toFixed(decimals)
}

export const formatCount = (n: number) => n.toLocaleString('en-GB')
