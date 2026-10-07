import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { api, apiErrorMessage } from '../lib/api'
import { formatPKR, formatPKDate } from '../lib/format'
import type { Supplier } from './Suppliers'
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

interface ProfileData {
  supplier: Supplier
  stats: {
    productsSupplied: number
    totalPurchases: number
    paidAmount: number
    outstandingBalance: number
    openingBalance: number
  }
  products: { id: string; name: string; sku: string | null; price: string | null; stock: number }[]
  payments: { id: string; amount: string; method: string; paymentDate: string; notes: string | null }[]
  recentTransactions: {
    id: string
    kind: 'PURCHASE' | 'PAYMENT'
    date: string
    reference: string
    amount: string | null
    status: string | null
    notes: string | null
  }[]
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`text-xl font-semibold mt-1 tabular-nums ${accent ?? ''}`}>{value}</p>
    </div>
  )
}

function PurchaseDialog({ supplierId, onClose }: { supplierId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [totalAmount, setTotalAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/suppliers/purchases', {
        supplierId,
        totalAmount: Number(totalAmount),
        notes: notes || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier-profile'] })
      queryClient.invalidateQueries({ queryKey: ['suppliers'] })
      onClose()
    },
    onError: (err) => setError(apiErrorMessage(err)),
  })

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg w-full max-w-sm p-6">
        <h2 className="text-lg font-semibold mb-4">Record purchase</h2>
        {error && (
          <div className="mb-4">
            <ErrorAlert message={error} />
          </div>
        )}
        <div className="space-y-4">
          <Field label="Total amount (PKR) *">
            <TextInput value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} placeholder="e.g. 185000" inputMode="decimal" />
          </Field>
          <Field label="Notes">
            <TextInput value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Stock replenishment" />
          </Field>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !totalAmount || Number(totalAmount) <= 0}
          >
            {mutation.isPending ? 'Saving…' : 'Record purchase'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}

function PaymentDialog({
  supplierId,
  purchases,
  onClose,
}: {
  supplierId: string
  purchases: { id: string; purchaseNumber: string; totalAmount: string; paidAmount: string }[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [purchaseId, setPurchaseId] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('CASH')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/suppliers/purchases/${purchaseId}/pay`, {
        supplierId,
        amount: Number(amount),
        method,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier-profile'] })
      onClose()
    },
    onError: (err) => setError(apiErrorMessage(err)),
  })

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg w-full max-w-sm p-6">
        <h2 className="text-lg font-semibold mb-4">Record payment</h2>
        {error && (
          <div className="mb-4">
            <ErrorAlert message={error} />
          </div>
        )}
        <div className="space-y-4">
          <Field label="Against purchase *">
            <Select value={purchaseId} onChange={(e) => setPurchaseId(e.target.value)}>
              <option value="">Select purchase</option>
              {purchases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.purchaseNumber} — {formatPKR(p.totalAmount)} (paid {formatPKR(p.paidAmount)})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount (PKR) *">
            <TextInput value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 40000" inputMode="decimal" />
          </Field>
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="CASH">Cash</option>
              <option value="BANK">Bank transfer</option>
              <option value="CARD">Card</option>
              <option value="ONLINE">Online</option>
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
            disabled={mutation.isPending || !purchaseId || !amount || Number(amount) <= 0}
          >
            {mutation.isPending ? 'Saving…' : 'Record payment'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}

export default function SupplierProfile() {
  const { id } = useParams()
  const { can } = useAuth()
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['supplier-profile', id],
    queryFn: async () => (await api.get(`/suppliers/${id}/profile`)).data as ProfileData,
    enabled: !!id,
  })

  const { data: purchases } = useQuery({
    queryKey: ['supplier-purchases', id],
    queryFn: async () =>
      (await api.get(`/suppliers/purchases/list?supplierId=${id}`)).data.data as {
        id: string
        purchaseNumber: string
        totalAmount: string
        paidAmount: string
        status: string
      }[],
    enabled: !!id,
  })

  if (isLoading)
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  if (isError || !data) return <ErrorAlert message={apiErrorMessage(error)} onRetry={() => refetch()} />

  const { supplier, stats } = data
  const outstanding = stats.outstandingBalance

  return (
    <div>
      <PageHeader
        title={supplier.name}
        subtitle={supplier.company ?? undefined}
        action={
          <Link to="/suppliers" className="text-sm text-brand-600 hover:underline">
            ← All suppliers
          </Link>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total purchases" value={formatPKR(stats.totalPurchases)} />
        <StatCard label="Paid" value={formatPKR(stats.paidAmount)} accent="text-green-700" />
        <StatCard
          label="Outstanding"
          value={formatPKR(outstanding)}
          accent={outstanding > 0 ? 'text-red-600' : 'text-green-700'}
        />
        <StatCard label="Products supplied" value={String(stats.productsSupplied)} />
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Recent transactions</h3>
              <div className="flex gap-2">
                {can('products.create') && (
                  <SecondaryButton onClick={() => setPurchaseOpen(true)}>Record purchase</SecondaryButton>
                )}
                {can('products.update') && (purchases?.length ?? 0) > 0 && (
                  <SecondaryButton onClick={() => setPaymentOpen(true)}>Record payment</SecondaryButton>
                )}
              </div>
            </div>
            {data.recentTransactions.length === 0 ? (
              <p className="text-sm text-slate-500">
                No purchases or payments yet. Record a purchase to start tracking what you owe.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-2 font-medium">Type</th>
                    <th className="py-2 font-medium">Reference</th>
                    <th className="py-2 font-medium text-right">Amount</th>
                    <th className="py-2 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.recentTransactions.map((t) => (
                    <tr key={t.kind + t.id}>
                      <td className="py-2">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            t.kind === 'PURCHASE'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-green-100 text-green-800'
                          }`}
                        >
                          {t.kind === 'PURCHASE' ? 'Purchase' : 'Payment'}
                        </span>
                      </td>
                      <td className="py-2 text-slate-600">{t.reference}</td>
                      <td className="py-2 text-right tabular-nums font-medium">
                        {t.amount ? formatPKR(t.amount) : '—'}
                      </td>
                      <td className="py-2 text-slate-600 text-xs">{formatPKDate(t.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h3 className="font-semibold mb-3">Products supplied</h3>
            {data.products.length === 0 ? (
              <p className="text-sm text-slate-500">No products linked to this supplier yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-2 font-medium">Product</th>
                    <th className="py-2 font-medium text-right">Price</th>
                    <th className="py-2 font-medium text-right">Stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.products.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2">
                        <span className="font-medium">{p.name}</span>
                        <div className="text-xs text-slate-500 font-mono">{p.sku ?? ''}</div>
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {p.price ? formatPKR(p.price) : '—'}
                      </td>
                      <td className="py-2 text-right tabular-nums">{p.stock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h3 className="font-semibold mb-3">Details</h3>
            <dl className="text-sm space-y-2">
              {[
                ['Contact person', supplier.contactPerson],
                ['Phone', supplier.phone],
                ['Email', supplier.email],
                ['Address', supplier.address],
                ['City', supplier.city],
                ['Tax / registration', supplier.taxNumber],
                ['Payment terms', supplier.paymentTerms],
                ['Opening balance', supplier.openingBalance ? formatPKR(supplier.openingBalance) : null],
              ].map(([k, v]) =>
                v ? (
                  <div key={k} className="flex justify-between gap-4">
                    <dt className="text-slate-500">{k}</dt>
                    <dd className="text-right">{v}</dd>
                  </div>
                ) : null,
              )}
            </dl>
            {supplier.notes && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Notes</p>
                <p className="text-sm whitespace-pre-wrap">{supplier.notes}</p>
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h3 className="font-semibold mb-3">Payment history</h3>
            {data.payments.length === 0 ? (
              <p className="text-sm text-slate-500">No payments recorded yet.</p>
            ) : (
              <ul className="text-sm space-y-2">
                {data.payments.map((p) => (
                  <li key={p.id} className="flex justify-between gap-4">
                    <div>
                      <span className="font-medium tabular-nums">{formatPKR(p.amount)}</span>
                      <div className="text-xs text-slate-500">
                        {p.method} · {formatPKDate(p.paymentDate)}
                      </div>
                    </div>
                    {p.notes && <div className="text-xs text-slate-500 text-right">{p.notes}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {purchaseOpen && (
        <PurchaseDialog supplierId={supplier.id} onClose={() => setPurchaseOpen(false)} />
      )}
      {paymentOpen && (
        <PaymentDialog
          supplierId={supplier.id}
          purchases={purchases ?? []}
          onClose={() => setPaymentOpen(false)}
        />
      )}
    </div>
  )
}
