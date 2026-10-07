import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, apiErrorMessage } from '../lib/api'
import { formatPKR, formatPKDate } from '../lib/format'
import {
  EmptyState,
  ErrorAlert,
  PageHeader,
  Spinner,
  StatCard,
} from '../components/ui'
import type { CustomerType } from './Customers'

interface ProfileResponse {
  customer: {
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
  }
  stats: {
    totalOrders: number
    totalPurchases: number
    paidAmount: number
    outstandingBalance: number
    lastOrder: { id: string; date: string; total: number; status: string } | null
  }
  recentOrders: Array<{ id: string; date: string; total: number; status: string }>
  recentTransactions: Array<{
    kind: 'invoice' | 'payment'
    id: string
    reference: string
    date: string
    amount: number
    status: string
  }>
}

const TYPE_LABEL: Record<CustomerType, string> = {
  RETAIL: 'Retail',
  WHOLESALE: 'Wholesale',
  CORPORATE: 'Corporate',
}

export default function CustomerProfile() {
  const { id } = useParams()
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['customer-profile', id],
    queryFn: async () => (await api.get(`/customers/${id}/profile`)).data as ProfileResponse,
    enabled: !!id,
  })

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }
  if (isError || !data) {
    return <ErrorAlert message={apiErrorMessage(error)} onRetry={() => refetch()} />
  }

  const { customer, stats } = data
  const location = [customer.area, customer.city].filter(Boolean).join(', ')

  return (
    <div>
      <PageHeader
        title={customer.name}
        subtitle={location || undefined}
        action={
          <Link
            to="/customers"
            className="text-sm font-medium text-brand-600 hover:underline"
          >
            ← All customers
          </Link>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total orders" value={String(stats.totalOrders)} />
        <StatCard label="Total purchases" value={formatPKR(stats.totalPurchases)} />
        <StatCard label="Paid amount" value={formatPKR(stats.paidAmount)} />
        <StatCard
          label="Outstanding balance"
          value={formatPKR(stats.outstandingBalance)}
          sub={
            stats.outstandingBalance > 0
              ? 'Amount receivable'
              : stats.outstandingBalance < 0
                ? 'Advance received'
                : 'Settled'
          }
        />
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          {/* Last order */}
          <div className="bg-white border border-slate-200 rounded-lg p-6">
            <h3 className="font-semibold mb-3">Last order</h3>
            {stats.lastOrder ? (
              <div className="flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium">{formatPKDate(stats.lastOrder.date)}</p>
                  <p className="text-slate-500">Status: {stats.lastOrder.status}</p>
                </div>
                <p className="font-semibold tabular-nums">{formatPKR(stats.lastOrder.total)}</p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No orders yet.</p>
            )}
          </div>

          {/* Recent orders */}
          <div className="bg-white border border-slate-200 rounded-lg p-6">
            <h3 className="font-semibold mb-3">Recent orders</h3>
            {data.recentOrders.length === 0 ? (
              <p className="text-sm text-slate-500">No orders yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-2 font-medium">Date</th>
                    <th className="py-2 font-medium">Status</th>
                    <th className="py-2 font-medium text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.recentOrders.map((o) => (
                    <tr key={o.id}>
                      <td className="py-2">{formatPKDate(o.date)}</td>
                      <td className="py-2 text-slate-600">{o.status}</td>
                      <td className="py-2 text-right tabular-nums font-medium">
                        {formatPKR(o.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Recent transactions */}
          <div className="bg-white border border-slate-200 rounded-lg p-6">
            <h3 className="font-semibold mb-3">Recent transactions</h3>
            {data.recentTransactions.length === 0 ? (
              <p className="text-sm text-slate-500">No invoices or payments yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-2 font-medium">Type</th>
                    <th className="py-2 font-medium">Reference</th>
                    <th className="py-2 font-medium">Date</th>
                    <th className="py-2 font-medium text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.recentTransactions.map((t) => (
                    <tr key={`${t.kind}-${t.id}`}>
                      <td className="py-2">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            t.kind === 'invoice'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-green-100 text-green-800'
                          }`}
                        >
                          {t.kind === 'invoice' ? 'Invoice' : 'Payment'}
                        </span>
                      </td>
                      <td className="py-2 text-slate-600">{t.reference}</td>
                      <td className="py-2 text-slate-600">{formatPKDate(t.date)}</td>
                      <td className="py-2 text-right tabular-nums font-medium">
                        {formatPKR(t.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Side panel */}
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-6">
            <h3 className="font-semibold mb-3">Contact</h3>
            <dl className="text-sm space-y-2">
              {customer.customerType && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Type</dt>
                  <dd className="font-medium">{TYPE_LABEL[customer.customerType]}</dd>
                </div>
              )}
              {customer.phone && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Phone</dt>
                  <dd className="font-medium">{customer.phone}</dd>
                </div>
              )}
              {customer.email && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Email</dt>
                  <dd className="font-medium break-all text-right">{customer.email}</dd>
                </div>
              )}
              {customer.address && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Address</dt>
                  <dd className="font-medium text-right">{customer.address}</dd>
                </div>
              )}
              {customer.area && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Area</dt>
                  <dd className="font-medium">{customer.area}</dd>
                </div>
              )}
              {customer.city && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">City</dt>
                  <dd className="font-medium">{customer.city}</dd>
                </div>
              )}
              {customer.creditLimit && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Credit limit</dt>
                  <dd className="font-medium tabular-nums">{formatPKR(customer.creditLimit)}</dd>
                </div>
              )}
            </dl>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-6">
            <h3 className="font-semibold mb-3">Notes</h3>
            {customer.notes ? (
              <p className="text-sm text-slate-600 whitespace-pre-wrap">{customer.notes}</p>
            ) : (
              <EmptyState
                title="No notes"
                hint="Add payment terms or delivery preferences from the customer list."
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
