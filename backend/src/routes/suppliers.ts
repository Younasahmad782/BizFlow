import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/authorize'
import {
  createPurchaseSchema,
  createSupplierPaymentSchema,
  createSupplierSchema,
} from '../schemas/entities'
import { logAudit } from '../services/audit'
import { AppError } from '../utils/errors'

const router = Router()
router.use(authenticate)

const dec = (d: unknown): string | null =>
  d == null ? null : (d as { toString(): string }).toString()

const listQuery = z.object({
  search: z.string().max(120).optional(),
  city: z.string().max(60).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  sortBy: z.enum(['name', 'city', 'createdAt']).default('name'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  take: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
})

async function findSupplier(organizationId: string, id: string) {
  const supplier = await prisma.supplier.findFirst({
    where: { id, organizationId, deletedAt: null },
  })
  if (!supplier) throw new AppError(404, 'NOT_FOUND', 'Supplier not found')
  return supplier
}

// GET /api/suppliers — search, filter, paginate
router.get('/', requirePermission('products.read'), async (req, res, next) => {
  try {
    const q = listQuery.parse(req.query)
    const organizationId = req.member!.organizationId

    const where: Record<string, unknown> = { organizationId, deletedAt: null }
    if (q.city) where.city = q.city
    if (q.isActive !== undefined) where.isActive = q.isActive === 'true'
    if (q.search) {
      const s = q.search.trim()
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { company: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { city: { contains: s, mode: 'insensitive' } },
      ]
    }

    const [total, data] = await Promise.all([
      prisma.supplier.count({ where }),
      prisma.supplier.findMany({
        where,
        include: { _count: { select: { products: true, purchases: true } } },
        take: q.take,
        skip: q.skip,
        orderBy: { [q.sortBy]: q.sortDir },
      }),
    ])
    res.json({ data, total, take: q.take, skip: q.skip })
  } catch (e) {
    next(e)
  }
})

// ─── Purchases from suppliers ────────────────────────────────────
// NOTE: these sit before /:id so Express matches them first.

async function nextPurchaseNumber(organizationId: string): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `PUR-${year}-`
  const last = await prisma.purchase.findFirst({
    where: { organizationId, purchaseNumber: { startsWith: prefix } },
    orderBy: { purchaseNumber: 'desc' },
    select: { purchaseNumber: true },
  })
  const n = last ? parseInt(last.purchaseNumber.slice(prefix.length), 10) + 1 : 1
  return `${prefix}${String(n).padStart(4, '0')}`
}

// GET /api/suppliers/purchases/list — all purchases
router.get('/purchases/list', requirePermission('products.read'), async (req, res, next) => {
  try {
    const organizationId = req.member!.organizationId
    const take = Math.min(Number(req.query.take ?? 20), 100)
    const skip = Math.max(Number(req.query.skip ?? 0), 0)
    const where: Record<string, unknown> = { organizationId, deletedAt: null }
    if (req.query.supplierId) where.supplierId = String(req.query.supplierId)

    const [total, data] = await Promise.all([
      prisma.purchase.count({ where }),
      prisma.purchase.findMany({
        where,
        include: { supplier: { select: { id: true, name: true } } },
        orderBy: { purchaseDate: 'desc' },
        take,
        skip,
      }),
    ])
    res.json({
      data: data.map((p) => ({
        ...p,
        totalAmount: dec(p.totalAmount),
        paidAmount: dec(p.paidAmount),
      })),
      total,
      take,
      skip,
    })
  } catch (e) {
    next(e)
  }
})

// POST /api/suppliers/purchases — record a purchase from a supplier
router.post('/purchases', requirePermission('products.create'), async (req, res, next) => {
  try {
    const input = createPurchaseSchema.parse(req.body)
    const organizationId = req.member!.organizationId

    if (input.supplierId) {
      await findSupplier(organizationId, input.supplierId)
    }

    const purchase = await prisma.$transaction(async (tx) => {
      const purchaseNumber = await nextPurchaseNumber(organizationId)
      return tx.purchase.create({
        data: {
          organizationId,
          supplierId: input.supplierId,
          purchaseNumber,
          purchaseDate: input.purchaseDate,
          totalAmount: input.totalAmount,
          status: 'PENDING',
          notes: input.notes,
        },
      })
    })

    await logAudit({
      organizationId,
      memberId: req.member!.memberId,
      action: 'CREATE',
      entity: 'Purchase',
      entityId: purchase.id,
      details: { purchaseNumber: purchase.purchaseNumber, totalAmount: String(input.totalAmount) },
    })
    res.status(201).json({ ...purchase, totalAmount: dec(purchase.totalAmount), paidAmount: dec(purchase.paidAmount) })
  } catch (e) {
    next(e)
  }
})

// POST /api/suppliers/purchases/:id/pay — record a payment against a purchase
router.post('/purchases/:id/pay', requirePermission('products.update'), async (req, res, next) => {
  try {
    const input = createSupplierPaymentSchema.parse(req.body)
    const organizationId = req.member!.organizationId
    const memberId = req.member!.memberId

    const purchase = await prisma.purchase.findFirst({
      where: { id: String(req.params.id), organizationId, deletedAt: null },
    })
    if (!purchase) throw new AppError(404, 'NOT_FOUND', 'Purchase not found')
    const supplier = await findSupplier(organizationId, input.supplierId)

    const remaining = Number(purchase.totalAmount) - Number(purchase.paidAmount)
    if (Number(input.amount) > remaining + 0.01) {
      throw new AppError(400, 'BAD_REQUEST', `Payment exceeds remaining balance of Rs. ${remaining.toLocaleString('en-PK')}`)
    }

    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.supplierPayment.create({
        data: {
          organizationId,
          supplierId: supplier.id,
          purchaseId: purchase.id,
          amount: input.amount,
          method: input.method,
          paymentDate: input.paymentDate,
          notes: input.notes,
          createdById: memberId,
        },
      })
      const newPaid = Number(purchase.paidAmount) + Number(input.amount)
      const total = Number(purchase.totalAmount)
      await tx.purchase.update({
        where: { id: purchase.id },
        data: {
          paidAmount: newPaid,
          status: newPaid >= total - 0.01 ? 'PAID' : 'PARTIAL',
        },
      })
      return created
    })

    await logAudit({
      organizationId,
      memberId,
      action: 'CREATE',
      entity: 'SupplierPayment',
      entityId: payment.id,
      details: { purchaseId: purchase.id, amount: String(input.amount) },
    })
    res.status(201).json({ ...payment, amount: dec(payment.amount) })
  } catch (e) {
    next(e)
  }
})

// GET /api/suppliers/:id
router.get('/:id', requirePermission('products.read'), async (req, res, next) => {
  try {
    res.json(await findSupplier(req.member!.organizationId, String(req.params.id)))
  } catch (e) {
    next(e)
  }
})

// GET /api/suppliers/:id/profile
router.get('/:id/profile', requirePermission('products.read'), async (req, res, next) => {
  try {
    const organizationId = req.member!.organizationId
    const supplier = await findSupplier(organizationId, String(req.params.id))

    const [products, purchases, payments] = await Promise.all([
      prisma.product.findMany({
        where: { supplierId: supplier.id, organizationId, deletedAt: null },
        select: {
          id: true,
          name: true,
          sku: true,
          price: true,
          inventory: { select: { quantity: true } },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.purchase.findMany({
        where: { supplierId: supplier.id, organizationId, deletedAt: null },
        orderBy: { purchaseDate: 'desc' },
        take: 10,
      }),
      prisma.supplierPayment.findMany({
        where: { supplierId: supplier.id, organizationId },
        include: { purchase: { select: { purchaseNumber: true } } },
        orderBy: { paymentDate: 'desc' },
        take: 10,
      }),
    ])

    const totalPurchases = await prisma.purchase.aggregate({
      where: { supplierId: supplier.id, organizationId, deletedAt: null },
      _sum: { totalAmount: true },
    })
    const totalPaid = await prisma.supplierPayment.aggregate({
      where: { supplierId: supplier.id, organizationId },
      _sum: { amount: true },
    })

    const purchasesSum = Number(totalPurchases._sum.totalAmount ?? 0)
    const paidSum = Number(totalPaid._sum.amount ?? 0)
    const opening = Number(supplier.openingBalance ?? 0)
    const outstanding = opening + purchasesSum - paidSum

    const recentTransactions = [
      ...purchases.map((p) => ({
        id: p.id,
        kind: 'PURCHASE' as const,
        date: p.purchaseDate,
        reference: p.purchaseNumber,
        amount: p.totalAmount,
        status: p.status,
        notes: p.notes,
      })),
      ...payments.map((p) => ({
        id: p.id,
        kind: 'PAYMENT' as const,
        date: p.paymentDate,
        reference: p.purchase?.purchaseNumber ?? '—',
        amount: p.amount,
        status: null,
        notes: p.notes,
      })),
    ]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 10)

    res.json({
      supplier,
      stats: {
        productsSupplied: products.length,
        totalPurchases: purchasesSum,
        paidAmount: paidSum,
        outstandingBalance: outstanding,
        openingBalance: opening,
      },
      products: products.map((p) => ({
        ...p,
        price: dec(p.price),
        stock: p.inventory?.quantity ?? 0,
      })),
      payments: payments.map((p) => ({ ...p, amount: dec(p.amount) })),
      recentTransactions: recentTransactions.map((t) => ({ ...t, amount: dec(t.amount) })),
    })
  } catch (e) {
    next(e)
  }
})

// POST /api/suppliers
router.post('/', requirePermission('products.create'), async (req, res, next) => {
  try {
    const input = createSupplierSchema.parse(req.body)
    const organizationId = req.member!.organizationId
    const supplier = await prisma.supplier.create({ data: { ...input, organizationId } })
    await logAudit({
      organizationId,
      memberId: req.member!.memberId,
      action: 'CREATE',
      entity: 'Supplier',
      entityId: supplier.id,
    })
    res.status(201).json(supplier)
  } catch (e) {
    next(e)
  }
})

// PATCH /api/suppliers/:id
router.patch('/:id', requirePermission('products.update'), async (req, res, next) => {
  try {
    const input = createSupplierSchema.partial().parse(req.body)
    const organizationId = req.member!.organizationId
    const existing = await findSupplier(organizationId, String(req.params.id))
    const supplier = await prisma.supplier.update({ where: { id: existing.id }, data: input })
    await logAudit({
      organizationId,
      memberId: req.member!.memberId,
      action: 'UPDATE',
      entity: 'Supplier',
      entityId: supplier.id,
    })
    res.json(supplier)
  } catch (e) {
    next(e)
  }
})

// DELETE /api/suppliers/:id — soft delete
router.delete('/:id', requirePermission('products.delete'), async (req, res, next) => {
  try {
    const organizationId = req.member!.organizationId
    const existing = await findSupplier(organizationId, String(req.params.id))
    await prisma.supplier.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    })
    await logAudit({
      organizationId,
      memberId: req.member!.memberId,
      action: 'DELETE',
      entity: 'Supplier',
      entityId: existing.id,
    })
    res.status(204).end()
  } catch (e) {
    next(e)
  }
})

export default router
