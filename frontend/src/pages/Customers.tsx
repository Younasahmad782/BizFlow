import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { api, apiErrorMessage } from '../lib/api'
import { formatPKR } from '../lib/format'
import { PAKISTAN_CITIES } from '../lib/pakistan'
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

export type CustomerType = 'RETAIL' | 'WHOLESALE' | 'CORPORATE'

export interface Customer {
  id: string
  name: string
  email: string | null
  phone: string | null
  address: string | null
  area: string | null
  city: string | null
  province: string | null
  customerType: CustomerType | null
  creditLimit: string | null
  openingBalance: string | null
  notes: string | null
  orderCount: number
  invoiceCount: number
  createdAt: string
}

interface ListResponse {
  data: Customer[]
  total: number
  take: number
  skip: number
}

const TYPE_LABEL: Record<CustomerType, string> = {
  RETAIL: 'Retail',
  WHOLESALE: 'Wholesale',
  CORPORATE: 'Corporate',
}

const TYPE_BADGE: Record<CustomerType, string> = {
  RETAIL: 'bg-sky-100 text-sky-800',
  WHOLESALE: 'bg-amber-100 text-amber-800',
  CORPORATE: 'bg-violet-100 text-violet-800',
}

const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'city', label: 'City' },
  { value: 'createdAt', label: 'Recently added' },
  { value: 'creditLimit', label: 'Credit limit' },
] as const

const EMPTY_FORM = {
  name: '',
  email: '',
  phone: '',
  address: '',
  area: '',
  city: 'Lahore',
  customerType: 'RETAIL' as CustomerType,
  creditLimit: '',
  openingBalance: '',
  notes: '',
}

function CustomerForm({
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
        email: form.email || undefined,
        phone: form.phone || undefined,
        address: form.address || undefined,
        area: form.area || undefined,
        notes: form.notes || undefined,
        creditLimit: form.creditLimit ? Number(form.creditLimit) : undefined,
        openingBalance: form.openingBalance ? Number(form.openingBalance) : undefined,
      }
      if (initial.id) {
        await api.patch(`/customers/${initial.id}`, payload)
      } else {
        await api.post('/customers', payload)
      }
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
          {initial.id ? 'Edit customer' : 'Add customer'}
        </h2>
        {error && (
          <div className="mb-4">
            <ErrorAlert message={error} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Full name *">
              <TextInput value={form.name} onChange={set('name')} placeholder="e.g. Ayesha Malik" />
            </Field>
          </div>
          <Field label="Customer type">
            <Select value={form.customerType} onChange={set('customerType')}>
              <option value="RETAIL">Retail</option>
              <option value="WHOLESALE">Wholesale</option>
              <option value="CORPORATE">Corporate</option>
            </Select>
          </Field>
          <Field label="Phone">
            <TextInput value={form.phone} onChange={set('phone')} placeholder="+92 300 1234567" />
          </Field>
          <Field label="Email">
            <TextInput
              value={form.email}
              onChange={set('email')}
              placeholder="customer@example.com"
            />
          </Field>
          <Field label="City">
            <Select value={form.city} onChange={set('city')}>
              {PAKISTAN_CITIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <div className="col-span-2">
            <Field label="Area">
              <TextInput value={form.area} onChange={set('area')} placeholder="e.g. Johar Town" />
            </Field>
          </div>
          <div className="col-span-2">
            <Field label="Address">
              <TextInput
                value={form.address}
                onChange={set('address')}
                placeholder="Street / house address"
              />
            </Field>
          </div>
          <Field label="Credit limit (PKR)">
            <TextInput
              value={form.creditLimit}
              onChange={set('creditLimit')}
              placeholder="50000"
              inputMode="decimal"
            />
          </Field>
          <Field label="Opening balance (PKR)">
            <TextInput
              value={form.openingBalance}
              onChange={set('openingBalance')}
              placeholder="0"
              inputMode="decimal"
            />
          </Field>
          <div className="col-span-2">
            <Field label="Notes">
              <textarea
                value={form.notes}
                onChange={set('notes')}
                rows={3}
                placeholder="Payment terms, delivery preferences…"
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
            {mutation.isPending ? 'Saving…' : initial.id ? 'Save changes' : 'Add customer'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}

export default function Customers() {
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [cityFilter, setCityFilter] = useState('')
  const [sortBy, setSortBy] = useState<string>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(0)
  const take = 12

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [deleting, setDeleting] = useState<Customer | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(0)
    }, 350)
    return () => clearTimeout(t)
  }, [search])

  const queryKey = ['customers', debouncedSearch, typeFilter, cityFilter, sortBy, sortDir, page]
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        take: String(take),
        skip: String(page * take),
        sortBy,
        sortDir,
      })
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (typeFilter) params.set('customerType', typeFilter)
      if (cityFilter) params.set('city', cityFilter)
      return (await api.get(`/customers?${params}`)).data as ListResponse
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/customers/${id}`),
    onSuccess: () => {
      setDeleting(null)
      queryClient.invalidateQueries({ queryKey: ['customers'] })
    },
  })

  const totalPages = data ? Math.ceil(data.total / take) : 0
  const hasFilters = debouncedSearch || typeFilter || cityFilter

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle={data ? `${data.total} customer${data.total === 1 ? '' : 's'}` : undefined}
        action={
          can('customers.create') ? (
            <PrimaryButton
              onClick={() => {
                setEditing(null)
                setFormOpen(true)
              }}
            >
              Add customer
            </PrimaryButton>
          ) : undefined
        }
      />

      {/* Search + filters */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <Field label="Search">
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, phone, email, city, area…"
            />
          </Field>
        </div>
        <div className="w-40">
          <Field label="Type">
            <Select
              value={typeFilter}
              onChange={(e) => {
                setTypeFilter(e.target.value)
                setPage(0)
              }}
            >
              <option value="">All types</option>
              <option value="RETAIL">Retail</option>
              <option value="WHOLESALE">Wholesale</option>
              <option value="CORPORATE">Corporate</option>
            </Select>
          </Field>
        </div>
        <div className="w-40">
          <Field label="City">
            <Select
              value={cityFilter}
              onChange={(e) => {
                setCityFilter(e.target.value)
                setPage(0)
              }}
            >
              <option value="">All cities</option>
              {PAKISTAN_CITIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-44">
          <Field label="Sort by">
            <Select
              value={`${sortBy}:${sortDir}`}
              onChange={(e) => {
                const [sb, sd] = e.target.value.split(':')
                setSortBy(sb)
                setSortDir(sd as 'asc' | 'desc')
                setPage(0)
              }}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={`${o.value}:asc`}>
                  {o.label} ↑
                </option>
              ))}
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={`${o.value}:desc`}>
                  {o.label} ↓
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {hasFilters && (
          <SecondaryButton
            onClick={() => {
              setSearch('')
              setTypeFilter('')
              setCityFilter('')
            }}
          >
            Clear
          </SecondaryButton>
        )}
      </div>

      {isLoading && (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      )}
      {isError && <ErrorAlert message={apiErrorMessage(error)} onRetry={() => refetch()} />}

      {!isLoading && !isError && data && (
        <>
          {data.data.length === 0 ? (
            hasFilters ? (
              <EmptyState
                title="No customers match your search"
                hint="Try a different name, phone number, or clear the filters."
                action={
                  <SecondaryButton
                    onClick={() => {
                      setSearch('')
                      setTypeFilter('')
                      setCityFilter('')
                    }}
                  >
                    Clear filters
                  </SecondaryButton>
                }
              />
            ) : (
              <EmptyState
                title="No customers yet"
                hint="Add your first customer to start tracking orders, invoices and payments."
                action={
                  can('customers.create') ? (
                    <PrimaryButton
                      onClick={() => {
                        setEditing(null)
                        setFormOpen(true)
                      }}
                    >
                      Add your first customer
                    </PrimaryButton>
                  ) : undefined
                }
              />
            )
          ) : (
            <>
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-slate-500">
                      <th className="px-4 py-3 font-medium">Customer</th>
                      <th className="px-4 py-3 font-medium">Type</th>
                      <th className="px-4 py-3 font-medium">Phone</th>
                      <th className="px-4 py-3 font-medium">City</th>
                      <th className="px-4 py-3 font-medium text-right">Credit limit</th>
                      <th className="px-4 py-3 font-medium text-right">Orders</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.data.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <Link
                            to={`/customers/${c.id}`}
                            className="font-medium text-brand-700 hover:underline"
                          >
                            {c.name}
                          </Link>
                          {c.area && <div className="text-xs text-slate-500">{c.area}</div>}
                        </td>
                        <td className="px-4 py-3">
                          {c.customerType ? (
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGE[c.customerType]}`}
                            >
                              {TYPE_LABEL[c.customerType]}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{c.phone ?? '—'}</td>
                        <td className="px-4 py-3 text-slate-600">{c.city ?? '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {c.creditLimit ? formatPKR(c.creditLimit) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{c.orderCount}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {can('customers.update') && (
                            <button
                              onClick={() => {
                                setEditing(c)
                                setFormOpen(true)
                              }}
                              className="text-sm text-brand-600 hover:underline mr-3"
                            >
                              Edit
                            </button>
                          )}
                          {can('customers.delete') && (
                            <button
                              onClick={() => setDeleting(c)}
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
                  <p className="text-sm text-slate-500">
                    Page {page + 1} of {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <SecondaryButton disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                      Previous
                    </SecondaryButton>
                    <SecondaryButton
                      disabled={page + 1 >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </SecondaryButton>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {formOpen && (
        <CustomerForm
          initial={
            editing
              ? {
                  id: editing.id,
                  name: editing.name,
                  email: editing.email ?? '',
                  phone: editing.phone ?? '',
                  address: editing.address ?? '',
                  area: editing.area ?? '',
                  city: editing.city ?? 'Lahore',
                  customerType: editing.customerType ?? 'RETAIL',
                  creditLimit: editing.creditLimit ?? '',
                  openingBalance: editing.openingBalance ?? '',
                  notes: editing.notes ?? '',
                }
              : {}
          }
          onClose={() => {
            setFormOpen(false)
            setEditing(null)
          }}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['customers'] })}
        />
      )}

      {deleting && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold mb-2">Delete customer?</h2>
            <p className="text-sm text-slate-600 mb-6">
              <span className="font-medium">{deleting.name}</span> will be removed from the
              customer list. Their order history is kept.
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
            {deleteMutation.isError && (
              <div className="mt-4">
                <ErrorAlert message={apiErrorMessage(deleteMutation.error)} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
