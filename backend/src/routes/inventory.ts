import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/authorize'
import { pagination } from '../schemas/common'
import { adjustStockSchema, updateInventorySchema } from '../schemas/entities'
import { logAudit } from '../services/audit'
import { recordMovement, type MovementResult } from '../services/inventory'
import { notifyLowStock } from '../services/notifications'
import { AppError } from '../utils/errors'

const router = Router()
router.use(authenticate)

/** After a movement's transaction commits: deduped low-stock alert if needed. */
async function notifyIfLowStock(organizationId: string, m: MovementResult): Promise<void> {
  if (m.newQty <= m.reorderLevel) {
    await notifyLowStock(prisma, organizationId, m.productName)
  }
}

// GET /inventory — current stock levels with low-stock flags
router.get('/', requirePermission('products.read'), async (req, res, next) => {
  try {
    const { take, skip } = pagination.parse(req.query)
    const organizationId = req.member!.organizationId
    const lowOnly = req.query.lowStock === 'true'

    const rows = await prisma.inventory.findMany({
      where: { organizationId },
      take: lowOnly ? undefined : take,
      skip: lowOnly ? undefined : skip,
      orderBy: { product: { name: 'asc' } },
      include: {
        product: { select: { id: true, name: true, sku: true, price: true, deletedAt: true } },
      },
    })

    let result = rows
      .filter((r) => !r.product.deletedAt)
      .map((r) => ({ ...r, lowStock: r.quantity <= r.reorderLevel }))
    if (lowOnly) result = result.filter((r) => r.lowStock)
    res.json(result)
  } catch (e) {
    next(e)
  }
})

// GET /inventory/movements — stock ledger
router.get('/movements', requirePermission('products.read'), async (req, res, next) => {
  try {
    const { take, skip } = pagination.parse(req.query)
    const organizationId = req.member!.organizationId
    const where: Record<string, unknown> = { organizationId }
    if (req.query.inventoryId) where.inventoryId = String(req.query.inventoryId)
    if (req.query.productId) {
      const inv = await prisma.inventory.findFirst({
        where: { productId: String(req.query.productId), organizationId },
      })
      where.inventoryId = inv?.id ?? 'none'
    }
    if (req.query.type) where.type = String(req.query.type)
    const movements = await prisma.inventoryTransaction.findMany({
      where,
      take,
      skip,
      orderBy: { createdAt: 'desc' },
      include: {
        inventory: { include: { product: { select: { id: true, name: true, sku: true } } } },
        createdBy: { select: { id: true, user: { select: { name: true } } } },
      },
    })
    res.json(
      movements.map((m) => ({
        ...m,
        createdBy: m.createdBy
          ? { id: m.createdBy.id, name: m.createdBy.user.name }
          : null,
      })),
    )
  } catch (e) {
    next(e)
  }
})

// PATCH /inventory/:id — update reorder level / location
router.patch('/:id', requirePermission('products.update'), async (req, res, next) => {
  try {
    const input = updateInventorySchema.parse(req.body)
    const organizationId = req.member!.organizationId
    const inv = await prisma.inventory.findFirst({
      where: { id: String(req.params.id), organizationId },
    })
    if (!inv) throw new AppError(404, 'NOT_FOUND', 'Inventory record not found')
    const updated = await prisma.inventory.update({ where: { id: inv.id }, data: input })
    res.json(updated)
  } catch (e) {
    next(e)
  }
})

// POST /inventory/adjust — manual stock correction (signed quantity)
router.post('/adjust', requirePermission('products.update'), async (req, res, next) => {
  try {
    const input = adjustStockSchema.parse(req.body)
    const organizationId = req.member!.organizationId
    const memberId = req.member!.memberId

    const product = await prisma.product.findFirst({
      where: { id: input.productId, organizationId, deletedAt: null },
    })
    if (!product) throw new AppError(404, 'NOT_FOUND', 'Product not found')

    const movement = await prisma.$transaction(async (tx) => {
      const data: Record<string, unknown> = {}
      if (input.location) data.location = input.location
      const result = await recordMovement(tx, {
        organizationId,
        productId: product.id,
        type: 'ADJUSTMENT',
        quantity: input.quantity,
        reason: input.reason,
        memberId,
      })
      if (input.location) {
        const inv = await tx.inventory.findUnique({ where: { productId: product.id } })
        if (inv) await tx.inventory.update({ where: { id: inv.id }, data })
      }
      return result
    })
    await notifyIfLowStock(organizationId, movement)

    await logAudit({
      organizationId,
      memberId,
      action: 'UPDATE',
      entity: 'Inventory',
      entityId: product.id,
      details: { quantity: input.quantity, reason: input.reason },
    })
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

// POST /inventory/receive — stock in (purchases from suppliers)
router.post('/receive', requirePermission('products.create'), async (req, res, next) => {
  try {
    const input = adjustStockSchema.parse(req.body)
    if (input.quantity <= 0) {
      throw new AppError(400, 'BAD_REQUEST', 'Receive quantity must be positive')
    }
    const organizationId = req.member!.organizationId
    const memberId = req.member!.memberId

    const product = await prisma.product.findFirst({
      where: { id: input.productId, organizationId, deletedAt: null },
    })
    if (!product) throw new AppError(404, 'NOT_FOUND', 'Product not found')

    const movement = await prisma.$transaction(async (tx) =>
      recordMovement(tx, {
        organizationId,
        productId: product.id,
        type: 'IN',
        quantity: input.quantity,
        reason: input.reason,
        memberId,
      }),
    )
    await notifyIfLowStock(organizationId, movement)

    await logAudit({
      organizationId,
      memberId,
      action: 'CREATE',
      entity: 'InventoryTransaction',
      entityId: product.id,
      details: { type: 'IN', quantity: input.quantity },
    })
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

// POST /inventory/issue — stock out (manual sale / consumption)
router.post('/issue', requirePermission('products.update'), async (req, res, next) => {
  try {
    const input = adjustStockSchema.parse(req.body)
    if (input.quantity <= 0) {
      throw new AppError(400, 'BAD_REQUEST', 'Issue quantity must be positive')
    }
    const organizationId = req.member!.organizationId
    const memberId = req.member!.memberId

    const product = await prisma.product.findFirst({
      where: { id: input.productId, organizationId, deletedAt: null },
    })
    if (!product) throw new AppError(404, 'NOT_FOUND', 'Product not found')

    const movement = await prisma.$transaction(async (tx) =>
      recordMovement(tx, {
        organizationId,
        productId: product.id,
        type: 'OUT',
        quantity: input.quantity,
        reason: input.reason,
        memberId,
      }),
    )
    await notifyIfLowStock(organizationId, movement)

    await logAudit({
      organizationId,
      memberId,
      action: 'CREATE',
      entity: 'InventoryTransaction',
      entityId: product.id,
      details: { type: 'OUT', quantity: input.quantity },
    })
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

// POST /inventory/return — customer return back into stock
router.post('/return', requirePermission('products.update'), async (req, res, next) => {
  try {
    const input = adjustStockSchema.parse(req.body)
    if (input.quantity <= 0) {
      throw new AppError(400, 'BAD_REQUEST', 'Return quantity must be positive')
    }
    const organizationId = req.member!.organizationId
    const memberId = req.member!.memberId

    const product = await prisma.product.findFirst({
      where: { id: input.productId, organizationId, deletedAt: null },
    })
    if (!product) throw new AppError(404, 'NOT_FOUND', 'Product not found')

    const movement = await prisma.$transaction(async (tx) =>
      recordMovement(tx, {
        organizationId,
        productId: product.id,
        type: 'RETURN',
        quantity: input.quantity,
        reason: input.reason,
        memberId,
      }),
    )
    await notifyIfLowStock(organizationId, movement)

    await logAudit({
      organizationId,
      memberId,
      action: 'CREATE',
      entity: 'InventoryTransaction',
      entityId: product.id,
      details: { type: 'RETURN', quantity: input.quantity },
    })
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

// POST /inventory/damaged — damaged/expired goods written off
router.post('/damaged', requirePermission('products.update'), async (req, res, next) => {
  try {
    const input = adjustStockSchema.parse(req.body)
    if (input.quantity <= 0) {
      throw new AppError(400, 'BAD_REQUEST', 'Damaged quantity must be positive')
    }
    const organizationId = req.member!.organizationId
    const memberId = req.member!.memberId

    const product = await prisma.product.findFirst({
      where: { id: input.productId, organizationId, deletedAt: null },
    })
    if (!product) throw new AppError(404, 'NOT_FOUND', 'Product not found')

    const movement = await prisma.$transaction(async (tx) =>
      recordMovement(tx, {
        organizationId,
        productId: product.id,
        type: 'DAMAGED',
        quantity: input.quantity,
        reason: input.reason,
        memberId,
      }),
    )
    await notifyIfLowStock(organizationId, movement)

    await logAudit({
      organizationId,
      memberId,
      action: 'CREATE',
      entity: 'InventoryTransaction',
      entityId: product.id,
      details: { type: 'DAMAGED', quantity: input.quantity },
    })
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

export default router
