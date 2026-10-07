import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { api, apiErrorMessage } from '../lib/api'
import {
  EmptyState,
  ErrorAlert,
  Field,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  Select,
  Spinner,
  TextInput,
} from '../components/ui'

export interface Supplier {
  id: string
  name: string
  company: string | null
  contactPerson: string | null
  email: string | null
  phone: string | null
  address: string | null
  city: string | null
  province: string | null
  taxNumber: string | null
  paymentTerms: string | null
  openingBalance: string | null
  notes: string | null
  isActive: boolean
  _count?: { products: number; purchases: number }
}

interface ListResponse {
  data: Supplier[]
  total: number
  take: number
  skip: number
}

const EMPTY_FORM = {
  name: '',
  company: '',
  contactPerson: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  province: 'Punjab',
  taxNumber: '',
  paymentTerms: 'Net 30',
  openingBalance: '',
  notes: '',
  isActive: 'true',
}

function SupplierForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: Partial<typeof EMPTY_FORM> & { id?: string }
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initial })
  const [error, setError] = useState<string | null>(null)
  const set =
    (k: keyof typeof EMPTY_FORM) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }))

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        company: form.company || undefined,
        contactPerson: form.contactPerson || undefined,
        email: form.email || undefined,
        phone: form.phone || undefined,
        address: form.address || undefined,
        city: form.city || undefined,
        taxNumber: form.taxNumber || undefined,
        paymentTerms: form.paymentTerms || undefined,
        openingBalance: form.openingBalance ? Number(form.openingBalance) : undefined,
        notes: form.notes || undefined,
        isActive: form.isActive === 'true',
      }
      if (initial.id) await api.patch(`/suppliers/${initial.id}`, payload)
      else await api.post('/suppliers', payload)
    },
    onSuccess: () => {
      onSaved()
      onClose()
    },
    onError: (err) => setError(apiErrorMessage(err)),
  })

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
        <h2 className="text-lg font-semibold mb-4">
          {initial.id ? 'Edit supplier' : 'Add supplier'}
        </h2>
        {error && (
          <div className="mb-4">
            <ErrorAlert message={error} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Supplier name *">
            <TextInput value={form.name} onChange={set('name')} placeholder="e.g. Pak Traders" />
          </Field>
          <Field label="Company">
            <TextInput value={form.company} onChange={set('company')} placeholder="e.g. Pak Traders (Pvt.) Ltd." />
          </Field>
          <Field label="Contact person">
            <TextInput value={form.contactPerson} onChange={set('contactPerson')} placeholder="e.g. Imran Sheikh" />
          </Field>
          <Field label="Phone">
            <TextInput value={form.phone} onChange={set('phone')} placeholder="0300-1234567" />
          </Field>
          <Field label="Email">
            <TextInput value={form.email} onChange={set('email')} placeholder="contact@example.com" />
          </Field>
          <Field label="City">
            <TextInput value={form.city} onChange={set('city')} placeholder="e.g. Lahore" />
          </Field>
          <div className="col-span-2">
            <Field label="Address">
              <TextInput value={form.address} onChange={set('address')} placeholder="Shop/plot, market, road" />
            </Field>
          </div>
          <Field label="Tax / registration no.">
            <TextInput value={form.taxNumber} onChange={set('taxNumber')} placeholder="NTN / STRN (if applicable)" />
          </Field>
          <Field label="Payment terms">
            <Select value={form.paymentTerms} onChange={set('paymentTerms')}>
              {['Advance', 'Net 7', 'Net 15', 'Net 30', 'Net 45', 'Net 60', 'Weekly', 'Monthly'].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </Field>
          <Field label="Opening balance (PKR)">
            <TextInput value={form.openingBalance} onChange={set('openingBalance')} placeholder="0" inputMode="decimal" />
          </Field>
          <Field label="Status">
            <Select value={form.isActive} onChange={set('isActive')}>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </Select>
          </Field>
          <div className="col-span-2">
            <Field label="Notes">
              <textarea
                value={form.notes}
                onChange={set('notes')}
                rows={2}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </Field>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !form.name.trim()}
          >
            {mutation.isPending ? 'Saving…' : initial.id ? 'Save changes' : 'Add supplier'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}

export default function Suppliers() {
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [cityFilter, setCityFilter] = useState('')
  const [page, setPage] = useState(0)
  const take = 12

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [deleting, setDeleting] = useState<Supplier | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(0)
    }, 350)
    return () => clearTimeout(t)
  }, [search])

  const queryKey = ['suppliers', debouncedSearch, cityFilter, page]
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        take: String(take),
        skip: String(page * take),
      })
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (cityFilter) params.set('city', cityFilter)
      return (await api.get(`/suppliers?${params}`)).data as ListResponse
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/suppliers/${id}`),
    onSuccess: () => {
      setDeleting(null)
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
    },
  })

  const totalPages = data ? Math.ceil(data.total / take) : 0
  const hasFilters = debouncedSearch || cityFilter

  return (
    <div>
      <PageHeader
        title="Suppliers"
        subtitle={data ? `${data.total} supplier${data.total === 1 ? '' : 's'}` : undefined}
        action={
          can('products.create') ? (
            <PrimaryButton onClick={() => { setEditing(null); setFormOpen(true) }}>
              Add supplier
            </PrimaryButton>
          ) : undefined
        }
      />

      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <Field label="Search">
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, company, phone, city…"
            />
          </Field>
        </div>
        <div className="w-44">
          <Field label="City">
            <TextInput
              value={cityFilter}
              onChange={(e) => { setCityFilter(e.target.value); setPage(0) }}
              placeholder="Filter by city"
            />
          </Field>
        </div>
        {hasFilters && (
          <SecondaryButton onClick={() => { setSearch(''); setCityFilter('') }}>
            Clear
          </SecondaryButton>
        )}
      </div>

      {isLoading && <div className="flex justify-center py-16"><Spinner /></div>}
      {isError && <ErrorAlert message={apiErrorMessage(error)} onRetry={() => refetch()} />}

      {!isLoading && !isError && data && (
        <>
          {data.data.length === 0 ? (
            hasFilters ? (
              <EmptyState title="No suppliers match" hint="Try a different search or clear the filters." />
            ) : (
              <EmptyState
                title="No suppliers yet"
                hint="Add suppliers to track who you buy stock from and what you owe them."
                action={can('products.create') ? (
                  <PrimaryButton onClick={() => { setEditing(null); setFormOpen(true) }}>
                    Add your first supplier
                  </PrimaryButton>
                ) : undefined}
              />
            )
          ) : (
            <>
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-slate-500">
                      <th className="px-4 py-3 font-medium">Supplier</th>
                      <th className="px-4 py-3 font-medium">Contact</th>
                      <th className="px-4 py-3 font-medium">City</th>
                      <th className="px-4 py-3 font-medium">Terms</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.data.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <Link to={`/suppliers/${s.id}`} className="font-medium text-brand-700 hover:underline">
                            {s.name}
                          </Link>
                          <div className="text-xs text-slate-500">
                            {[s.company, s._count ? `${s._count.products} products` : null].filter(Boolean).join(' · ')}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          <div>{s.contactPerson ?? '—'}</div>
                          <div className="text-xs">{s.phone ?? ''}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{s.city ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-600 text-xs">{s.paymentTerms ?? '—'}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {can('products.update') && (
                            <button
                              onClick={() => { setEditing(s); setFormOpen(true) }}
                              className="text-sm text-brand-600 hover:underline mr-3"
                            >
                              Edit
                            </button>
                          )}
                          {can('products.delete') && (
                            <button
                              onClick={() => setDeleting(s)}
                              className="text-sm text-red-600 hover:underline"
                            >
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-sm text-slate-500">Page {page + 1} of {totalPages}</p>
                  <div className="flex gap-2">
                    <SecondaryButton disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</SecondaryButton>
                    <SecondaryButton disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</SecondaryButton>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {formOpen && (
        <SupplierForm
          initial={editing ? {
            id: editing.id,
            name: editing.name,
            company: editing.company ?? '',
            contactPerson: editing.contactPerson ?? '',
            email: editing.email ?? '',
            phone: editing.phone ?? '',
            address: editing.address ?? '',
            city: editing.city ?? '',
            province: editing.province ?? 'Punjab',
            taxNumber: editing.taxNumber ?? '',
            paymentTerms: editing.paymentTerms ?? 'Net 30',
            openingBalance: editing.openingBalance ?? '',
            notes: editing.notes ?? '',
            isActive: editing.isActive ? 'true' : 'false',
          } : {}}
          onClose={() => { setFormOpen(false); setEditing(null) }}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['suppliers'] })}
        />
      )}

      {deleting && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold mb-2">Delete supplier?</h2>
            <p className="text-sm text-slate-600 mb-6">
              <span className="font-medium">{deleting.name}</span> will be removed. Past
              purchases and payment history are kept.
            </p>
            <div className="flex justify-end gap-2">
              <SecondaryButton onClick={() => setDeleting(null)}>Cancel</SecondaryButton>
              <button
                onClick={() => deleteMutation.mutate(deleting.id)}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
