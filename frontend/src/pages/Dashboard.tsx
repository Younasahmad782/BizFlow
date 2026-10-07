import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, apiErrorMessage } from '../lib/api'
import { formatPKR, formatPKDate } from '../lib/format'
import {
  EmptyState,
  ErrorAlert,
  Field,
  PageHeader,
  SecondaryButton,
  Spinner,
  StatCard,
  TextInput,
} from '../components/ui'
import { BarChart, DonutChart, RankedBars } from '../components/charts'

interface DashboardData {
  range: { from: string; to: string }
  kpis: {
    todaySales: number
    todayOrderCount: number
    monthRevenue: number
    outstandingTotal: number
    outstandingCount: number
    totalExpenses: number
    expensesToday: number
    netProfit: number
    grossProfit: number
    lowStockCount: number
    pendingOrders: number
  }
  lowStock: { name: string; sku: string | null; quantity: number; reorderLevel: number }[]
  charts: {
    revenueOverTime: { key: string; label: string; value: number }[]
    expensesOverTime: { key: string; label: string; value: number }[]
    salesByCategory: { name: string; value: number }[]
    topProducts: { name: string; value: number }[]
    paymentMethods: { method: string; total: number; count: number }[]
    expensesByCategory: { name: string; value: number }[]
  }
  outstandingInvoices: {
    id: string
    invoiceNumber: string
    customerName: string
    dueDate: string | null
    total: number
    paid: number
    balance: number
  }[]
  recentTransactions: { type: 'payment' | 'expense' | 'order'; date: string; description: string; amount: number }[]
}

type Preset = 'today' | '7d' | '30d' | 'month' | 'lastMonth' | '3m' | 'custom'

function presetRange(preset: Preset): { from: Date; to: Date; label: string } {
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  switch (preset) {
    case 'today':
      return { from: startOfDay(now), to: now, label: 'Today' }
    case '7d': {
      const from = new Date(now)
      from.setDate(from.getDate() - 6)
      return { from: startOfDay(from), to: now, label: 'Last 7 days' }
    }
    case '30d': {
      const from = new Date(now)
      from.setDate(from.getDate() - 29)
      return { from: startOfDay(from), to: now, label: 'Last 30 days' }
    }
    case 'month':
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1),
        to: now,
        label: now.toLocaleDateString('en-PK', { month: 'long', year: 'numeric' }),
      }
    case 'lastMonth': {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
      return { from, to, label: from.toLocaleDateString('en-PK', { month: 'long', year: 'numeric' }) }
    }
    case '3m': {
      const from = new Date(now.getFullYear(), now.getMonth() - 2, 1)
      return { from, to: now, label: 'Last 3 months' }
    }
    case 'custom':
      return { from: startOfDay(now), to: now, label: 'Custom' }
  }
}

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'month', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: '3m', label: '3 months' },
]

function toInputDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  )
}

export default function Dashboard() {
  const [preset, setPreset] = useState<Preset>('month')
  const [customFrom, setCustomFrom] = useState(toInputDate(new Date()))
  const [customTo, setCustomTo] = useState(toInputDate(new Date()))

  const range =
    preset === 'custom'
      ? { from: new Date(customFrom), to: new Date(customTo + 'T23:59:59'), label: 'Custom range' }
      : presetRange(preset)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['reports', 'dashboard', range.from.toISOString(), range.to.toISOString()],
    queryFn: async () =>
      (
        await api.get(
          `/reports/dashboard?from=${range.from.toISOString()}&to=${range.to.toISOString()}`,
        )
      ).data as DashboardData,
  })

  const hasActivity =
    data &&
    (data.kpis.todayOrderCount > 0 ||
      data.kpis.monthRevenue > 0 ||
      data.kpis.totalExpenses > 0 ||
      data.recentTransactions.length > 0)

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Real numbers from your business records." />

      {/* Date filters */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 mb-5 flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPreset(p.id)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              preset === p.id
                ? 'bg-brand-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setPreset('custom')}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            preset === 'custom' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
          }`}
        >
          Custom
        </button>
        {preset === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <Field label="">
              <TextInput type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </Field>
            <span className="text-slate-400">→</span>
            <Field label="">
              <TextInput type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </Field>
          </div>
        )}
        <span className="ml-auto text-sm text-slate-500">{range.label}</span>
      </div>

      {isLoading && (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      )}
      {isError && <ErrorAlert message={apiErrorMessage(error)} onRetry={() => refetch()} />}

      {data && !hasActivity && (
        <EmptyState
          title="No business activity yet"
          hint="Record your first sale or add products to see your numbers here."
          action={
            <Link
              to="/products"
              className="inline-block rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              Add your first product
            </Link>
          }
        />
      )}

      {data && hasActivity && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard label="Today's sales" value={formatPKR(data.kpis.todaySales)} sub={`${data.kpis.todayOrderCount} order${data.kpis.todayOrderCount === 1 ? '' : 's'} today`} />
            <StatCard label="This month's revenue" value={formatPKR(data.kpis.monthRevenue)} sub="Payments received" />
            <StatCard label="Outstanding payments" value={formatPKR(data.kpis.outstandingTotal)} sub={`${data.kpis.outstandingCount} unpaid invoice${data.kpis.outstandingCount === 1 ? '' : 's'}`} />
            <StatCard
              label="Net profit"
              value={formatPKR(data.kpis.netProfit)}
              sub={`Gross ${formatPKR(data.kpis.grossProfit)} · Expenses ${formatPKR(data.kpis.totalExpenses)}`}
            />
            <StatCard label="Total expenses" value={formatPKR(data.kpis.totalExpenses)} sub={`${formatPKR(data.kpis.expensesToday)} today`} />
            <StatCard
              label="Low stock items"
              value={String(data.kpis.lowStockCount)}
              sub={data.kpis.lowStockCount > 0 ? 'Need restocking' : 'All stocked'}
            />
            <StatCard label="Pending orders" value={String(data.kpis.pendingOrders)} sub="Draft / confirmed / processing" />
            <StatCard label="Gross profit" value={formatPKR(data.kpis.grossProfit)} sub="Revenue minus cost of goods" />
          </div>

          {/* Charts row 1 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <Card title="Revenue over time">
              <BarChart data={data.charts.revenueOverTime} />
            </Card>
            <Card title="Expenses over time">
              <BarChart data={data.charts.expensesOverTime} />
            </Card>
          </div>

          {/* Charts row 2 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
            <Card title="Sales by category">
              <RankedBars
                data={data.charts.salesByCategory.map((c) => ({ label: c.name, value: c.value }))}
              />
            </Card>
            <Card title="Top products">
              <RankedBars
                data={data.charts.topProducts.map((p) => ({ label: p.name, value: p.value }))}
                maxItems={5}
              />
            </Card>
            <Card title="Payment methods">
              <DonutChart
                data={data.charts.paymentMethods.map((m) => ({ name: m.method, value: m.total }))}
              />
            </Card>
          </div>

          {/* Bottom row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card
              title="Outstanding invoices"
              action={
                <Link to="/invoices" className="text-sm text-brand-600 hover:underline">
                  View all
                </Link>
              }
            >
              {data.outstandingInvoices.length === 0 ? (
                <p className="text-sm text-slate-400 py-6 text-center">
                  Nothing outstanding — all invoices are paid.
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.outstandingInvoices.map((inv) => (
                    <li key={inv.id} className="py-2.5 flex items-center justify-between">
                      <div>
                        <Link
                          to={`/invoices/${inv.id}`}
                          className="font-mono text-xs text-brand-700 hover:underline"
                        >
                          {inv.invoiceNumber}
                        </Link>
                        <p className="text-sm text-slate-600">{inv.customerName}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold tabular-nums text-sm">{formatPKR(inv.balance)}</p>
                        <p className="text-xs text-slate-500">due {formatPKDate(inv.dueDate)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Recent transactions">
              {data.recentTransactions.length === 0 ? (
                <p className="text-sm text-slate-400 py-6 text-center">No transactions yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.recentTransactions.map((t, i) => (
                    <li key={i} className="py-2.5 flex items-center justify-between">
                      <div>
                        <p className="text-sm text-slate-800">{t.description}</p>
                        <p className="text-xs text-slate-500">
                          {t.type === 'payment' ? 'Payment' : t.type === 'expense' ? 'Expense' : 'Order'} ·{' '}
                          {formatPKDate(t.date)}
                        </p>
                      </div>
                      <p
                        className={`font-semibold tabular-nums text-sm ${
                          t.amount < 0 ? 'text-red-600' : 'text-green-700'
                        }`}
                      >
                        {t.amount < 0 ? '−' : '+'}{formatPKR(Math.abs(t.amount))}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Low stock */}
          {data.lowStock.length > 0 && (
            <Card
              title="Low stock items"
              action={
                <Link to="/inventory" className="text-sm text-brand-600 hover:underline">
                  Manage inventory
                </Link>
              }
            >
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                {data.lowStock.map((item, i) => (
                  <div key={i} className="border border-amber-200 bg-amber-50 rounded-md p-3">
                    <p className="font-medium text-sm">{item.name}</p>
                    <p className="text-xs text-slate-500 font-mono">{item.sku}</p>
                    <p className="text-sm mt-1">
                      <span className="font-semibold text-amber-700">{item.quantity}</span>
                      <span className="text-slate-500"> left · reorder at {item.reorderLevel}</span>
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div className="mt-4 flex justify-end">
            <Link to="/expenses">
              <SecondaryButton>View expense breakdown</SecondaryButton>
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
