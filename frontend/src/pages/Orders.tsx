import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { api, apiErrorMessage } from '../lib/api'
import { formatPKR, formatPKDate } from '../lib/format'
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

export type OrderStatus = 'DRAFT' | 'CONFIRMED' | 'PROCESSING' | 'COMPLETED' | 'CANCELLED' | 'RETURNED'
export type PaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'REFUNDED'

export interface Order {
  id: string
  orderNumber: string
  status: OrderStatus
  paymentStatus: PaymentStatus
  subtotal: string
  discountAmount: string
  taxAmount: string
  totalAmount: string
  paidAmount: string
  orderDate: string
  customer: { id: string; name: string } | null
  _count?: { items: number }
}

interface ListResponse {
  data: Order[]
  total: number
  take: number
  skip: number
}

export const STATUS_BADGE: Record<OrderStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  CONFIRMED: 'bg-blue-100 text-blue-800',
  PROCESSING: 'bg-amber-100 text-amber-800',
  COMPLETED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-700',
  RETURNED: 'bg-purple-100 text-purple-800',
}

export const PAYMENT_BADGE: Record<PaymentStatus, string> = {
  UNPAID: 'bg-red-100 text-red-700',
  PARTIALLY_PAID: 'bg-amber-100 text-amber-800',
  PAID: 'bg-green-100 text-green-800',
  REFUNDED: 'bg-slate-100 text-slate-600',
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  DRAFT: 'Draft',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  RETURNED: 'Returned',
}

export const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  UNPAID: 'Unpaid',
  PARTIALLY_PAID: 'Partially paid',
  PAID: 'Paid',
  REFUNDED: 'Refunded',
}

export default function Orders() {
  const { can } = useAuth()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  const [page, setPage] = useState(0)
  const take = 12

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(0)
    }, 350)
    return () => clearTimeout(t)
  }, [search])

  const queryKey = ['orders', debouncedSearch, statusFilter, paymentFilter, page]
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        take: String(take),
        skip: String(page * take),
      })
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (statusFilter) params.set('status', statusFilter)
      if (paymentFilter) params.set('paymentStatus', paymentFilter)
      return (await api.get(`/orders?${params}`)).data as ListResponse
    },
  })

  const totalPages = data ? Math.ceil(data.total / take) : 0
  const hasFilters = debouncedSearch || statusFilter || paymentFilter

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle={data ? `${data.total} order${data.total === 1 ? '' : 's'}` : undefined}
        action={
          can('orders.create') ? (
            <Link to="/orders/new">
              <PrimaryButton>Create order</PrimaryButton>
            </Link>
          ) : undefined
        }
      />

      <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <Field label="Search">
            <TextInput
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Order number, e.g. ORD-2026-0001"
            />
          </Field>
        </div>
        <div className="w-44">
          <Field label="Status">
            <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0) }}>
              <option value="">All statuses</option>
              {(Object.keys(STATUS_LABEL) as OrderStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-44">
          <Field label="Payment">
            <Select value={paymentFilter} onChange={(e) => { setPaymentFilter(e.target.value); setPage(0) }}>
              <option value="">All</option>
              {(Object.keys(PAYMENT_LABEL) as PaymentStatus[]).map((s) => (
                <option key={s} value={s}>{PAYMENT_LABEL[s]}</option>
              ))}
            </Select>
          </Field>
        </div>
        {hasFilters && (
          <SecondaryButton onClick={() => { setSearch(''); setStatusFilter(''); setPaymentFilter('') }}>
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
              <EmptyState title="No orders match" hint="Try a different search or clear the filters." />
            ) : (
              <EmptyState
                title="No orders yet"
                hint="Create your first order — pick a customer, add products, confirm to deduct stock and generate the invoice."
                action={can('orders.create') ? (
                  <Link to="/orders/new">
                    <PrimaryButton>Create your first order</PrimaryButton>
                  </Link>
                ) : undefined}
              />
            )
          ) : (
            <>
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-slate-500">
                      <th className="px-4 py-3 font-medium">Order</th>
                      <th className="px-4 py-3 font-medium">Customer</th>
                      <th className="px-4 py-3 font-medium text-right">Total</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Payment</th>
                      <th className="px-4 py-3 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.data.map((o) => (
                      <tr key={o.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <Link to={`/orders/${o.id}`} className="font-medium text-brand-700 hover:underline font-mono text-xs">
                            {o.orderNumber}
                          </Link>
                          <div className="text-xs text-slate-500">{o._count?.items ?? 0} items</div>
                        </td>
                        <td className="px-4 py-3">{o.customer?.name ?? '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium">
                          {formatPKR(o.totalAmount)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[o.status]}`}>
                            {STATUS_LABEL[o.status]}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${PAYMENT_BADGE[o.paymentStatus]}`}>
                            {PAYMENT_LABEL[o.paymentStatus]}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600 text-xs">{formatPKDate(o.orderDate)}</td>
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
