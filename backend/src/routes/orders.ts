import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/authorize'
import {
  createOrderPaymentSchema,
  createOrderSchema,
  updateOrderSchema,
} from '../schemas/entities'
import { logAudit } from '../services/audit'
import { recordMovement } from '../services/inventory'
import {
  notifyLowStock,
  notifyOrderConfirmed,
  notifyOrderCreated,
  notifyPaymentReceived,
} from '../services/notifications'
import { nextInvoiceNumber, nextOrderNumber } from '../services/numbering'
import { AppError } from '../utils/errors'

const router = Router()
router.use(authenticate)

const dec = (d: unknown): string | null =>
  d == null ? null : (d as { toString(): string }).toString()

const listQuery = z.object({
  search: z.string().max(60).optional(),
  status: z.enum(['DRAFT', 'CONFIRMED', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'RETURNED']).optional(),
  paymentStatus: z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID', 'REFUNDED']).optional(),
  customerId: z.string().optional(),
  take: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
})

async function findOrder(organizationId: string, id: string) {
  const order = await prisma.order.findFirst({
    where: { id, organizationId },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      invoice: { select: { id: true, invoiceNumber: true, status: true, totalAmount: true } },
      payments: { orderBy: { paymentDate: 'desc' } },
    },
  })
  if (!order) throw new AppError(404, 'NOT_FOUND', 'Order not found')
  return order
}

function shapeOrder<T extends Record<string, unknown>>(o: T) {
  return {
    ...o,
    subtotal: dec(o.subtotal),
    discountAmount: dec(o.discountAmount),
    taxAmount: dec(o.taxAmount),
    totalAmount: dec(o.totalAmount),
    paidAmount: dec(o.paidAmount),
  }
}

// GET /api/orders — search, filter, paginate
router.get('/', requirePermission('orders.read'), async (req, res, next) => {
  try {
    const q = listQuery.parse(req.query)
    const organizationId = req.member!.organizationId
    const where: Record<string, unknown> = { organizationId }
    if (q.status) where.status = q.status
    if (q.paymentStatus) where.paymentStatus = q.paymentStatus
    if (q.customerId) where.customerId = q.customerId
    if (q.search) {
      where.orderNumber = { contains: q.search.trim(), mode: 'insensitive' }
    }

    const [total, data] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        take: q.take,
        skip: q.skip,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
      }),
    ])
    res.json({ data: data.map(shapeOrder), total, take: q.take, skip: q.skip })
  } catch (e) {
    next(e)
  }
})

// GET /api/orders/:id
router.get('/:id', requirePermission('orders.read'), async (req, res, next) => {
  try {
    const order = await findOrder(req.member!.organizationId, String(req.params.id))
    res.json(shapeOrder(order))
  } catch (e) {
    next(e)
  }
})

// POST /api/orders — create DRAFT order. Everything inside one DB transaction:
// totals are computed server-side, order number is sequential per org.
router.post('/', requirePermission('orders.create'), async (req, res, next) => {
  try {
    const input = createOrderSchema.parse(req.body)
    const organizationId = req.member!.organizationId
    const memberId = req.member!.memberId

    if (input.customerId) {
      const customer = await prisma.customer.findFirst({
        where: { id: input.customerId, organizationId, deletedAt: null },
      })
      if (!customer) throw new AppError(400, 'BAD_REQUEST', 'Invalid customer')
    }

    const productIds = [...new Set(input.items.map((i) => i.productId))]
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, organizationId, deletedAt: null },
      select: { id: true, name: true, status: true },
    })
    if (products.length !== productIds.length) {
      throw new AppError(400, 'BAD_REQUEST', 'One or more products are invalid')
    }
    const inactive = products.find((p) => p.status !== 'ACTIVE')
    if (inactive) {
      throw new AppError(400, 'BAD_REQUEST', `${inactive.name} is not an active product`)
    }

    const order = await prisma.$transaction(async (tx) => {
      const orderNumber = await nextOrderNumber(tx, organizationId)
      const subtotal = input.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
      const discount = Number(input.discountAmount ?? 0)
      const tax = Number(input.taxAmount ?? 0)
      const total = Math.max(0, subtotal - discount + tax)

      return tx.order.create({
        data: {
          organizationId,
          customerId: input.customerId,
          orderNumber,
          status: 'DRAFT',
          paymentStatus: 'UNPAID',
          subtotal,
          discountAmount: discount,
          taxAmount: tax,
          totalAmount: total,
          paidAmount: 0,
          items: {
            create: input.items.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
            })),
          },
        },
        include: {
          items: { include: { product: { select: { id: true, name: true, sku: true } } } },
          customer: { select: { id: true, name: true } },
        },
      })
    })

    await logAudit({
      organizationId,
      memberId,
      action: 'CREATE',
      entity: 'Order',
      entityId: order.id,
      details: { orderNumber: order.orderNumber, totalAmount: String(order.totalAmount) },
    })
    // Notify after the transaction committed (never inside it).
    await notifyOrderCreated(prisma, organizationId, order.orderNumber)
    res.status(201).json(shapeOrder(order))
  } catch (e) {
    next(e)
  }
})

// POST /api/orders/:id/confirm — DRAFT → CONFIRMED.
// Checks stock, deducts inventory, creates the invoice — all in ONE transaction.
// If anything fails, the whole thing rolls back: no partial stock changes.
router.post('/:id/confirm', requirePermission('orders.update'), async (req, res, next) => {
  try {
    const organizationId = req.member!.organizationId
    const memberId = req.member!.memberId
    const order = await findOrder(organizationId, String(req.params.id))
    if (order.status !== 'DRAFT') {
      throw new AppError(400, 'BAD_REQUEST', `Only draft orders can be confirmed (this one is ${order.status})`)
    }
    if (!order.customerId) {
      throw new AppError(400, 'BAD_REQUEST', 'Assign a customer before confirming the order')
    }
    const customerId: string = order.customerId

    const settings = await prisma.businessSetting.findUnique({ where: { organizationId } })
    const allowNegative = settings?.allowNegativeStock ?? false

    const confirmed = await prisma.$transaction(async (tx) => {
      // 1. Deduct inventory — throws INSUFFICIENT_STOCK unless settings allow negative
      const movements = []
      for (const item of order.items) {
        movements.push(
          await recordMovement(tx, {
            organizationId,
            productId: item.productId,
            type: 'OUT',
            quantity: item.quantity,
            reason: `Order ${order.orderNumber} confirmed`,
            reference: order.id,
            memberId,
            allowNegative,
          }),
        )
      }

      // 2. Create the invoice from the order
      const invoiceNumber = await nextInvoiceNumber(tx, organizationId)
      await tx.invoice.create({
        data: {
          organizationId,
          orderId: order.id,
          customerId,
          invoiceNumber,
          subtotal: order.subtotal,
          discountAmount: order.discountAmount,
          taxAmount: order.taxAmount,
          totalAmount: order.totalAmount,
          items: {
            create: order.items.map((i) => ({
              productId: i.productId,
              description: i.product.name,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
            })),
          },
        },
      })

      // 3. Flip the order status
      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: { status: 'CONFIRMED' },
      })
      return { updatedOrder, movements }
    })
    const { updatedOrder: confirmedOrder, movements } = confirmed

    await logAudit({
      organizationId,
      memberId,
      action: 'UPDATE',
      entity: 'Order',
      entityId: order.id,
      details: { from: 'DRAFT', to: 'CONFIRMED' },
    })
    // Notify after commit: order confirmed + any low-stock alerts (deduped).
    await notifyOrderConfirmed(prisma, organizationId, order.orderNumber)
    for (const m of movements) {
      if (m.newQty <= m.reorderLevel) {
        await notifyLowStock(prisma, organizationId, m.productName)
      }
    }
    res.json(shapeOrder(confirmedOrder))
  } catch (e) {
    next(e)
  }
})

// POST /api/orders/:id/pay — record a demo payment against the order.
// Updates paidAmount + paymentStatus in the same transaction.
router.post('/:id/pay', requirePermission('orders.update'), async (req, res, next) => {
  try {
    const input = createOrderPaymentSchema.parse(req.body)
    const organizationId = req.member!.organizationId
    const memberId = req.member!.memberId
    const order = await findOrder(organizationId, String(req.params.id))
    if (order.status === 'CANCELLED') {
      throw new AppError(400, 'BAD_REQUEST', 'Cannot pay a cancelled order')
    }

    const remaining = Number(order.totalAmount) - Number(order.paidAmount)
    if (Number(input.amount) > remaining + 0.01) {
      throw new AppError(400, 'BAD_REQUEST', `Payment exceeds remaining balance of Rs. ${remaining.toLocaleString('en-PK')}`)
    }

    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          organizationId,
          orderId: order.id,
          invoiceId: order.invoice?.id,
          customerId: order.customerId,
          amount: input.amount,
          method: input.method,
          paymentDate: input.paymentDate,
          notes: input.notes ? `[DEMO — no real account charged] ${input.notes}` : '[DEMO — no real account charged]',
        },
      })
      const newPaid = Number(order.paidAmount) + Number(input.amount)
      const total = Number(order.totalAmount)
      const updated = await tx.order.update({
        where: { id: order.id },
        data: {
          paidAmount: newPaid,
          paymentStatus: newPaid >= total - 0.01 ? 'PAID' : 'PARTIALLY_PAID',
        },
      })
      return { payment, updated }
    })

    await logAudit({
      organizationId,
      memberId,
      action: 'CREATE',
      entity: 'Payment',
      entityId: result.payment.id,
      details: { orderId: order.id, amount: String(input.amount), method: input.method },
    })
    await notifyPaymentReceived(
      prisma,
      organizationId,
      Number(input.amount),
      order.invoice?.invoiceNumber,
    )
    res.status(201).json({
      payment: { ...result.payment, amount: dec(result.payment.amount) },
      order: shapeOrder(result.updated),
    })
  } catch (e) {
    next(e)
  }
})

// PATCH /api/orders/:id — status transitions (PROCESSING/COMPLETED/CANCELLED/RETURNED).
// CANCELLED and RETURNED restock the items when stock was already deducted.
router.patch('/:id', requirePermission('orders.update'), async (req, res, next) => {
  try {
    const { status } = updateOrderSchema.parse(req.body)
    const organizationId = req.member!.organizationId
    const memberId = req.member!.memberId
    const order = await findOrder(organizationId, String(req.params.id))

    const STOCK_DEDUCTED = ['CONFIRMED', 'PROCESSING', 'COMPLETED']

    const allowed: Record<string, string[]> = {
      DRAFT: ['CONFIRMED', 'CANCELLED'],
      CONFIRMED: ['PROCESSING', 'COMPLETED', 'CANCELLED'],
      PROCESSING: ['COMPLETED', 'CANCELLED', 'RETURNED'],
      COMPLETED: ['RETURNED'],
      CANCELLED: [],
      RETURNED: [],
    }
    if (!allowed[order.status]?.includes(status)) {
      throw new AppError(400, 'BAD_REQUEST', `Cannot move order from ${order.status} to ${status}`)
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Restock when cancelling/returning an order that already took stock
      if ((status === 'CANCELLED' || status === 'RETURNED') && STOCK_DEDUCTED.includes(order.status)) {
        for (const item of order.items) {
          await recordMovement(tx, {
            organizationId,
            productId: item.productId,
            type: 'RETURN',
            quantity: item.quantity,
            reason: `Order ${order.orderNumber} ${status.toLowerCase()} — restocked`,
            reference: order.id,
            memberId,
          })
        }
      }
      const data: Record<string, unknown> = { status }
      if (status === 'RETURNED' && Number(order.paidAmount) > 0) {
        data.paymentStatus = 'REFUNDED'
      }
      return tx.order.update({ where: { id: order.id }, data })
    })

    await logAudit({
      organizationId,
      memberId,
      action: 'UPDATE',
      entity: 'Order',
      entityId: order.id,
      details: { from: order.status, to: status },
    })
    res.json(shapeOrder(updated))
  } catch (e) {
    next(e)
  }
})

export default router
