import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, apiErrorMessage } from '../lib/api'
import { resetPasswordFormSchema, validateForm } from '../lib/forms'
import { ErrorAlert, Field, PrimaryButton, TextInput } from '../components/ui'

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const token = searchParams.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const errors = validateForm(resetPasswordFormSchema, { password, confirmPassword })
    setFieldErrors(errors ?? {})
    if (errors) return
    setError(null)
    setBusy(true)
    try {
      await api.post('/auth/reset-password', { token, password })
      navigate('/login?reset=1', { replace: true })
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-sm bg-white border border-slate-200 rounded-lg p-8 text-center">
          <p className="font-medium text-slate-700">Invalid reset link</p>
          <p className="text-sm text-slate-500 mt-1 mb-4">
            This link is missing its token. Request a new one.
          </p>
          <Link to="/forgot-password" className="text-sm font-medium text-brand-600 hover:underline">
            Request reset link
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-lg p-8">
        <h1 className="text-2xl font-bold tracking-tight mb-1">
          BIZ<span className="text-brand-600">FLOW</span>
        </h1>
        <p className="text-sm text-slate-500 mb-6">Choose a new password.</p>

        {error && (
          <div className="mb-4">
            <ErrorAlert message={error} />
          </div>
        )}

        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="New password" error={fieldErrors.password}>
            <TextInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 chars, letter + number"
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirm new password" error={fieldErrors.confirmPassword}>
            <TextInput
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat new password"
              autoComplete="new-password"
            />
          </Field>
          <PrimaryButton type="submit" disabled={busy} className="w-full">
            {busy ? 'Resetting…' : 'Reset password'}
          </PrimaryButton>
        </form>
      </div>
    </div>
  )
}
