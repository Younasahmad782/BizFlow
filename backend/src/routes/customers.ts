import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/authorize'
import { createCustomerSchema } from '../schemas/entities'
import { logAudit } from '../services/audit'
import { AppError } from '../utils/errors'

const router = Router()
router.use(authenticate)

const listQuery = z.object({
  search: z.string().max(120).optional(),
  customerType: z.enum(['RETAIL', 'WHOLESALE', 'CORPORATE']).optional(),
  city: z.string().max(60).optional(),
  sortBy: z.enum(['name', 'city', 'createdAt', 'creditLimit']).default('name'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  take: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
})

const toNumber = (d: unknown): number => Number((d as { toString(): string } | null)?.toString() ?? 0)

// GET /api/customers — search, filter, sort, paginate
router.get('/', requirePermission('customers.read'), async (req, res, next) => {
  try {
    const q = listQuery.parse(req.query)
    const organizationId = req.member!.organizationId

    const where: Record<string, unknown> = { organizationId, deletedAt: null }
    if (q.customerType) where.customerType = q.customerType
    if (q.city) where.city = { equals: q.city, mode: 'insensitive' }
    if (q.search) {
      const s = q.search.trim()
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { city: { contains: s, mode: 'insensitive' } },
        { area: { contains: s, mode: 'insensitive' } },
      ]
    }

    const [total, data] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        take: q.take,
        skip: q.skip,
        orderBy: { [q.sortBy]: q.sortDir },
        include: {
          _count: { select: { orders: true, invoices: true } },
        },
      }),
    ])

    res.json({
      data: data.map((c) => ({
        ...c,
        creditLimit: c.creditLimit?.toString() ?? null,
        openingBalance: c.openingBalance?.toString() ?? null,
        orderCount: c._count.orders,
        invoiceCount: c._count.invoices,
        _count: undefined,
      })),
      total,
      take: q.take,
      skip: q.skip,
    })
  } catch (e) {
    next(e)
  }
})

// GET /api/customers/:id/profile — stats, history, notes
router.get('/:id/profile', requirePermission('customers.read'), async (req, res, next) => {
  try {
    const organizationId = req.member!.organizationId
    const id = String(req.params.id)

    const customer = await prisma.customer.findFirst({
      where: { id, organizationId, deletedAt: null },
    })
    if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer not found')

    const [orderCount, invoices, payments, lastOrder, recentOrders] = await Promise.all([
      prisma.order.count({ where: { customerId: id, organizationId } }),
      prisma.invoice.findMany({
        where: { customerId: id, organizationId },
        select: { id: true, invoiceNumber: true, totalAmount: true, issueDate: true, status: true },
        orderBy: { issueDate: 'desc' },
      }),
      prisma.payment.findMany({
        where: { customerId: id, organizationId },
        select: { id: true, amount: true, method: true, paymentDate: true, invoiceId: true },
        orderBy: { paymentDate: 'desc' },
      }),
      prisma.order.findFirst({
        where: { customerId: id, organizationId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true, totalAmount: true, status: true },
      }),
      prisma.order.findMany({
        where: { customerId: id, organizationId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, createdAt: true, totalAmount: true, status: true },
      }),
    ])

    const totalPurchases = invoices.reduce((s, i) => s + toNumber(i.totalAmount), 0)
    const paidAmount = payments.reduce((s, p) => s + toNumber(p.amount), 0)
    const outstandingBalance =
      totalPurchases - paidAmount + toNumber(customer.openingBalance)

    const transactions = [
      ...invoices.slice(0, 10).map((i) => ({
        kind: 'invoice' as const,
        id: i.id,
        reference: i.invoiceNumber,
        date: i.issueDate,
        amount: toNumber(i.totalAmount),
        status: i.status,
      })),
      ...payments.slice(0, 10).map((p) => ({
        kind: 'payment' as const,
        id: p.id,
        reference: p.invoiceId ?? '—',
        date: p.paymentDate,
        amount: toNumber(p.amount),
        status: p.method,
      })),
    ]
      .sort((a, b) => +new Date(b.date) - +new Date(a.date))
      .slice(0, 10)

    res.json({
      customer: {
        ...customer,
        creditLimit: customer.creditLimit?.toString() ?? null,
        openingBalance: customer.openingBalance?.toString() ?? null,
      },
      stats: {
        totalOrders: orderCount,
        totalPurchases,
        paidAmount,
        outstandingBalance,
        lastOrder: lastOrder
          ? {
              id: lastOrder.id,
              date: lastOrder.createdAt,
              total: toNumber(lastOrder.totalAmount),
              status: lastOrder.status,
            }
          : null,
      },
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        date: o.createdAt,
        total: toNumber(o.totalAmount),
        status: o.status,
      })),
      recentTransactions: transactions,
    })
  } catch (e) {
    next(e)
  }
})

// GET /api/customers/:id
router.get('/:id', requirePermission('customers.read'), async (req, res, next) => {
  try {
    const customer = await prisma.customer.findFirst({
      where: {
        id: String(req.params.id),
        organizationId: req.member!.organizationId,
        deletedAt: null,
      },
    })
    if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer not found')
    res.json({
      ...customer,
      creditLimit: customer.creditLimit?.toString() ?? null,
      openingBalance: customer.openingBalance?.toString() ?? null,
    })
  } catch (e) {
    next(e)
  }
})

// POST /api/customers
router.post('/', requirePermission('customers.create'), async (req, res, next) => {
  try {
    const body = createCustomerSchema.parse(req.body)
    const data = await prisma.customer.create({
      data: { ...body, organizationId: req.member!.organizationId },
    })
    await logAudit({
      organizationId: req.member!.organizationId,
      memberId: req.member!.memberId,
      action: 'CREATE',
      entity: 'Customer',
      entityId: data.id,
    })
    res.status(201).json(data)
  } catch (e) {
    next(e)
  }
})

// PATCH /api/customers/:id
router.patch('/:id', requirePermission('customers.update'), async (req, res, next) => {
  try {
    const body = createCustomerSchema.partial().parse(req.body)
    const organizationId = req.member!.organizationId
    const existing = await prisma.customer.findFirst({
      where: { id: String(req.params.id), organizationId, deletedAt: null },
    })
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Customer not found')
    const data = await prisma.customer.update({ where: { id: existing.id }, data: body })
    await logAudit({
      organizationId,
      memberId: req.member!.memberId,
      action: 'UPDATE',
      entity: 'Customer',
      entityId: data.id,
    })
    res.json(data)
  } catch (e) {
    next(e)
  }
})

// DELETE /api/customers/:id — soft delete
router.delete('/:id', requirePermission('customers.delete'), async (req, res, next) => {
  try {
    const organizationId = req.member!.organizationId
    const existing = await prisma.customer.findFirst({
      where: { id: String(req.params.id), organizationId, deletedAt: null },
    })
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Customer not found')
    await prisma.customer.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    })
    await logAudit({
      organizationId,
      memberId: req.member!.memberId,
      action: 'DELETE',
      entity: 'Customer',
      entityId: existing.id,
    })
    res.status(204).end()
  } catch (e) {
    next(e)
  }
})

export default router
