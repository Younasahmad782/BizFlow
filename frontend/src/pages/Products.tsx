import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { api, apiErrorMessage } from '../lib/api'
import { formatPKR } from '../lib/format'
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

export interface Product {
  id: string
  name: string
  sku: string | null
  brand: string | null
  description: string | null
  unit: string | null
  price: string
  costPrice: string | null
  wholesalePrice: string | null
  taxPercentage: string | null
  status: 'ACTIVE' | 'INACTIVE' | 'DISCONTINUED'
  category: { id: string; name: string } | null
  supplier: { id: string; name: string } | null
  stock: number
  reorderLevel: number
  location: string | null
  lowStock: boolean
}

interface ListResponse {
  data: Product[]
  total: number
  take: number
  skip: number
}

interface Category {
  id: string
  name: string
}

const STATUS_LABEL = { ACTIVE: 'Active', INACTIVE: 'Inactive', DISCONTINUED: 'Discontinued' }

const EMPTY_FORM = {
  name: '',
  sku: '',
  brand: '',
  categoryId: '',
  unit: 'pcs',
  price: '',
  costPrice: '',
  wholesalePrice: '',
  taxPercentage: '',
  status: 'ACTIVE',
  reorderLevel: '5',
  description: '',
}

function ProductForm({
  initial,
  categories,
  onClose,
  onSaved,
}: {
  initial: Partial<typeof EMPTY_FORM> & { id?: string }
  categories: Category[]
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
        sku: form.sku || undefined,
        brand: form.brand || undefined,
        categoryId: form.categoryId || undefined,
        description: form.description || undefined,
        price: Number(form.price),
        costPrice: form.costPrice ? Number(form.costPrice) : undefined,
        wholesalePrice: form.wholesalePrice ? Number(form.wholesalePrice) : undefined,
        taxPercentage: form.taxPercentage ? Number(form.taxPercentage) : undefined,
        reorderLevel: form.reorderLevel ? Number(form.reorderLevel) : undefined,
      }
      if (initial.id) await api.patch(`/products/${initial.id}`, payload)
      else await api.post('/products', payload)
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
          {initial.id ? 'Edit product' : 'Add product'}
        </h2>
        {error && (
          <div className="mb-4">
            <ErrorAlert message={error} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Product name *">
              <TextInput value={form.name} onChange={set('name')} placeholder="e.g. Basmati Rice 5kg" />
            </Field>
          </div>
          <Field label="SKU">
            <TextInput value={form.sku} onChange={set('sku')} placeholder="e.g. AN-RICE-5KG" />
          </Field>
          <Field label="Brand">
            <TextInput value={form.brand} onChange={set('brand')} placeholder="e.g. Falak" />
          </Field>
          <Field label="Category">
            <Select value={form.categoryId} onChange={set('categoryId')}>
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Unit">
            <Select value={form.unit} onChange={set('unit')}>
              {['pcs', 'kg', 'g', 'litre', 'pack', 'box', 'dozen', 'meter'].map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </Select>
          </Field>
          <Field label="Selling price (PKR) *">
            <TextInput value={form.price} onChange={set('price')} placeholder="1795" inputMode="decimal" />
          </Field>
          <Field label="Cost price (PKR)">
            <TextInput value={form.costPrice} onChange={set('costPrice')} placeholder="1620" inputMode="decimal" />
          </Field>
          <Field label="Wholesale price (PKR)">
            <TextInput value={form.wholesalePrice} onChange={set('wholesalePrice')} placeholder="1705" inputMode="decimal" />
          </Field>
          <Field label="Tax %">
            <TextInput value={form.taxPercentage} onChange={set('taxPercentage')} placeholder="0" inputMode="decimal" />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={set('status')}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="DISCONTINUED">Discontinued</option>
            </Select>
          </Field>
          <Field label="Reorder level">
            <TextInput value={form.reorderLevel} onChange={set('reorderLevel')} inputMode="numeric" />
          </Field>
          <div className="col-span-2">
            <Field label="Description">
              <textarea
                value={form.description}
                onChange={set('description')}
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
            disabled={mutation.isPending || !form.name.trim() || !form.price}
          >
            {mutation.isPending ? 'Saving…' : initial.id ? 'Save changes' : 'Add product'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}

export default function Products() {
  const { can } = useAuth()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [sortBy, setSortBy] = useState('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(0)
  const take = 12

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [deleting, setDeleting] = useState<Product | null>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(0)
    }, 350)
    return () => clearTimeout(t)
  }, [search])

  const { data: categories } = useQuery({
    queryKey: ['product-categories'],
    queryFn: async () => (await api.get('/product-categories')).data as Category[],
  })

  const queryKey = ['products', debouncedSearch, categoryFilter, statusFilter, lowStockOnly, sortBy, sortDir, page]
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
      if (categoryFilter) params.set('categoryId', categoryFilter)
      if (statusFilter) params.set('status', statusFilter)
      if (lowStockOnly) params.set('lowStock', 'true')
      return (await api.get(`/products?${params}`)).data as ListResponse
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/products/${id}`),
    onSuccess: () => {
      setDeleting(null)
      queryClient.invalidateQueries({ queryKey: ['products'] })
    },
  })

  const totalPages = data ? Math.ceil(data.total / take) : 0
  const hasFilters = debouncedSearch || categoryFilter || statusFilter || lowStockOnly

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle={data ? `${data.total} product${data.total === 1 ? '' : 's'}` : undefined}
        action={
          can('products.create') ? (
            <PrimaryButton onClick={() => { setEditing(null); setFormOpen(true) }}>
              Add product
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
              placeholder="Name, SKU, brand…"
            />
          </Field>
        </div>
        <div className="w-44">
          <Field label="Category">
            <Select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(0) }}>
              <option value="">All categories</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-36">
          <Field label="Status">
            <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0) }}>
              <option value="">All</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="DISCONTINUED">Discontinued</option>
            </Select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600 pb-2.5">
          <input
            type="checkbox"
            checked={lowStockOnly}
            onChange={(e) => { setLowStockOnly(e.target.checked); setPage(0) }}
            className="rounded"
          />
          Low stock only
        </label>
        <div className="w-44">
          <Field label="Sort by">
            <Select value={`${sortBy}:${sortDir}`} onChange={(e) => {
              const [sb, sd] = e.target.value.split(':')
              setSortBy(sb); setSortDir(sd as 'asc' | 'desc'); setPage(0)
            }}>
              <option value="name:asc">Name ↑</option>
              <option value="name:desc">Name ↓</option>
              <option value="price:asc">Price ↑</option>
              <option value="price:desc">Price ↓</option>
              <option value="createdAt:desc">Newest</option>
              <option value="createdAt:asc">Oldest</option>
            </Select>
          </Field>
        </div>
        {hasFilters && (
          <SecondaryButton onClick={() => { setSearch(''); setCategoryFilter(''); setStatusFilter(''); setLowStockOnly(false) }}>
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
              <EmptyState title="No products match" hint="Try a different search or clear the filters." />
            ) : (
              <EmptyState
                title="No products yet"
                hint="Add products to your catalog to sell and track inventory."
                action={can('products.create') ? (
                  <PrimaryButton onClick={() => { setEditing(null); setFormOpen(true) }}>
                    Add your first product
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
                      <th className="px-4 py-3 font-medium">Product</th>
                      <th className="px-4 py-3 font-medium">SKU</th>
                      <th className="px-4 py-3 font-medium text-right">Cost</th>
                      <th className="px-4 py-3 font-medium text-right">Selling</th>
                      <th className="px-4 py-3 font-medium text-right">Stock</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.data.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <span className="font-medium">{p.name}</span>
                          <div className="text-xs text-slate-500">
                            {[p.brand, p.category?.name].filter(Boolean).join(' · ')}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600 font-mono text-xs">{p.sku ?? '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                          {p.costPrice ? formatPKR(p.costPrice) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium">
                          {formatPKR(p.price)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <span className={p.lowStock ? 'text-red-600 font-semibold' : ''}>
                            {p.stock}
                          </span>
                          {p.lowStock && (
                            <span className="ml-1 text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                              low
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600 text-xs">{STATUS_LABEL[p.status]}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {can('products.update') && (
                            <button
                              onClick={() => { setEditing(p); setFormOpen(true) }}
                              className="text-sm text-brand-600 hover:underline mr-3"
                            >
                              Edit
                            </button>
                          )}
                          {can('products.delete') && (
                            <button
                              onClick={() => setDeleting(p)}
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
        <ProductForm
          initial={editing ? {
            id: editing.id,
            name: editing.name,
            sku: editing.sku ?? '',
            brand: editing.brand ?? '',
            categoryId: editing.category?.id ?? '',
            unit: editing.unit ?? 'pcs',
            price: editing.price ?? '',
            costPrice: editing.costPrice ?? '',
            wholesalePrice: editing.wholesalePrice ?? '',
            taxPercentage: editing.taxPercentage ?? '',
            status: editing.status,
            reorderLevel: String(editing.reorderLevel),
            description: editing.description ?? '',
          } : {}}
          categories={categories ?? []}
          onClose={() => { setFormOpen(false); setEditing(null) }}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ['products'] })}
        />
      )}

      {deleting && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold mb-2">Delete product?</h2>
            <p className="text-sm text-slate-600 mb-6">
              <span className="font-medium">{deleting.name}</span> will be removed from the
              catalog. Past order history is kept.
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
