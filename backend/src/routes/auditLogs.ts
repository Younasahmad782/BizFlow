import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/authorize'
import { pagination } from '../schemas/common'
import { summarizeLog } from '../services/audit'

const router = Router()
router.use(authenticate)

const listQuery = z.object({
  action: z.string().optional(),
  entity: z.string().optional(),
  actor: z.string().max(120).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

// GET /api/audit-logs — only members with audit_logs.read. Never exposes
// passwords/tokens: details are scrubbed at write time (see services/audit).
router.get('/', requirePermission('audit_logs.read'), async (req, res, next) => {
  try {
    const { take, skip } = pagination.parse(req.query)
    const q = listQuery.parse(req.query)
    const organizationId = req.member!.organizationId

    const where: Record<string, unknown> = { organizationId }
    if (q.action) where.action = q.action
    if (q.entity) where.entity = q.entity
    if (q.actor) {
      const s = q.actor.trim()
      where.OR = [
        { actorName: { contains: s, mode: 'insensitive' } },
        { member: { user: { name: { contains: s, mode: 'insensitive' } } } },
      ]
    }
    if (q.from || q.to) {
      where.createdAt = {
        ...(q.from ? { gte: q.from } : {}),
        ...(q.to ? { lte: q.to } : {}),
      }
    }

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: 'desc' },
        include: { member: { select: { id: true, user: { select: { name: true } } } } },
      }),
    ])

    res.json({
      data: logs.map((l) => ({
        id: l.id,
        actor: l.actorName ?? l.member?.user?.name ?? 'System',
        action: l.action,
        entity: l.entity,
        entityId: l.entityId,
        details: l.details,
        createdAt: l.createdAt.toISOString(),
        summary: summarizeLog({
          actorName: l.actorName,
          member: l.member ? { name: l.member.user?.name ?? null } : null,
          action: l.action,
          entity: l.entity,
          details: l.details,
        }),
      })),
      total,
      take,
      skip,
    })
  } catch (e) {
    next(e)
  }
})

export default router
