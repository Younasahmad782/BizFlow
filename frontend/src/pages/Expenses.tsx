import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, apiErrorMessage } from '../lib/api'
import { formatPKR, formatPKDate } from '../lib/format'
import {
  DangerButton,
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

interface Category {
  id: string
  name: string
}

interface ExpenseRow {
  id: string
  categoryId: string | null
  category: Category | null
  description: string | null
  amount: string
  expenseDate: string
}

interface ListResponse {
  data: ExpenseRow[]
  total: number
  totalAmount: number
  take: number
  skip: number
}

interface MonthlyRow {
  month: string
  label: string
  total: number
}

function toInputDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function ExpenseModal({
  expense,
  categories,
  onClose,
}: {
  expense: ExpenseRow | null
  categories: Category[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    categoryId: expense?.categoryId ?? '',
    description: expense?.description ?? '',
    amount: expense?.amount ?? '',
    expenseDate: expense ? toInputDate(new Date(expense.expenseDate)) : toInputDate(new Date()),
  })
  const [serverError, setServerError] = useState('')

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        categoryId: form.categoryId || undefined,
        description: form.description || undefined,
        amount: Number(form.amount),
        expenseDate: new Date(form.expenseDate),
      }
      if (expense) return (await api.patch(`/expenses/${expense.id}`, payload)).data
      return (await api.post('/expenses', payload)).data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] })
      onClose()
    },
    onError: (e) => setServerError(apiErrorMessage(e)),
  })

  const valid = form.amount !== '' && Number(form.amount) > 0 && form.expenseDate !== ''

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-4">{expense ? 'Edit expense' : 'Record expense'}</h2>
        <div className="space-y-4">
          <Field label="Category">
            <Select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">— Select category —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Description">
            <TextInput
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="e.g. Monthly shop rent"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount (Rs.)">
              <TextInput
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="85000"
              />
            </Field>
            <Field label="Date">
              <TextInput
                type="date"
                value={form.expenseDate}
                onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
              />
            </Field>
          </div>
          {serverError && <ErrorAlert message={serverError} />}
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : expense ? 'Save changes' : 'Record expense'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}

export default function Expenses() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(0)
  const [modal, setModal] = useState<'closed' | 'new' | ExpenseRow>('closed')
  const [deleting, setDeleting] = useState<ExpenseRow | null>(null)
  const take = 15

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(0)
    }, 350)
    return () => clearTimeout(t)
  }, [search])

  const resetFilters = () => {
    setSearch('')
    setCategoryFilter('')
    setFrom('')
    setTo('')
    setPage(0)
  }

  const queryKey = ['expenses', debouncedSearch, categoryFilter, from, to, page]
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({ take: String(take), skip: String(page * take) })
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (categoryFilter) params.set('categoryId', categoryFilter)
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      return (await api.get(`/expenses?${params}`)).data as ListResponse
    },
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: async () => (await api.get('/expenses/categories')).data as Category[],
  })

  const { data: monthly = [] } = useQuery({
    queryKey: ['expenses', 'monthly'],
    queryFn: async () => (await api.get('/expenses/monthly')).data as MonthlyRow[],
  })

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/expenses/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] })
      setDeleting(null)
    },
  })

  const totalPages = data ? Math.ceil(data.total / take) : 0
  const hasFilters = debouncedSearch || categoryFilter || from || to

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle={data ? `${formatPKR(data.totalAmount)} across ${data.total} record${data.total === 1 ? '' : 's'}` : undefined}
        action={<PrimaryButton onClick={() => setModal('new')}>Record expense</PrimaryButton>}
      />

      {/* Monthly summary */}
      {monthly.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Monthly summary</h3>
          <div className="flex gap-4 overflow-x-auto pb-1">
            {monthly.slice(-6).map((m) => (
              <div key={m.month} className="min-w-[110px]">
                <p className="text-xs text-slate-500">{m.label}</p>
                <p className="font-semibold tabular-nums">{formatPKR(m.total)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[180px]">
          <Field label="Search">
            <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search description…" />
          </Field>
        </div>
        <div className="w-44">
          <Field label="Category">
            <Select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(0) }}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-40">
          <Field label="From">
            <TextInput type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0) }} />
          </Field>
        </div>
        <div className="w-40">
          <Field label="To">
            <TextInput type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0) }} />
          </Field>
        </div>
        {hasFilters && <SecondaryButton onClick={resetFilters}>Clear</SecondaryButton>}
      </div>

      {isLoading && <div className="flex justify-center py-16"><Spinner /></div>}
      {isError && <ErrorAlert message={apiErrorMessage(error)} onRetry={() => refetch()} />}

      {!isLoading && !isError && data && (
        <>
          {data.data.length === 0 ? (
            hasFilters ? (
              <EmptyState title="No expenses match" hint="Try a different search or clear the filters." />
            ) : (
              <EmptyState
                title="No expenses recorded"
                hint="Track rent, utilities, salaries and other business costs."
                action={<PrimaryButton onClick={() => setModal('new')}>Record your first expense</PrimaryButton>}
              />
            )
          ) : (
            <>
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-slate-500">
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Description</th>
                      <th className="px-4 py-3 font-medium">Category</th>
                      <th className="px-4 py-3 font-medium text-right">Amount</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.data.map((e) => (
                      <tr key={e.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-600 text-xs whitespace-nowrap">{formatPKDate(e.expenseDate)}</td>
                        <td className="px-4 py-3">{e.description || '—'}</td>
                        <td className="px-4 py-3">
                          <span className="inline-block px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-700">
                            {e.category?.name ?? 'Uncategorized'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium">{formatPKR(e.amount)}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button
                            className="text-brand-600 hover:underline text-xs mr-3"
                            onClick={() => setModal(e)}
                          >
                            Edit
                          </button>
                          <button
                            className="text-red-600 hover:underline text-xs"
                            onClick={() => setDeleting(e)}
                          >
                            Delete
                          </button>
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

      {modal !== 'closed' && (
        <ExpenseModal
          expense={modal === 'new' ? null : modal}
          categories={categories}
          onClose={() => setModal('closed')}
        />
      )}

      {deleting && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold mb-2">Delete expense?</h2>
            <p className="text-sm text-slate-600 mb-6">
              “{deleting.description || 'Untitled expense'}” — {formatPKR(deleting.amount)} will be removed.
            </p>
            <div className="flex justify-end gap-2">
              <SecondaryButton onClick={() => setDeleting(null)}>Cancel</SecondaryButton>
              <DangerButton disabled={del.isPending} onClick={() => del.mutate(deleting.id)}>
                {del.isPending ? 'Deleting…' : 'Delete'}
              </DangerButton>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
