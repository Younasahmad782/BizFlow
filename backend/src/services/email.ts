/**
 * Email delivery abstraction for transactional mail (password resets, …).
 *
 * Production MUST set EMAIL_PROVIDER to a real provider and wire it here —
 * no provider is hard-coded. The built-in modes are:
 *   - 'console' (development default): prints a one-line notice WITHOUT
 *     any secret. Useful for local development and automated tests.
 *   - 'none' (production default): mail is disabled; callers get a clear
 *     error in the logs and the API keeps its generic response (no user
 *     enumeration), so deploys fail safe rather than leaking tokens.
 *
 * To add a real provider (SMTP, Resend, SendGrid, …) implement
 * EmailProvider and register it in getEmailProvider().
 */

export interface PasswordResetEmail {
  to: string
  name: string
  /** Full reset URL the user clicks. Contains the secret token. */
  resetUrl: string
}

export interface EmailProvider {
  readonly name: string
  sendPasswordReset(input: PasswordResetEmail): Promise<void>
}

class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console'
  async sendPasswordReset(input: PasswordResetEmail): Promise<void> {
    // NEVER print the reset URL/token here — it is a credential.
    console.log(
      `[email:console] password-reset email → ${input.to} (reset link omitted from logs)`,
    )
  }
}

class DisabledEmailProvider implements EmailProvider {
  readonly name = 'none'
  async sendPasswordReset(input: PasswordResetEmail): Promise<void> {
    console.error(
      `[email:none] password-reset requested for ${input.to} but no EMAIL_PROVIDER is configured — ` +
        'set EMAIL_PROVIDER and FRONTEND_URL to enable reset emails',
    )
  }
}

let cached: EmailProvider | null = null

export function getEmailProvider(): EmailProvider {
  if (cached) return cached
  const configured = (process.env.EMAIL_PROVIDER ?? '').toLowerCase()
  if (configured === 'none') {
    cached = new DisabledEmailProvider()
  } else if (configured === 'console') {
    cached = new ConsoleEmailProvider()
  } else if (process.env.NODE_ENV === 'production') {
    // Production must opt in explicitly — never fall back to console logging.
    cached = new DisabledEmailProvider()
  } else {
    cached = new ConsoleEmailProvider()
  }
  return cached
}

/** For tests: reset the cached provider after changing env. */
export function resetEmailProvider(): void {
  cached = null
}

export function frontendUrl(): string {
  return process.env.FRONTEND_URL ?? 'http://localhost:5173'
}
