import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/authorize'
import { createProductSchema } from '../schemas/entities'
import { logAudit } from '../services/audit'
import { AppError } from '../utils/errors'

const router = Router()
router.use(authenticate)

const listQuery = z.object({
  search: z.string().max(120).optional(),
  categoryId: z.string().optional(),
  supplierId: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'DISCONTINUED']).optional(),
  lowStock: z.enum(['true', 'false']).optional(),
  sortBy: z.enum(['name', 'price', 'createdAt']).default('name'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  take: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
})

const dec = (d: unknown): string | null =>
  d == null ? null : (d as { toString(): string }).toString()

function shapeProduct(p: {
  price: unknown
  costPrice: unknown
  wholesalePrice: unknown
  taxPercentage: unknown
  inventory: { quantity: number; reorderLevel: number; location: string | null } | null
  category: { id: string; name: string } | null
  supplier: { id: string; name: string } | null
}) {
  return {
    ...p,
    price: dec(p.price),
    costPrice: dec(p.costPrice),
    wholesalePrice: dec(p.wholesalePrice),
    taxPercentage: dec(p.taxPercentage),
    stock: p.inventory?.quantity ?? 0,
    reorderLevel: p.inventory?.reorderLevel ?? 5,
    location: p.inventory?.location ?? null,
    lowStock: (p.inventory?.quantity ?? 0) <= (p.inventory?.reorderLevel ?? 5),
    inventory: undefined,
  }
}

// GET /api/products — search, filter, sort, paginate
router.get('/', requirePermission('products.read'), async (req, res, next) => {
  try {
    const q = listQuery.parse(req.query)
    const organizationId = req.member!.organizationId

    const where: Record<string, unknown> = { organizationId, deletedAt: null }
    if (q.status) where.status = q.status
    if (q.categoryId) where.categoryId = q.categoryId
    if (q.supplierId) where.supplierId = q.supplierId
    if (q.search) {
      const s = q.search.trim()
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { sku: { contains: s, mode: 'insensitive' } },
        { brand: { contains: s, mode: 'insensitive' } },
      ]
    }
    if (q.lowStock === 'true') {
      const rows = await prisma.inventory.findMany({
        where: { organizationId },
        select: { productId: true, quantity: true, reorderLevel: true },
      })
      const lowIds = rows
        .filter((r) => r.quantity <= r.reorderLevel)
        .map((r) => r.productId)
      where.id = { in: lowIds }
    }

    const include = {
      category: { select: { id: true, name: true } },
      supplier: { select: { id: true, name: true } },
      inventory: { select: { quantity: true, reorderLevel: true, location: true } },
    }

    const [total, data] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        include,
        take: q.take,
        skip: q.skip,
        orderBy: { [q.sortBy]: q.sortDir },
      }),
    ])

    res.json({ data: data.map(shapeProduct), total, take: q.take, skip: q.skip })
  } catch (e) {
    next(e)
  }
})

// GET /api/products/:id — with stock + recent movements
router.get('/:id', requirePermission('products.read'), async (req, res, next) => {
  try {
    const product = await prisma.product.findFirst({
      where: {
        id: String(req.params.id),
        organizationId: req.member!.organizationId,
        deletedAt: null,
      },
      include: {
        category: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        inventory: {
          select: {
            id: true,
            quantity: true,
            reorderLevel: true,
            location: true,
            transactions: {
              take: 10,
              orderBy: { createdAt: 'desc' },
              select: {
                id: true,
                type: true,
                quantity: true,
                reason: true,
                createdAt: true,
                createdBy: { select: { user: { select: { name: true } } } },
              },
            },
          },
        },
      },
    })
    if (!product) throw new AppError(404, 'NOT_FOUND', 'Product not found')
    res.json(shapeProduct(product))
  } catch (e) {
    next(e)
  }
})

// POST /api/products
router.post('/', requirePermission('products.create'), async (req, res, next) => {
  try {
    const { reorderLevel, location, ...body } = createProductSchema.parse(req.body)
    const organizationId = req.member!.organizationId

    if (body.categoryId) {
      const cat = await prisma.productCategory.findFirst({
        where: { id: body.categoryId, organizationId, deletedAt: null },
      })
      if (!cat) throw new AppError(400, 'BAD_REQUEST', 'Invalid category')
    }
    if (body.supplierId) {
      const sup = await prisma.supplier.findFirst({
        where: { id: body.supplierId, organizationId, deletedAt: null },
      })
      if (!sup) throw new AppError(400, 'BAD_REQUEST', 'Invalid supplier')
    }

    const product = await prisma.$transaction(async (tx) => {
      const created = await tx.product.create({ data: { ...body, organizationId } })
      await tx.inventory.create({
        data: {
          organizationId,
          productId: created.id,
          quantity: 0,
          reorderLevel: reorderLevel ?? 5,
          location,
        },
      })
      return created
    })

    await logAudit({
      organizationId,
      memberId: req.member!.memberId,
      action: 'CREATE',
      entity: 'Product',
      entityId: product.id,
    })
    res.status(201).json(product)
  } catch (e) {
    next(e)
  }
})

// PATCH /api/products/:id
router.patch('/:id', requirePermission('products.update'), async (req, res, next) => {
  try {
    const { reorderLevel, location, ...body } = createProductSchema.partial().parse(req.body)
    const organizationId = req.member!.organizationId
    const existing = await prisma.product.findFirst({
      where: { id: String(req.params.id), organizationId, deletedAt: null },
    })
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Product not found')

    const data = await prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({ where: { id: existing.id }, data: body })
      if (reorderLevel !== undefined || location !== undefined) {
        await tx.inventory.upsert({
          where: { productId: existing.id },
          create: {
            organizationId,
            productId: existing.id,
            quantity: 0,
            reorderLevel: reorderLevel ?? 5,
            location,
          },
          update: {
            ...(reorderLevel !== undefined ? { reorderLevel } : {}),
            ...(location !== undefined ? { location } : {}),
          },
        })
      }
      return updated
    })

    await logAudit({
      organizationId,
      memberId: req.member!.memberId,
      action: 'UPDATE',
      entity: 'Product',
      entityId: data.id,
    })
    res.json(data)
  } catch (e) {
    next(e)
  }
})

// DELETE /api/products/:id — soft delete
router.delete('/:id', requirePermission('products.delete'), async (req, res, next) => {
  try {
    const organizationId = req.member!.organizationId
    const existing = await prisma.product.findFirst({
      where: { id: String(req.params.id), organizationId, deletedAt: null },
    })
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Product not found')
    await prisma.product.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    })
    await logAudit({
      organizationId,
      memberId: req.member!.memberId,
      action: 'DELETE',
      entity: 'Product',
      entityId: existing.id,
    })
    res.status(204).end()
  } catch (e) {
    next(e)
  }
})

export default router
