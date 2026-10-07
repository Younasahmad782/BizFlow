import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { api, apiErrorMessage } from '../lib/api'
import { changePasswordFormSchema, validateForm } from '../lib/forms'
import { LANGUAGES, formatPhone } from '../lib/locale'
import {
  ErrorAlert,
  Field,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  Select,
  Spinner,
  TextInput,
} from '../components/ui'

function ChangePasswordCard() {
  const { logout } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const errors = validateForm(changePasswordFormSchema, {
      currentPassword,
      newPassword,
      confirmPassword,
    })
    setFieldErrors(errors ?? {})
    if (errors) return
    setError(null)
    setBusy(true)
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword })
      setDone(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      // password change bumps the token version; re-login for a fresh session
      setTimeout(() => logout(), 2500)
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6 max-w-lg">
      <h3 className="font-semibold mb-1">Change password</h3>
      <p className="text-sm text-slate-500 mb-4">You will be signed out on other devices.</p>
      {done && (
        <div className="mb-4 rounded-md bg-green-50 border border-green-200 p-3">
          <p className="text-sm text-green-800">Password changed. Taking you to sign in…</p>
        </div>
      )}
      {error && (
        <div className="mb-4">
          <ErrorAlert message={error} />
        </div>
      )}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Current password" error={fieldErrors.currentPassword}>
          <TextInput
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        <Field label="New password" error={fieldErrors.newPassword}>
          <TextInput
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Min. 8 chars, letter + number"
            autoComplete="new-password"
          />
        </Field>
        <Field label="Confirm new password" error={fieldErrors.confirmPassword}>
          <TextInput
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? 'Changing…' : 'Change password'}
        </PrimaryButton>
      </form>
    </div>
  )
}

interface BusinessProfile {
  id: string
  name: string
  address: string | null
  city: string | null
  province: string | null
  country: string
  phone: string | null
  email: string | null
  website: string | null
  category: string | null
}

interface BusinessSettings {
  currency: string
  timezone: string
  language: string
  taxRate: string
  invoicePrefix: string
  orderPrefix: string
}

function BusinessProfileCard({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'profile'],
    queryFn: async () => (await api.get('/settings/profile')).data as BusinessProfile,
  })
  const [form, setForm] = useState<Partial<BusinessProfile> | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const current = form ?? data
  const set = (k: keyof BusinessProfile, v: string) => {
    setForm({ ...(current ?? {}), [k]: v })
    setSaved(false)
  }

  const save = useMutation({
    mutationFn: async () => (await api.patch('/settings/profile', form)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'profile'] })
      setForm(null)
      setSaved(true)
      setError('')
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6 max-w-2xl">
      <h3 className="font-semibold mb-1">Business profile</h3>
      <p className="text-sm text-slate-500 mb-4">
        Shown on invoices and across the workspace.
      </p>
      {isLoading && <Spinner />}
      {current && !isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Business name">
            <TextInput value={current.name ?? ''} onChange={(e) => set('name', e.target.value)} disabled={!canManage} />
          </Field>
          <Field label="Phone">
            <TextInput
              value={current.phone ?? ''}
              onChange={(e) => set('phone', e.target.value)}
              placeholder="+92 300 1234567"
              disabled={!canManage}
            />
          </Field>
          <div className="md:col-span-2">
            <Field label="Address">
              <TextInput value={current.address ?? ''} onChange={(e) => set('address', e.target.value)} placeholder="Main Bazaar Road" disabled={!canManage} />
            </Field>
          </div>
          <Field label="City">
            <TextInput value={current.city ?? ''} onChange={(e) => set('city', e.target.value)} placeholder="Lahore" disabled={!canManage} />
          </Field>
          <Field label="Province">
            <TextInput value={current.province ?? ''} onChange={(e) => set('province', e.target.value)} placeholder="Punjab" disabled={!canManage} />
          </Field>
          <Field label="Country">
            <TextInput value={current.country ?? ''} onChange={(e) => set('country', e.target.value)} disabled={!canManage} />
          </Field>
          <Field label="Email">
            <TextInput value={current.email ?? ''} onChange={(e) => set('email', e.target.value)} disabled={!canManage} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Website">
              <TextInput
                value={current.website ?? ''}
                onChange={(e) => set('website', e.target.value)}
                placeholder="https://example.com"
                disabled={!canManage}
              />
            </Field>
          </div>
        </div>
      )}
      {canManage && form && (
        <div className="flex items-center gap-3 mt-4">
          <PrimaryButton disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save profile'}
          </PrimaryButton>
          <SecondaryButton onClick={() => setForm(null)}>Cancel</SecondaryButton>
        </div>
      )}
      {saved && <p className="text-sm text-green-700 mt-3">Profile saved.</p>}
      {error && <div className="mt-3"><ErrorAlert message={error} /></div>}
      {!canManage && (
        <p className="text-xs text-slate-500 mt-3">
          Phone on file: {formatPhone(data?.phone)}
        </p>
      )}
    </div>
  )
}

function LocalizationCard({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get('/settings')).data as BusinessSettings,
  })
  const [form, setForm] = useState<Partial<BusinessSettings> | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const current = form ?? data
  const set = (k: keyof BusinessSettings, v: string) => {
    setForm({ ...(current ?? {}), [k]: v })
    setSaved(false)
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = { ...form }
      if (payload.taxRate !== undefined) payload.taxRate = Number(payload.taxRate)
      return (await api.patch('/settings', payload)).data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      setForm(null)
      setSaved(true)
      setError('')
    },
    onError: (e) => setError(apiErrorMessage(e)),
  })

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6 max-w-2xl">
      <h3 className="font-semibold mb-1">Localization &amp; tax</h3>
      <p className="text-sm text-slate-500 mb-4">
        Defaults: Pakistan · PKR · Asia/Karachi · English.
      </p>
      {isLoading && <Spinner />}
      {current && !isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Country">
            <TextInput value="Pakistan" disabled />
          </Field>
          <Field label="Currency">
            <TextInput value={current.currency ?? ''} onChange={(e) => set('currency', e.target.value.toUpperCase())} maxLength={3} disabled={!canManage} />
          </Field>
          <Field label="Timezone">
            <TextInput value={current.timezone ?? ''} onChange={(e) => set('timezone', e.target.value)} disabled={!canManage} />
          </Field>
          <Field label="Language">
            <Select value={current.language ?? 'en'} onChange={(e) => set('language', e.target.value)} disabled={!canManage}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code} disabled={'disabled' in l && l.disabled}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Default tax rate (%)">
            <TextInput
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={current.taxRate ?? ''}
              onChange={(e) => set('taxRate', e.target.value)}
              disabled={!canManage}
            />
          </Field>
          <Field label="Invoice prefix">
            <TextInput value={current.invoicePrefix ?? ''} onChange={(e) => set('invoicePrefix', e.target.value)} disabled={!canManage} />
          </Field>
        </div>
      )}
      {canManage && form && (
        <div className="flex items-center gap-3 mt-4">
          <PrimaryButton disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save settings'}
          </PrimaryButton>
          <SecondaryButton onClick={() => setForm(null)}>Cancel</SecondaryButton>
        </div>
      )}
      {saved && <p className="text-sm text-green-700 mt-3">Settings saved.</p>}
      {error && <div className="mt-3"><ErrorAlert message={error} /></div>}
    </div>
  )
}

export default function Settings() {
  const { member, organization, can } = useAuth()
  const canManage = can('settings.manage')
  return (
    <div>
      <PageHeader title="Settings" subtitle="Workspace and account settings." />
      <div className="space-y-6">
        <BusinessProfileCard canManage={canManage} />
        <LocalizationCard canManage={canManage} />
        <div className="bg-white border border-slate-200 rounded-lg p-6 max-w-lg">
          <h3 className="font-semibold mb-1">Organization</h3>
          <dl className="text-sm space-y-1 mt-2">
            <div className="flex justify-between">
              <dt className="text-slate-500">Name</dt>
              <dd className="font-medium">{organization?.name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">City</dt>
              <dd className="font-medium">{organization?.city ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Your role</dt>
              <dd className="font-medium">{member?.role.name}</dd>
            </div>
          </dl>
        </div>
        <ChangePasswordCard />
      </div>
    </div>
  )
}
