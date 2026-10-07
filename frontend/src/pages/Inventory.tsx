import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { api, apiErrorMessage } from '../lib/api'
import { formatPKDate } from '../lib/format'
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

type MovementType = 'IN' | 'OUT' | 'RETURN' | 'DAMAGED' | 'ADJUSTMENT'

interface Movement {
  id: string
  type: MovementType
  quantity: number
  reason: string | null
  createdAt: string
  createdBy: { name: string } | null
  inventory: { product: { id: string; name: string; sku: string | null } }
}

interface StockRow {
  id: string
  quantity: number
  reorderLevel: number
  location: string | null
  product: { id: string; name: string; sku: string | null; unit: string | null }
}

const TYPE_META: Record<MovementType, { label: string; badge: string; endpoint: string; needsPerm: string }> = {
  IN: { label: 'Stock in', badge: 'bg-green-100 text-green-800', endpoint: 'receive', needsPerm: 'products.create' },
  OUT: { label: 'Stock out', badge: 'bg-blue-100 text-blue-800', endpoint: 'issue', needsPerm: 'products.update' },
  RETURN: { label: 'Return', badge: 'bg-teal-100 text-teal-800', endpoint: 'return', needsPerm: 'products.update' },
  DAMAGED: { label: 'Damaged', badge: 'bg-red-100 text-red-700', endpoint: 'damaged', needsPerm: 'products.update' },
  ADJUSTMENT: { label: 'Adjustment', badge: 'bg-amber-100 text-amber-800', endpoint: 'adjust', needsPerm: 'products.update' },
}

function MovementDialog({
  product,
  type,
  onClose,
}: {
  product: { id: string; name: string }
  type: MovementType
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const meta = TYPE_META[type]
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/inventory/${meta.endpoint}`, {
        productId: product.id,
        quantity: Number(quantity),
        reason: reason || meta.label,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] })
      queryClient.invalidateQueries({ queryKey: ['inventory-movements'] })
      queryClient.invalidateQueries({ queryKey: ['products'] })
      onClose()
    },
    onError: (err) => setError(apiErrorMessage(err)),
  })

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg w-full max-w-sm p-6">
        <h2 className="text-lg font-semibold mb-1">{meta.label}</h2>
        <p className="text-sm text-slate-500 mb-4">{product.name}</p>
        {error && (
          <div className="mb-4">
            <ErrorAlert message={error} />
          </div>
        )}
        <div className="space-y-4">
          <Field label={type === 'ADJUSTMENT' ? 'Quantity (use negative to reduce)' : 'Quantity'}>
            <TextInput
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder={type === 'ADJUSTMENT' ? 'e.g. -3 or 5' : 'e.g. 10'}
              inputMode="numeric"
            />
          </Field>
          <Field label="Reason">
            <TextInput
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Supplier delivery"
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !quantity || Number(quantity) === 0}
          >
            {mutation.isPending ? 'Saving…' : `Record ${meta.label.toLowerCase()}`}
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}

export default function Inventory() {
  const { can } = useAuth()
  const [tab, setTab] = useState<'stock' | 'movements'>('stock')
  const [dialog, setDialog] = useState<{ product: { id: string; name: string }; type: MovementType } | null>(null)
  const [typeFilter, setTypeFilter] = useState('')

  const { data: stock, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['inventory'],
    queryFn: async () => (await api.get('/inventory')).data as StockRow[],
    enabled: tab === 'stock',
  })

  const { data: movements } = useQuery({
    queryKey: ['inventory-movements', typeFilter],
    queryFn: async () => {
      const params = typeFilter ? `?type=${typeFilter}` : ''
      return (await api.get(`/inventory/movements${params}`)).data as Movement[]
    },
    enabled: tab === 'movements',
  })

  const canMove = (t: MovementType) => can(TYPE_META[t].needsPerm)

  return (
    <div>
      <PageHeader title="Inventory" subtitle="Every stock change is recorded as a transaction." />

      <div className="flex gap-2 mb-4">
        {(['stock', 'movements'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium rounded-md ${
              tab === t ? 'bg-brand-600 text-white' : 'bg-white border border-slate-200 text-slate-600'
            }`}
          >
            {t === 'stock' ? 'Stock levels' : 'Movement history'}
          </button>
        ))}
      </div>

      {tab === 'stock' && (
        <>
          {isLoading && (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          )}
          {isError && <ErrorAlert message={apiErrorMessage(error)} onRetry={() => refetch()} />}
          {!isLoading && !isError && stock && (
            <>
              {stock.length === 0 ? (
                <EmptyState
                  title="No stock tracked"
                  hint="Add products and record stock-in to start tracking inventory."
                />
              ) : (
                <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-slate-500">
                        <th className="px-4 py-3 font-medium">Product</th>
                        <th className="px-4 py-3 font-medium text-right">In stock</th>
                        <th className="px-4 py-3 font-medium text-right">Reorder at</th>
                        <th className="px-4 py-3 font-medium">Location</th>
                        <th className="px-4 py-3 font-medium text-right">Move stock</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {stock.map((row) => {
                        const low = row.quantity <= row.reorderLevel
                        return (
                          <tr key={row.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3">
                              <span className="font-medium">{row.product.name}</span>
                              <div className="text-xs text-slate-500 font-mono">
                                {row.product.sku ?? 'no SKU'}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums">
                              <span className={low ? 'text-red-600 font-semibold' : 'font-medium'}>
                                {row.quantity}
                              </span>{' '}
                              <span className="text-slate-500 text-xs">{row.product.unit ?? 'pcs'}</span>
                              {low && (
                                <div className="text-xs">
                                  <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                                    low stock
                                  </span>
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                              {row.reorderLevel}
                            </td>
                            <td className="px-4 py-3 text-slate-600">{row.location ?? '—'}</td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex justify-end gap-1 flex-wrap">
                                {(Object.keys(TYPE_META) as MovementType[]).map(
                                  (t) =>
                                    canMove(t) && (
                                      <button
                                        key={t}
                                        onClick={() =>
                                          setDialog({ product: row.product, type: t })
                                        }
                                        title={TYPE_META[t].label}
                                        className="text-xs px-2 py-1 rounded border border-slate-200 hover:bg-slate-100"
                                      >
                                        {TYPE_META[t].label}
                                      </button>
                                    ),
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}

      {tab === 'movements' && (
        <div>
          <div className="bg-white border border-slate-200 rounded-lg p-4 mb-4 w-56">
            <Field label="Filter by type">
              <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">All movements</option>
                {(Object.keys(TYPE_META) as MovementType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_META[t].label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {!movements || movements.length === 0 ? (
            <EmptyState
              title="No movements yet"
              hint="Stock-in, stock-out, returns, damaged goods and adjustments will be recorded here with who made them and why."
            />
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-slate-500">
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Product</th>
                    <th className="px-4 py-3 font-medium text-right">Qty</th>
                    <th className="px-4 py-3 font-medium">Reason</th>
                    <th className="px-4 py-3 font-medium">By</th>
                    <th className="px-4 py-3 font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {movements.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_META[m.type].badge}`}
                        >
                          {TYPE_META[m.type].label}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium">{m.inventory.product.name}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{m.reason ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{m.createdBy?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs">
                        {formatPKDate(m.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {dialog && (
        <MovementDialog
          product={dialog.product}
          type={dialog.type}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}
