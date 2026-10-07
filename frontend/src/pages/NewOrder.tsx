import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api, apiErrorMessage } from '../lib/api'
import { formatPKR } from '../lib/format'
import {
  ErrorAlert,
  Field,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  Select,
  TextInput,
} from '../components/ui'

interface Customer {
  id: string
  name: string
}

interface Product {
  id: string
  name: string
  sku: string | null
  price: string
  stock: number
}

interface Line {
  productId: string
  name: string
  unitPrice: number
  quantity: number
  stock: number
}

export default function NewOrder() {
  const navigate = useNavigate()
  const [customerId, setCustomerId] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [discount, setDiscount] = useState('')
  const [tax, setTax] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { data: customers } = useQuery({
    queryKey: ['order-customers'],
    queryFn: async () =>
      (await api.get('/customers?take=100')).data.data as Customer[],
  })

  const { data: products } = useQuery({
    queryKey: ['order-products', productSearch],
    queryFn: async () => {
      const params = productSearch ? `?search=${encodeURIComponent(productSearch)}&take=10` : '?take=10'
      return (await api.get(`/products${params}`)).data.data as Product[]
    },
  })

  const addLine = (p: Product) => {
    if (lines.some((l) => l.productId === p.id)) return
    setLines((ls) => [
      ...ls,
      { productId: p.id, name: p.name, unitPrice: Number(p.price), quantity: 1, stock: p.stock },
    ])
    setProductSearch('')
  }

  const updateQty = (id: string, qty: number) =>
    setLines((ls) => ls.map((l) => (l.productId === id ? { ...l, quantity: Math.max(1, qty) } : l)))

  const removeLine = (id: string) => setLines((ls) => ls.filter((l) => l.productId !== id))

  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)
  const discountNum = Number(discount) || 0
  const taxNum = Number(tax) || 0
  const total = Math.max(0, subtotal - discountNum + taxNum)

  const mutation = useMutation({
    mutationFn: () =>
      api.post('/orders', {
        customerId: customerId || undefined,
        items: lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        })),
        discountAmount: discountNum || undefined,
        taxAmount: taxNum || undefined,
      }),
    onSuccess: (res) => navigate(`/orders/${res.data.id}`),
    onError: (err) => setError(apiErrorMessage(err)),
  })

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Create order"
        subtitle="Draft first — stock is only deducted when you confirm."
      />
      {error && (
        <div className="mb-4">
          <ErrorAlert message={error} />
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg p-5 mb-4">
        <h3 className="font-semibold mb-3">1. Customer</h3>
        <Field label="Customer">
          <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Walk-in (no customer)</option>
            {(customers ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5 mb-4">
        <h3 className="font-semibold mb-3">2. Products</h3>
        <Field label="Add product">
          <TextInput
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            placeholder="Search products…"
          />
        </Field>
        {productSearch && (products ?? []).length > 0 && (
          <ul className="border border-slate-200 rounded-md mt-2 divide-y divide-slate-100 max-h-48 overflow-y-auto">
            {(products ?? []).map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => addLine(p)}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 flex justify-between"
                >
                  <span className="text-sm font-medium">{p.name}</span>
                  <span className="text-sm text-slate-500 tabular-nums">
                    {formatPKR(p.price)} · stock {p.stock}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {lines.length > 0 && (
          <table className="w-full text-sm mt-4">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-2 font-medium">Product</th>
                <th className="py-2 font-medium text-right">Price</th>
                <th className="py-2 font-medium text-right">Qty</th>
                <th className="py-2 font-medium text-right">Line total</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((l) => (
                <tr key={l.productId}>
                  <td className="py-2 font-medium">{l.name}</td>
                  <td className="py-2 text-right tabular-nums">{formatPKR(l.unitPrice)}</td>
                  <td className="py-2 text-right">
                    <input
                      type="number"
                      min={1}
                      value={l.quantity}
                      onChange={(e) => updateQty(l.productId, Number(e.target.value))}
                      className="w-16 border border-slate-300 rounded px-2 py-1 text-sm text-right"
                    />
                  </td>
                  <td className="py-2 text-right tabular-nums font-medium">
                    {formatPKR(l.quantity * l.unitPrice)}
                  </td>
                  <td className="py-2 text-right">
                    <button onClick={() => removeLine(l.productId)} className="text-red-600 text-sm hover:underline">
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5 mb-4">
        <h3 className="font-semibold mb-3">3. Discount & tax</h3>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Discount (PKR)">
            <TextInput value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0" inputMode="decimal" />
          </Field>
          <Field label="Tax (PKR)">
            <TextInput value={tax} onChange={(e) => setTax(e.target.value)} placeholder="0" inputMode="decimal" />
          </Field>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h3 className="font-semibold mb-3">4. Review</h3>
        <dl className="text-sm space-y-1.5">
          <div className="flex justify-between">
            <dt className="text-slate-500">Subtotal</dt>
            <dd className="tabular-nums">{formatPKR(subtotal)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Discount</dt>
            <dd className="tabular-nums">− {formatPKR(discountNum)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Tax</dt>
            <dd className="tabular-nums">+ {formatPKR(taxNum)}</dd>
          </div>
          <div className="flex justify-between pt-2 border-t border-slate-100 text-base font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatPKR(total)}</dd>
          </div>
        </dl>
        <div className="flex justify-end gap-2 mt-5">
          <SecondaryButton onClick={() => navigate('/orders')}>Cancel</SecondaryButton>
          <PrimaryButton
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || lines.length === 0}
          >
            {mutation.isPending ? 'Creating…' : 'Create draft order'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}
