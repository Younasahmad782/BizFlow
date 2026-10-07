/** Format a number as Pakistani Rupees: Rs. 125,500 */
export function formatPKR(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') return 'Rs. 0'
  const n = Number(amount)
  if (Number.isNaN(n)) return 'Rs. 0'
  return 'Rs. ' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

/** Format a date in Pakistan Standard Time: 07 Oct 2026 */
export function formatPKDate(date: string | Date | null | undefined): string {
  if (!date) return '—'
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Karachi',
  }).format(d)
}

/** e.g. "Today, 11:42 AM" / "Yesterday, 4:31 PM" / "5 Oct 2026, 2:15 PM" */
export function formatPKDateTime(date: string | Date | null | undefined): string {
  if (!date) return '—'
  const d = new Date(date)
  const now = new Date()
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate())
  const dayDiff = Math.round((startOfDay(now).getTime() - startOfDay(d).getTime()) / 86400000)
  const time = d.toLocaleTimeString('en-PK', { hour: 'numeric', minute: '2-digit', hour12: true })
  if (dayDiff === 0) return `Today, ${time}`
  if (dayDiff === 1) return `Yesterday, ${time}`
  return `${d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' })}, ${time}`
}
