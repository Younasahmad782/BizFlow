import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { api, apiErrorMessage } from '../lib/api'
import { formatPKR, formatPKDate } from '../lib/format'
import { PAYMENT_BADGE, PAYMENT_LABEL, STATUS_BADGE, STATUS_LABEL } from './Orders'
import type { OrderStatus } from './Orders'
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

const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'JAZZCASH', label: 'JazzCash' },
  { value: 'EASYPAISA', label: 'Easypaisa' },
  { value: 'CARD', label: 'Card' },
  { value: 'OTHER', label: 'Other' },
]

interface OrderDetail {
  id: string
  orderNumber: string
  status: OrderStatus
  paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'REFUNDED'
  subtotal: string
  discountAmount: string
  taxAmount: string
  totalAmount: string
  paidAmount: string
  orderDate: string
  customer: { id: string; name: string; phone: string | null } | null
  items: { id: string; quantity: number; unitPrice: string; product: { id: string; name: string; sku: string | null } }[]
  invoice: { id: string; invoiceNumber: string; status: string; totalAmount: string } | null
  payments: { id: string; amount: string; method: string; paymentDate: string; notes: string | null }[]
}

function PayDialog({ order, onClose }: { order: OrderDetail; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('CASH')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const remaining = Number(order.totalAmount) - Number(order.paidAmount)

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/orders/${order.id}/pay`, {
        amount: Number(amount),
        method,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-detail'] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      onClose()
    },
    onError: (err) => setError(apiErrorMessage(err)),
  })

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg w-full max-w-sm p-6">
        <h2 className="text-lg font-semibold mb-1">Record payment</h2>
        <p className="text-sm text-slate-500 mb-1">
          {order.orderNumber} · remaining {formatPKR(remaining)}
        </p>
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-4">
          Demo only — no real payment account is charged.
        </p>
        {error && (
          <div className="mb-4">
            <ErrorAlert message={error} />
          </div>
        )}
        <div className="space-y-4">
          <Field label="Amount (PKR) *">
            <TextInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(remaining)} inputMode="decimal" />
          </Field>
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Notes">
            <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </Field>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !amount || Number(amount) <= 0}
          >
            {mutation.isPending ? 'Saving…' : 'Record payment'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}

const NEXT_ACTIONS: Record<OrderStatus, { label: string; status: OrderStatus; kind: 'confirm' | 'patch' }[]> = {
  DRAFT: [{ label: 'Confirm order', status: 'CONFIRMED', kind: 'confirm' }],
  CONFIRMED: [
    { label: 'Start processing', status: 'PROCESSING', kind: 'patch' },
    { label: 'Mark completed', status: 'COMPLETED', kind: 'patch' },
  ],
  PROCESSING: [{ label: 'Mark completed', status: 'COMPLETED', kind: 'patch' }],
  COMPLETED: [{ label: 'Return order', status: 'RETURNED', kind: 'patch' }],
  CANCELLED: [],
  RETURNED: [],
}

export default function OrderDetail() {
  const { id } = useParams()
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [payOpen, setPayOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['order-detail', id],
    queryFn: async () => (await api.get(`/orders/${id}`)).data as OrderDetail,
    enabled: !!id,
  })

  const actionMutation = useMutation({
    mutationFn: async (action: { label: string; status: OrderStatus; kind: 'confirm' | 'patch' }) => {
      if (action.kind === 'confirm') return api.post(`/orders/${id}/confirm`)
      return api.patch(`/orders/${id}`, { status: action.status })
    },
    onSuccess: () => {
      setActionError(null)
      queryClient.invalidateQueries({ queryKey: ['order-detail'] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
    onError: (err) => setActionError(apiErrorMessage(err)),
  })

  const cancelMutation = useMutation({
    mutationFn: () => api.patch(`/orders/${id}`, { status: 'CANCELLED' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['order-detail'] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
    onError: (err) => setActionError(apiErrorMessage(err)),
  })

  if (isLoading)
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  if (isError || !data) return <ErrorAlert message={apiErrorMessage(error)} onRetry={() => refetch()} />

  const actions = NEXT_ACTIONS[data.status]
  const canAct = can('orders.update')
  const remaining = Number(data.totalAmount) - Number(data.paidAmount)

  return (
    <div>
      <PageHeader
        title={data.orderNumber}
        subtitle={`${formatPKDate(data.orderDate)}${data.customer ? ` · ${data.customer.name}` : ''}`}
        action={
          <Link to="/orders" className="text-sm text-brand-600 hover:underline">
            ← All orders
          </Link>
        }
      />

      {actionError && (
        <div className="mb-4">
          <ErrorAlert message={actionError} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${STATUS_BADGE[data.status]}`}>
          {STATUS_LABEL[data.status]}
        </span>
        <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${PAYMENT_BADGE[data.paymentStatus]}`}>
          {PAYMENT_LABEL[data.paymentStatus]}
        </span>
        {canAct && actions.map((a) => (
          <PrimaryButton
            key={a.label}
            onClick={() => actionMutation.mutate(a)}
            disabled={actionMutation.isPending}
          >
            {actionMutation.isPending ? 'Working…' : a.label}
          </PrimaryButton>
        ))}
        {canAct && remaining > 0 && data.status !== 'CANCELLED' && data.status !== 'RETURNED' && (
          <SecondaryButton onClick={() => setPayOpen(true)}>Record payment</SecondaryButton>
        )}
        {canAct && (data.status === 'DRAFT' || data.status === 'CONFIRMED' || data.status === 'PROCESSING') && (
          <button
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
            className="text-sm text-red-600 hover:underline ml-2"
          >
            {cancelMutation.isPending ? 'Cancelling…' : 'Cancel order'}
          </button>
        )}
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h3 className="font-semibold mb-3">Items</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2 font-medium">Product</th>
                  <th className="py-2 font-medium text-right">Price</th>
                  <th className="py-2 font-medium text-right">Qty</th>
                  <th className="py-2 font-medium text-right">Line total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((i) => (
                  <tr key={i.id}>
                    <td className="py-2">
                      <span className="font-medium">{i.product.name}</span>
                      <div className="text-xs text-slate-500 font-mono">{i.product.sku ?? ''}</div>
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatPKR(i.unitPrice)}</td>
                    <td className="py-2 text-right tabular-nums">{i.quantity}</td>
                    <td className="py-2 text-right tabular-nums font-medium">
                      {formatPKR(Number(i.unitPrice) * i.quantity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="text-sm space-y-1.5 mt-4 pt-4 border-t border-slate-100">
              <div className="flex justify-between">
                <dt className="text-slate-500">Subtotal</dt>
                <dd className="tabular-nums">{formatPKR(data.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Discount</dt>
                <dd className="tabular-nums">− {formatPKR(data.discountAmount)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Tax</dt>
                <dd className="tabular-nums">+ {formatPKR(data.taxAmount)}</dd>
              </div>
              <div className="flex justify-between text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatPKR(data.totalAmount)}</dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-slate-500">Paid</dt>
                <dd className="tabular-nums text-green-700">{formatPKR(data.paidAmount)}</dd>
              </div>
              {remaining > 0 && (
                <div className="flex justify-between text-sm">
                  <dt className="text-slate-500">Remaining</dt>
                  <dd className="tabular-nums text-red-600 font-medium">{formatPKR(remaining)}</dd>
                </div>
              )}
            </dl>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h3 className="font-semibold mb-3">Payments</h3>
            {data.payments.length === 0 ? (
              <p className="text-sm text-slate-500">No payments recorded yet.</p>
            ) : (
              <ul className="text-sm space-y-2">
                {data.payments.map((p) => (
                  <li key={p.id} className="flex justify-between gap-4">
                    <div>
                      <span className="font-medium tabular-nums">{formatPKR(p.amount)}</span>
                      <div className="text-xs text-slate-500">
                        {PAYMENT_METHODS.find((m) => m.value === p.method)?.label ?? p.method} · {formatPKDate(p.paymentDate)}
                      </div>
                      {p.notes && <div className="text-xs text-slate-500">{p.notes}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h3 className="font-semibold mb-3">Customer</h3>
            {data.customer ? (
              <Link to={`/customers/${data.customer.id}`} className="text-brand-700 hover:underline font-medium">
                {data.customer.name}
              </Link>
            ) : (
              <p className="text-sm text-slate-500">Walk-in sale</p>
            )}
          </div>
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h3 className="font-semibold mb-3">Invoice</h3>
            {data.invoice ? (
              <div className="text-sm">
                <p className="font-mono text-xs font-medium">{data.invoice.invoiceNumber}</p>
                <p className="text-slate-500 text-xs mt-1">Status: {data.invoice.status}</p>
                <p className="tabular-nums mt-1">{formatPKR(data.invoice.totalAmount)}</p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                No invoice yet — one is created automatically when the order is confirmed.
              </p>
            )}
          </div>
        </div>
      </div>

      {payOpen && <PayDialog order={data} onClose={() => setPayOpen(false)} />}
    </div>
  )
}
