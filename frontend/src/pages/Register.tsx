import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { apiErrorMessage } from '../lib/api'
import { registerFormSchema, validateForm } from '../lib/forms'
import { PAKISTAN_CITIES } from '../lib/pakistan'
import { ErrorAlert, Field, PrimaryButton, Select, TextInput } from '../components/ui'

export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()

  const [fullName, setFullName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [city, setCity] = useState('Lahore')

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const values = { fullName, businessName, email, phone, password, confirmPassword, city }
    const errors = validateForm(registerFormSchema, values)
    setFieldErrors(errors ?? {})
    if (errors) return
    setError(null)
    setBusy(true)
    try {
      await register(businessName.trim(), fullName.trim(), email.trim(), password, city, 'Punjab', phone.trim())
      navigate('/', { replace: true })
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg p-8">
        <h1 className="text-2xl font-bold tracking-tight mb-1">
          BIZ<span className="text-brand-600">FLOW</span>
        </h1>
        <p className="text-sm text-slate-500 mb-6">
          Create your organization workspace. Country: Pakistan.
        </p>

        {error && (
          <div className="mb-4">
            <ErrorAlert message={error} />
          </div>
        )}

        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Full name" error={fieldErrors.fullName}>
            <TextInput
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Muhammad Hamza"
              autoComplete="name"
            />
          </Field>
          <Field label="Business name" error={fieldErrors.businessName}>
            <TextInput
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. Al-Noor General Store"
              autoComplete="organization"
            />
          </Field>
          <Field label="Email" error={fieldErrors.email}>
            <TextInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </Field>
          <Field label="Phone" error={fieldErrors.phone}>
            <TextInput
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+92 300 1234567"
              autoComplete="tel"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Password" error={fieldErrors.password}>
              <TextInput
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 chars, letter + number"
                autoComplete="new-password"
              />
            </Field>
            <Field label="Confirm password" error={fieldErrors.confirmPassword}>
              <TextInput
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                autoComplete="new-password"
              />
            </Field>
          </div>
          <Field label="City" error={fieldErrors.city}>
            <Select value={city} onChange={(e) => setCity(e.target.value)}>
              {PAKISTAN_CITIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <PrimaryButton type="submit" disabled={busy} className="w-full">
            {busy ? 'Creating…' : 'Create account'}
          </PrimaryButton>
        </form>

        <p className="text-sm text-slate-500 mt-6 text-center">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
