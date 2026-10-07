import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, apiErrorMessage } from '../lib/api'
import { formatPKR, formatPKDate } from '../lib/format'
import {
  EmptyState,
  ErrorAlert,
  Field,
  PageHeader,
  SecondaryButton,
  Select,
  Spinner,
  TextInput,
} from '../components/ui'

interface InvoiceRow {
  id: string
  invoiceNumber: string
  status: string
  totalAmount: string
  issueDate: string
  dueDate: string | null
  customer: { id: string; name: string } | null
}

interface ListResponse {
  data: InvoiceRow[]
  total: number
  take: number
  skip: number
}

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  SENT: 'bg-blue-100 text-blue-800',
  PAID: 'bg-green-100 text-green-800',
  OVERDUE: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-600',
  PARTIALLY_PAID: 'bg-amber-100 text-amber-800',
}

export default function Invoices() {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(0)
  const take = 12

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(0)
    }, 350)
    return () => clearTimeout(t)
  }, [search])

  const queryKey = ['invoices', debouncedSearch, statusFilter, page]
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        take: String(take),
        skip: String(page * take),
      })
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (statusFilter) params.set('status', statusFilter)
      return (await api.get(`/invoices?${params}`)).data as ListResponse
    },
  })

  const totalPages = data ? Math.ceil(data.total / take) : 0
  const hasFilters = debouncedSearch || statusFilter

  return (
    <div>
      <PageHeader
        title="Invoices"
        subtitle={data ? `${data.total} invoice${data.total === 1 ? '' : 's'}` : undefined}
      />

      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <Field label="Search">
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Invoice number, e.g. INV-2026-0001"
            />
          </Field>
        </div>
        <div className="w-44">
          <Field label="Status">
            <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0) }}>
              <option value="">All statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="SENT">Sent</option>
              <option value="PAID">Paid</option>
              <option value="OVERDUE">Overdue</option>
              <option value="CANCELLED">Cancelled</option>
            </Select>
          </Field>
        </div>
        {hasFilters && (
          <SecondaryButton onClick={() => { setSearch(''); setStatusFilter('') }}>
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
              <EmptyState title="No invoices match" hint="Try a different search or clear the filters." />
            ) : (
              <EmptyState
                title="No invoices yet"
                hint="Invoices are created automatically when you confirm an order."
              />
            )
          ) : (
            <>
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-slate-500">
                      <th className="px-4 py-3 font-medium">Invoice</th>
                      <th className="px-4 py-3 font-medium">Customer</th>
                      <th className="px-4 py-3 font-medium text-right">Total</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Issued</th>
                      <th className="px-4 py-3 font-medium">Due</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.data.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <Link to={`/invoices/${inv.id}`} className="font-medium text-brand-700 hover:underline font-mono text-xs">
                            {inv.invoiceNumber}
                          </Link>
                        </td>
                        <td className="px-4 py-3">{inv.customer?.name ?? '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium">
                          {formatPKR(inv.totalAmount)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[inv.status] ?? 'bg-slate-100 text-slate-600'}`}>
                            {inv.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600 text-xs">{formatPKDate(inv.issueDate)}</td>
                        <td className="px-4 py-3 text-slate-600 text-xs">{formatPKDate(inv.dueDate)}</td>
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
    </div>
  )
}
