import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, apiErrorMessage } from '../lib/api'
import { forgotPasswordFormSchema, validateForm } from '../lib/forms'
import { ErrorAlert, Field, PrimaryButton, TextInput } from '../components/ui'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const errors = validateForm(forgotPasswordFormSchema, { email })
    setFieldErrors(errors ?? {})
    if (errors) return
    setError(null)
    setBusy(true)
    try {
      await api.post('/auth/forgot-password', { email: email.trim() })
      setSent(true)
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-lg p-8">
        <h1 className="text-2xl font-bold tracking-tight mb-1">
          BIZ<span className="text-brand-600">FLOW</span>
        </h1>
        <p className="text-sm text-slate-500 mb-6">Reset your password.</p>

        {sent ? (
          <div className="rounded-md bg-green-50 border border-green-200 p-4">
            <p className="text-sm text-green-800 font-medium">Check your inbox</p>
            <p className="text-sm text-green-700 mt-1">
              If an account exists for {email}, a password reset link has been sent.
              It expires in 1 hour.
            </p>
            <Link to="/login" className="text-sm font-medium text-brand-600 hover:underline mt-3 inline-block">
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            {error && (
              <div className="mb-4">
                <ErrorAlert message={error} />
              </div>
            )}
            <form onSubmit={submit} className="space-y-4" noValidate>
              <Field label="Email" error={fieldErrors.email}>
                <TextInput
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                />
              </Field>
              <PrimaryButton type="submit" disabled={busy} className="w-full">
                {busy ? 'Sending…' : 'Send reset link'}
              </PrimaryButton>
            </form>
            <p className="text-sm text-slate-500 mt-6 text-center">
              <Link to="/login" className="font-medium text-brand-600 hover:underline">
                Back to sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
