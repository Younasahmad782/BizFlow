import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { apiErrorMessage } from '../lib/api'
import { loginFormSchema, validateForm } from '../lib/forms'
import { ErrorAlert, Field, PrimaryButton, TextInput } from '../components/ui'

export default function Login() {
  const { login, pendingOrgs, selectOrganization } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const sessionExpired = searchParams.get('expired') === '1'
  const justReset = searchParams.get('reset') === '1'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selecting, setSelecting] = useState<string | null>(null)

  async function pickOrg(organizationId: string) {
    setError(null)
    setSelecting(organizationId)
    try {
      await selectOrganization(organizationId)
      navigate('/', { replace: true })
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setSelecting(null)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const errors = validateForm(loginFormSchema, { email, password })
    setFieldErrors(errors ?? {})
    if (errors) return
    setError(null)
    setBusy(true)
    try {
      await login(email.trim(), password)
      navigate('/', { replace: true })
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
        <p className="text-sm text-slate-500 mb-6">Sign in to your business workspace.</p>

        {sessionExpired && (
          <div className="mb-4 rounded-md bg-amber-50 border border-amber-200 p-3">
            <p className="text-sm text-amber-800">Your session expired. Please sign in again.</p>
          </div>
        )}
        {justReset && (
          <div className="mb-4 rounded-md bg-green-50 border border-green-200 p-3">
            <p className="text-sm text-green-800">Password reset. Sign in with your new password.</p>
          </div>
        )}
        {error && (
          <div className="mb-4">
            <ErrorAlert message={error} />
          </div>
        )}

        {pendingOrgs ? (
          <div className="space-y-2" role="group" aria-label="Choose a business">
            <p className="text-sm text-slate-600 mb-3">
              Your account belongs to several businesses. Choose one to continue.
            </p>
            {pendingOrgs.map((m) => (
              <button
                key={m.organizationId}
                type="button"
                onClick={() => pickOrg(m.organizationId)}
                disabled={selecting !== null}
                className="w-full text-left rounded-md border border-slate-200 px-4 py-3 hover:border-brand-400 hover:bg-brand-50 disabled:opacity-60 transition-colors"
              >
                <span className="block font-medium text-slate-900">{m.organizationName}</span>
                <span className="block text-xs text-slate-500 mt-0.5">
                  {selecting === m.organizationId ? 'Opening…' : `Role: ${m.roleName}`}
                </span>
              </button>
            ))}
          </div>
        ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Email" error={fieldErrors.email}>
            <TextInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="owner.1@example.com"
              autoComplete="email"
            />
          </Field>
          <Field label="Password" error={fieldErrors.password}>
            <TextInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </Field>
          <div className="flex justify-end">
            <Link to="/forgot-password" className="text-sm text-brand-600 hover:underline">
              Forgot password?
            </Link>
          </div>
          <PrimaryButton type="submit" disabled={busy} className="w-full">
            {busy ? 'Signing in…' : 'Sign in'}
          </PrimaryButton>
        </form>
        )}

        <p className="text-sm text-slate-500 mt-6 text-center">
          New here?{' '}
          <Link to="/register" className="font-medium text-brand-600 hover:underline">
            Create your business account
          </Link>
        </p>
      </div>
    </div>
  )
}
