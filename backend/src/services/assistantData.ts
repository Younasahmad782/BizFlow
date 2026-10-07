import type { OrderStatus } from '@prisma/client'
import { prisma } from '../lib/prisma'

const num = (d: unknown): number => Number((d as { toString(): string }).toString())

const LIVE_STATUSES: OrderStatus[] = ['CONFIRMED', 'PROCESSING', 'COMPLETED']

export interface AssistantContext {
  generatedAt: string
  currency: string
  period: { label: string; from: string; to: string }
  revenue: number
  orderCount: number
  grossProfit: number
  totalExpenses: number
  netProfit: number
  outstandingTotal: number
  outstandingCount: number
  overdueInvoices: { invoiceNumber: string; customer: string; balance: number; dueDate: string | null }[]
  topProducts: { name: string; revenue: number; quantity: number }[]
  salesByCategory: { category: string; revenue: number }[]
  lowStock: { name: string; quantity: number; reorderLevel: number }[]
  paymentMethods: { method: string; total: number }[]
  prevPeriod: { label: string; revenue: number; orderCount: number; expenses: number } | null
}

function monthBounds(offset: number): { from: Date; to: Date; label: string } {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth() - offset, 1)
  const to =
    offset === 0
      ? now
      : new Date(now.getFullYear(), now.getMonth() - offset + 1, 0, 23, 59, 59)
  return {
    from,
    to,
    label: from.toLocaleDateString('en-PK', { month: 'long', year: 'numeric' }),
  }
}

/**
 * CONTROLLED DATA-ACCESS LAYER.
 *
 * This is the ONLY way business data reaches the AI assistant. It returns
 * pre-computed aggregates scoped to a single organizationId — never raw
 * table access, never another organization's data. The caller (route) must
 * supply the organizationId from the authenticated session, never from
 * client input.
 */
export async function buildAssistantContext(
  organizationId: string,
  monthOffset = 0,
): Promise<AssistantContext> {
  const period = monthBounds(monthOffset)
  const prev = monthOffset === 0 ? monthBounds(1) : null
  

  const orders = await prisma.order.findMany({
    where: {
      organizationId,
      orderDate: { gte: period.from, lte: period.to },
      status: { in: LIVE_STATUSES },
    },
    include: {
      items: {
        include: {
          product: { select: { name: true, category: { select: { name: true } }, costPrice: true } },
        },
      },
    },
  })

  let revenue = 0
  let cogs = 0
  const productMap = new Map<string, { revenue: number; quantity: number }>()
  const categoryMap = new Map<string, number>()
  for (const o of orders) {
    revenue += num(o.totalAmount)
    for (const item of o.items) {
      const line = item.quantity * num(item.unitPrice)
      cogs += item.quantity * num(item.product.costPrice ?? 0)
      const p = productMap.get(item.product.name) ?? { revenue: 0, quantity: 0 }
      p.revenue += line
      p.quantity += item.quantity
      productMap.set(item.product.name, p)
      const cat = item.product.category?.name ?? 'Uncategorized'
      categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + line)
    }
  }

  const [expenses, invoices, lowStockRows, payments] = await Promise.all([
    prisma.expense.aggregate({
      where: { organizationId, deletedAt: null, expenseDate: { gte: period.from, lte: period.to } },
      _sum: { amount: true },
    }),
    prisma.invoice.findMany({
      where: { organizationId, status: { notIn: ['CANCELLED', 'PAID'] } },
      include: { payments: { select: { amount: true } }, customer: { select: { name: true } } },
      orderBy: { dueDate: 'asc' },
      take: 20,
    }),
    prisma.inventory.findMany({
      where: { organizationId },
      select: {
        quantity: true,
        reorderLevel: true,
        product: { select: { name: true } },
      },
    }),
    prisma.payment.groupBy({
      by: ['method'],
      where: { organizationId, paymentDate: { gte: period.from, lte: period.to } },
      _sum: { amount: true },
    }),
  ])

  const totalExpenses = num(expenses._sum.amount ?? 0)

  const overdueInvoices = invoices
    .map((inv) => {
      const paid = inv.payments.reduce((s, p) => s + num(p.amount), 0)
      const balance = num(inv.totalAmount) - paid
      return {
        invoiceNumber: inv.invoiceNumber,
        customer: inv.customer.name,
        balance,
        dueDate: inv.dueDate ? new Date(inv.dueDate).toISOString() : null,
        isOverdue: inv.dueDate != null && new Date(inv.dueDate) < new Date() && balance > 0.01,
      }
    })
    .filter((i) => i.isOverdue)

  const outstandingTotal = invoices.reduce((s, inv) => {
    const paid = inv.payments.reduce((x, p) => x + num(p.amount), 0)
    return s + Math.max(0, num(inv.totalAmount) - paid)
  }, 0)

  let prevPeriod: AssistantContext['prevPeriod'] = null
  if (prev) {
    const [prevOrders, prevExpenses] = await Promise.all([
      prisma.order.aggregate({
        where: {
          organizationId,
          orderDate: { gte: prev.from, lte: prev.to },
          status: { in: LIVE_STATUSES },
        },
        _sum: { totalAmount: true },
        _count: true,
      }),
      prisma.expense.aggregate({
        where: { organizationId, deletedAt: null, expenseDate: { gte: prev.from, lte: prev.to } },
        _sum: { amount: true },
      }),
    ])
    prevPeriod = {
      label: prev.label,
      revenue: num(prevOrders._sum.totalAmount ?? 0),
      orderCount: prevOrders._count,
      expenses: num(prevExpenses._sum.amount ?? 0),
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    currency: 'PKR',
    period: { label: period.label, from: period.from.toISOString(), to: period.to.toISOString() },
    revenue,
    orderCount: orders.length,
    grossProfit: revenue - cogs,
    totalExpenses,
    netProfit: revenue - cogs - totalExpenses,
    outstandingTotal,
    outstandingCount: invoices.filter((inv) => {
      const paid = inv.payments.reduce((s, p) => s + num(p.amount), 0)
      return num(inv.totalAmount) - paid > 0.01
    }).length,
    overdueInvoices: overdueInvoices.map(({ isOverdue: _o, ...rest }) => rest),
    topProducts: [...productMap.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5),
    salesByCategory: [...categoryMap.entries()]
      .map(([category, revenue]) => ({ category, revenue }))
      .sort((a, b) => b.revenue - a.revenue),
    lowStock: lowStockRows
      .filter((r) => r.quantity <= r.reorderLevel)
      .map((r) => ({ name: r.product.name, quantity: r.quantity, reorderLevel: r.reorderLevel }))
      .slice(0, 10),
    paymentMethods: payments.map((p) => ({ method: p.method, total: num(p._sum.amount ?? 0) })),
    prevPeriod,
  }
}
