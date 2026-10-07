import { Router } from 'express'
import type { ZodType } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/authorize'
import { pagination } from '../schemas/common'
import { logAudit } from '../services/audit'
import { AppError } from '../utils/errors'

type ModelKey =
  | 'department'
  | 'employee'
  | 'customer'
  | 'supplier'
  | 'productCategory'
  | 'product'
  | 'expenseCategory'
  | 'expense'
  | 'payment'

interface CrudOptions {
  createSchema: ZodType<any>
  updateSchema: ZodType<any>
  entityLabel: string
  /** permission keys, e.g. { read: 'customers.read', create: 'customers.create', update: 'customers.update', del: 'customers.delete' } */
  permissions: { read: string; create: string; update: string; del: string }
  /** soft-delete via deletedAt (default true); false = hard delete */
  softDelete?: boolean
  /** called after a successful create, e.g. to fire notifications */
  afterCreate?: (created: { id: string }, organizationId: string) => Promise<void>
  /**
   * Validate foreign-key references before create. Throw AppError(404) when a
   * referenced record belongs to another organization — this closes the
   * cross-tenant FK gap (e.g. creating a payment against another org's invoice).
   */
  validateCreate?: (body: Record<string, unknown>, organizationId: string) => Promise<void>
}

/**
 * Tenant-scoped CRUD. Every query is forced through
 * `organizationId = req.member.organizationId` — cross-tenant reads
 * return 404 (never 403, to avoid leaking existence).
 */
export function crudRouter(model: ModelKey, opts: CrudOptions) {
  const router = Router()
  router.use(authenticate)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (prisma as any)[model]
  const softDelete = opts.softDelete ?? true

  const alive = { deletedAt: null }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const validId = (raw: string): string => {
    if (!UUID_RE.test(raw)) throw new AppError(400, 'BAD_REQUEST', 'Invalid ID format')
    return raw
  }
  const scoped = (req: { member?: { organizationId: string } }, extra: Record<string, unknown> = {}) => ({
    organizationId: req.member!.organizationId,
    ...(softDelete ? alive : {}),
    ...extra,
  })

  router.get('/', requirePermission(opts.permissions.read), async (req, res, next) => {
    try {
      const { take, skip } = pagination.parse(req.query)
      const query = { ...req.query } as Record<string, string>
      delete query.take
      delete query.skip
      const data = await db.findMany({
        where: scoped(req, query),
        take,
        skip,
        orderBy: { createdAt: 'desc' },
      })
      res.json(data)
    } catch (e) {
      next(e)
    }
  })

  router.get('/:id', requirePermission(opts.permissions.read), async (req, res, next) => {
    try {
      const data = await db.findFirst({ where: scoped(req, { id: validId(String(req.params.id)) }) })
      if (!data) throw new AppError(404, 'NOT_FOUND', `${opts.entityLabel} not found`)
      res.json(data)
    } catch (e) {
      next(e)
    }
  })

  router.post('/', requirePermission(opts.permissions.create), async (req, res, next) => {
    try {
      const body = opts.createSchema.parse(req.body)
      const organizationId = req.member!.organizationId
      if (opts.validateCreate) {
        await opts.validateCreate(body as Record<string, unknown>, organizationId)
      }
      const data = await db.create({
        data: { ...body, organizationId },
      })
      await logAudit({
        organizationId: req.member!.organizationId,
        memberId: req.member!.memberId,
        action: 'CREATE',
        entity: opts.entityLabel,
        entityId: data.id,
      })
      if (opts.afterCreate) {
        await opts.afterCreate(data as { id: string }, req.member!.organizationId)
      }
      res.status(201).json(data)
    } catch (e) {
      next(e)
    }
  })

  router.patch('/:id', requirePermission(opts.permissions.update), async (req, res, next) => {
    try {
      const body = opts.updateSchema.parse(req.body)
      const existing = await db.findFirst({
        where: scoped(req, { id: validId(String(req.params.id)) }),
      })
      if (!existing) throw new AppError(404, 'NOT_FOUND', `${opts.entityLabel} not found`)
      const data = await db.update({ where: { id: existing.id }, data: body })
      await logAudit({
        organizationId: req.member!.organizationId,
        memberId: req.member!.memberId,
        action: 'UPDATE',
        entity: opts.entityLabel,
        entityId: data.id,
      })
      res.json(data)
    } catch (e) {
      next(e)
    }
  })

  router.delete('/:id', requirePermission(opts.permissions.del), async (req, res, next) => {
    try {
      const existing = await db.findFirst({
        where: scoped(req, { id: validId(String(req.params.id)) }),
      })
      if (!existing) throw new AppError(404, 'NOT_FOUND', `${opts.entityLabel} not found`)
      if (softDelete) {
        await db.update({ where: { id: existing.id }, data: { deletedAt: new Date() } })
      } else {
        await db.delete({ where: { id: existing.id } })
      }
      await logAudit({
        organizationId: req.member!.organizationId,
        memberId: req.member!.memberId,
        action: 'DELETE',
        entity: opts.entityLabel,
        entityId: existing.id,
      })
      res.status(204).end()
    } catch (e) {
      next(e)
    }
  })

  return router
}
