/**
 * Localization config. Pakistan is the default; the structure supports
 * adding other countries later (currency symbol, phone format, timezone).
 */

export interface CountryLocale {
  country: string
  currency: string // ISO code
  currencySymbol: string
  phonePrefix: string
  phoneFormat: (digits: string) => string
  timezone: string
  locale: string // Intl locale for number/date formatting
}

const PAKISTAN: CountryLocale = {
  country: 'Pakistan',
  currency: 'PKR',
  currencySymbol: 'Rs.',
  phonePrefix: '+92',
  phoneFormat: (digits: string) => {
    // +92 3XX XXXXXXX
    const d = digits.replace(/\D/g, '')
    const local = d.startsWith('92') ? d.slice(2) : d.startsWith('0') ? d.slice(1) : d
    if (local.length !== 10 || !local.startsWith('3')) return digits
    return `+92 ${local.slice(0, 3)} ${local.slice(3)}`
  },
  timezone: 'Asia/Karachi',
  locale: 'en-PK',
}

export const LOCALES: Record<string, CountryLocale> = {
  Pakistan: PAKISTAN,
}

export const DEFAULT_LOCALE = PAKISTAN

export function localeFor(country: string | null | undefined): CountryLocale {
  return (country && LOCALES[country]) || DEFAULT_LOCALE
}

/** Rs. 1,250 · Rs. 45,800 · Rs. 1,250,000 */
export function formatMoney(amount: number | string | null | undefined, country?: string | null): string {
  const l = localeFor(country)
  if (amount === null || amount === undefined || amount === '') return `${l.currencySymbol} 0`
  const n = Number(amount)
  if (Number.isNaN(n)) return `${l.currencySymbol} 0`
  return `${l.currencySymbol} ` + n.toLocaleString(l.locale, { maximumFractionDigits: 0 })
}

/** +92 300 1234567 */
export function formatPhone(phone: string | null | undefined, country?: string | null): string {
  if (!phone) return '—'
  return localeFor(country).phoneFormat(phone)
}

/** Languages supported by the UI (Urdu planned). */
export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ur', label: 'Urdu (coming soon)', disabled: true },
] as const
