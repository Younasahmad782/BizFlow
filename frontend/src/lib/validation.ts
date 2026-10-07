/** Pakistani mobile: +92 300 1234567, 0300-1234567, 03001234567, +923001234567 */
export function isValidPakistaniPhone(value: string): boolean {
  return /^(?:\+92|0)?\s*3\d{2}[\s-]?\d{7}$/.test(value.trim())
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}
