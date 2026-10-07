import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/authorize'
import { AppError } from '../utils/errors'

const router = Router()
router.use(authenticate)

// GET /api/reports/summary -> revenue, expenses, profit, counts
router.get('/summary', requirePermission('reports.read'), async (req, res, next) => {
  try {
    const organizationId = req.member!.organizationId

    const [payments, expenses, orders, customers, products, lowStock] = await Promise.all([
      prisma.payment.aggregate({ where: { organizationId }, _sum: { amount: true } }),
      prisma.expense.aggregate({ where: { organizationId, deletedAt: null }, _sum: { amount: true } }),
      prisma.order.count({ where: { organizationId } }),
      prisma.customer.count({ where: { organizationId, deletedAt: null } }),
      prisma.product.count({ where: { organizationId, deletedAt: null } }),
      prisma.inventory.count({ where: { organizationId } }),
    ])

    const revenue = Number(payments._sum.amount ?? 0)
    const totalExpenses = Number(expenses._sum.amount ?? 0)

    const lowStockItems = await prisma.inventory.findMany({
      where: { organizationId },
      select: { quantity: true, reorderLevel: true },
    })
    const lowStockCount = lowStockItems.filter((i) => i.quantity <= i.reorderLevel).length

    res.json({
      revenue,
      expenses: totalExpenses,
      profit: revenue - totalExpenses,
      orders,
      customers,
      products,
      lowStock: lowStockCount,
      inventoryLines: lowStock,
    })
  } catch (e) {
    next(e)
  }
})

// GET /api/reports/sales-by-product -> revenue per product (from order items)
router.get('/sales-by-product', requirePermission('reports.read'), async (req, res, next) => {
  try {
    const organizationId = req.member!.organizationId

    const rows = await prisma.orderItem.groupBy({
      by: ['productId'],
      where: { order: { organizationId } },
      _sum: { quantity: true },
    })

    const productIds = rows.map((r) => r.productId)
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, price: true },
    })
    const byId = new Map(products.map((p) => [p.id, p]))

    res.json(
      rows.map((r) => {
        const p = byId.get(r.productId)
        const qty = r._sum.quantity ?? 0
        return {
          productId: r.productId,
          name: p?.name ?? 'Unknown',
          quantity: qty,
          revenue: qty * Number(p?.price ?? 0),
        }
      }),
    )
  } catch (e) {
    next(e)
  }
})

// GET /api/reports/expenses-by-category
router.get('/expenses-by-category', requirePermission('reports.read'), async (req, res, next) => {
  try {
    const organizationId = req.member!.organizationId
    const rows = await prisma.expense.groupBy({
      by: ['categoryId'],
      where: { organizationId, deletedAt: null },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
    })
    const cats = await prisma.expenseCategory.findMany({
      where: { id: { in: rows.map((r) => r.categoryId).filter((id): id is string => !!id) } },
      select: { id: true, name: true },
    })
    const nameOf = new Map(cats.map((c) => [c.id, c.name]))
    res.json(
      rows.map((r) => ({
        category: r.categoryId ? (nameOf.get(r.categoryId) ?? 'Unknown') : 'Uncategorized',
        total: Number(r._sum.amount ?? 0),
      })),
    )
  } catch (e) {
    next(e)
  }
})

// GET /api/reports/revenue-by-month -> last 6 months (Asia/Karachi)
router.get('/revenue-by-month', requirePermission('reports.read'), async (req, res, next) => {
  try {
    const organizationId = req.member!.organizationId
    const since = new Date()
    since.setMonth(since.getMonth() - 6)

    const rows = await prisma.$queryRaw<{ month: string; revenue: string }[]>`
      SELECT to_char(date_trunc('month', "paymentDate" AT TIME ZONE 'Asia/Karachi'), 'YYYY-MM') AS month,
             COALESCE(SUM(amount), 0)::text AS revenue
      FROM "Payment"
      WHERE "organizationId" = ${organizationId}::uuid AND "paymentDate" >= ${since}
      GROUP BY 1
      ORDER BY 1
    `
    res.json(rows.map((r) => ({ month: r.month, revenue: Number(r.revenue) })))
  } catch (e) {
    next(e)
  }
})

// GET /api/reports/profit-loss — real P&L from database records.
// Revenue = completed/confirmed/processing orders in period.
// COGS = order items valued at each product's cost price.
// Gross = Revenue − COGS. Net = Gross − Expenses.
router.get('/profit-loss', requirePermission('reports.read'), async (req, res, next) => {
  try {
    const organizationId = req.member!.organizationId
    const now = new Date()
    const from = req.query.from
      ? new Date(String(req.query.from))
      : new Date(now.getFullYear(), now.getMonth(), 1)
    const to = req.query.to ? new Date(String(req.query.to)) : now
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new AppError(400, 'BAD_REQUEST', 'Invalid date range')
    }

    const orders = await prisma.order.findMany({
      where: {
        organizationId,
        status: { in: ['CONFIRMED', 'PROCESSING', 'COMPLETED'] },
        orderDate: { gte: from, lte: to },
      },
      include: {
        items: { include: { product: { select: { costPrice: true } } } },
      },
    })

    let revenue = 0
    let cogs = 0
    for (const o of orders) {
      revenue += Number(o.totalAmount)
      for (const item of o.items) {
        cogs += item.quantity * Number(item.product.costPrice ?? 0)
      }
    }

    const expenses = await prisma.expense.aggregate({
      where: {
        organizationId,
        deletedAt: null,
        expenseDate: { gte: from, lte: to },
      },
      _sum: { amount: true },
    })
    const totalExpenses = Number(expenses._sum.amount ?? 0)

    const grossProfit = revenue - cogs
    const netProfit = grossProfit - totalExpenses

    res.json({
      from: from.toISOString(),
      to: to.toISOString(),
      orderCount: orders.length,
      revenue,
      costOfGoods: cogs,
      grossProfit,
      expenses: totalExpenses,
      netProfit,
    })
  } catch (e) {
    next(e)
  }
})

// GET /api/reports/dashboard — every number on the main dashboard, from real records.
// Query: ?from=ISO&to=ISO (defaults to this month). All amounts in PKR.
router.get('/dashboard', requirePermission('reports.read'), async (req, res, next) => {
  try {
    const organizationId = req.member!.organizationId
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const from = req.query.from ? new Date(String(req.query.from)) : startOfMonth
    const to = req.query.to ? new Date(String(req.query.to)) : now
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new AppError(400, 'BAD_REQUEST', 'Invalid date range')
    }

    const liveStatuses = ['CONFIRMED', 'PROCESSING', 'COMPLETED'] as const

    const [
      ordersInRange,
      todayOrders,
      monthPayments,
      expensesInRange,
      expensesToday,
      pendingOrders,
      lowStockRows,
      invoicesWithPayments,
      recentPayments,
      recentExpenses,
      recentOrders,
    ] = await Promise.all([
      prisma.order.findMany({
        where: { organizationId, orderDate: { gte: from, lte: to }, status: { in: [...liveStatuses] } },
        include: { items: { include: { product: { select: { name: true, category: { select: { name: true } }, costPrice: true } } } } },
      }),
      prisma.order.aggregate({
        where: { organizationId, orderDate: { gte: startOfToday }, status: { in: [...liveStatuses] } },
        _sum: { totalAmount: true },
        _count: true,
      }),
      prisma.payment.aggregate({
        where: { organizationId, paymentDate: { gte: startOfMonth, lte: now } },
        _sum: { amount: true },
      }),
      prisma.expense.aggregate({
        where: { organizationId, deletedAt: null, expenseDate: { gte: from, lte: to } },
        _sum: { amount: true },
      }),
      prisma.expense.aggregate({
        where: { organizationId, deletedAt: null, expenseDate: { gte: startOfToday } },
        _sum: { amount: true },
      }),
      prisma.order.count({
        where: { organizationId, status: { in: ['DRAFT', 'CONFIRMED', 'PROCESSING'] } },
      }),
      prisma.inventory.findMany({
        where: { organizationId },
        select: { quantity: true, reorderLevel: true, product: { select: { name: true, sku: true } } },
      }),
      prisma.invoice.findMany({
        where: { organizationId, status: { notIn: ['CANCELLED', 'PAID'] } },
        include: {
          payments: { select: { amount: true } },
          customer: { select: { name: true } },
        },
        orderBy: { dueDate: 'asc' },
      }),
      prisma.payment.findMany({
        where: { organizationId },
        orderBy: { paymentDate: 'desc' },
        take: 8,
        include: { customer: { select: { name: true } }, invoice: { select: { invoiceNumber: true } } },
      }),
      prisma.expense.findMany({
        where: { organizationId, deletedAt: null },
        orderBy: { expenseDate: 'desc' },
        take: 8,
        include: { category: { select: { name: true } } },
      }),
      prisma.order.findMany({
        where: { organizationId },
        orderBy: { orderDate: 'desc' },
        take: 8,
        include: { customer: { select: { name: true } } },
      }),
    ])

    const num = (d: unknown): number => Number((d as { toString(): string }).toString())

    // ── KPIs ──
    let revenue = 0
    let cogs = 0
    for (const o of ordersInRange) {
      revenue += num(o.totalAmount)
      for (const item of o.items) cogs += item.quantity * num(item.product.costPrice ?? 0)
    }
    const totalExpenses = num(expensesInRange._sum.amount ?? 0)
    const netProfit = revenue - cogs - totalExpenses

    const outstandingInvoices = invoicesWithPayments
      .map((inv) => {
        const paid = inv.payments.reduce((s, p) => s + num(p.amount), 0)
        return {
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          customerName: inv.customer.name,
          dueDate: inv.dueDate,
          total: num(inv.totalAmount),
          paid,
          balance: num(inv.totalAmount) - paid,
        }
      })
      .filter((i) => i.balance > 0.01)
    const outstandingTotal = outstandingInvoices.reduce((s, i) => s + i.balance, 0)

    const lowStock = lowStockRows
      .filter((r) => r.quantity <= r.reorderLevel)
      .map((r) => ({ name: r.product.name, sku: r.product.sku, quantity: r.quantity, reorderLevel: r.reorderLevel }))

    // ── Charts ──
    const days = Math.ceil((to.getTime() - from.getTime()) / 86400000) + 1
    const bucketByMonth = days > 62
    const bucketKey = (d: Date): string => {
      const x = new Date(d)
      return bucketByMonth
        ? `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`
        : `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
    }
    const bucketLabel = (key: string): string =>
      bucketByMonth
        ? new Date(key + '-02').toLocaleDateString('en-PK', { month: 'short', year: '2-digit' })
        : new Date(key + 'T00:00:00').toLocaleDateString('en-PK', { day: 'numeric', month: 'short' })

    const revenueBuckets = new Map<string, number>()
    for (const o of ordersInRange) {
      const k = bucketKey(new Date(o.orderDate))
      revenueBuckets.set(k, (revenueBuckets.get(k) ?? 0) + num(o.totalAmount))
    }

    const expenseRows = await prisma.expense.findMany({
      where: { organizationId, deletedAt: null, expenseDate: { gte: from, lte: to } },
      select: { amount: true, expenseDate: true, category: { select: { name: true } } },
    })
    const expenseBuckets = new Map<string, number>()
    const expensesByCategory = new Map<string, number>()
    for (const e of expenseRows) {
      const k = bucketKey(new Date(e.expenseDate))
      expenseBuckets.set(k, (expenseBuckets.get(k) ?? 0) + num(e.amount))
      const cat = e.category?.name ?? 'Uncategorized'
      expensesByCategory.set(cat, (expensesByCategory.get(cat) ?? 0) + num(e.amount))
    }

    const toSeries = (m: Map<string, number>) =>
      [...m.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, value]) => ({ key, label: bucketLabel(key), value }))

    const salesByCategory = new Map<string, number>()
    const productSales = new Map<string, number>()
    for (const o of ordersInRange) {
      for (const item of o.items) {
        const line = item.quantity * num(item.unitPrice)
        const cat = item.product.category?.name ?? 'Uncategorized'
        salesByCategory.set(cat, (salesByCategory.get(cat) ?? 0) + line)
        productSales.set(item.product.name, (productSales.get(item.product.name) ?? 0) + line)
      }
    }

    const paymentMethodRows = await prisma.payment.groupBy({
      by: ['method'],
      where: { organizationId, paymentDate: { gte: from, lte: to } },
      _sum: { amount: true },
      _count: true,
    })

    // ── Recent transactions (merged, newest first) ──
    const transactions = [
      ...recentPayments.map((p) => ({
        type: 'payment' as const,
        date: p.paymentDate,
        description: `Payment from ${p.customer?.name ?? 'customer'}${p.invoice ? ` (${p.invoice.invoiceNumber})` : ''}`,
        amount: num(p.amount),
      })),
      ...recentExpenses.map((e) => ({
        type: 'expense' as const,
        date: e.expenseDate,
        description: `${e.category?.name ?? 'Expense'} — ${e.description ?? ''}`.trim(),
        amount: -num(e.amount),
      })),
      ...recentOrders.map((o) => ({
        type: 'order' as const,
        date: o.orderDate,
        description: `Order ${o.orderNumber} — ${o.customer?.name ?? 'walk-in'}`,
        amount: num(o.totalAmount),
      })),
    ]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 10)
      .map((t) => ({ ...t, date: new Date(t.date).toISOString() }))

    res.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      kpis: {
        todaySales: num(todayOrders._sum.totalAmount ?? 0),
        todayOrderCount: todayOrders._count,
        monthRevenue: num(monthPayments._sum.amount ?? 0),
        outstandingTotal,
        outstandingCount: outstandingInvoices.length,
        totalExpenses,
        expensesToday: num(expensesToday._sum.amount ?? 0),
        netProfit,
        grossProfit: revenue - cogs,
        lowStockCount: lowStock.length,
        pendingOrders,
      },
      lowStock: lowStock.slice(0, 8),
      charts: {
        revenueOverTime: toSeries(revenueBuckets),
        expensesOverTime: toSeries(expenseBuckets),
        salesByCategory: [...salesByCategory.entries()]
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value),
        topProducts: [...productSales.entries()]
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 5),
        paymentMethods: paymentMethodRows.map((r) => ({
          method: r.method,
          total: num(r._sum.amount ?? 0),
          count: r._count,
        })),
        expensesByCategory: [...expensesByCategory.entries()]
          .map(([name, value]) => ({ name, value }))
          .sort((a, b) => b.value - a.value),
      },
      outstandingInvoices: outstandingInvoices.slice(0, 8),
      recentTransactions: transactions,
    })
  } catch (e) {
    next(e)
  }
})

export default router
