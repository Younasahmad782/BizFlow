import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { ALL_PERMISSIONS } from '../auth/permissions'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/authorize'
import { logAudit } from '../services/audit'
import { AppError } from '../utils/errors'

const router = Router()
router.use(authenticate)

// GET /api/roles — roles of my org with their permission keys
router.get('/', requirePermission('employees.read'), async (req, res, next) => {
  try {
    const roles = await prisma.role.findMany({
      where: { organizationId: req.member!.organizationId },
      include: { permissions: { include: { permission: { select: { key: true } } } } },
      orderBy: { name: 'asc' },
    })
    res.json(
      roles.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        permissions: r.permissions.map((rp) => rp.permission.key),
      })),
    )
  } catch (e) {
    next(e)
  }
})

// GET /api/roles/permissions/catalog — all available permission keys
router.get(
  '/permissions/catalog',
  requirePermission('employees.read'),
  (_req, res) => {
    res.json(ALL_PERMISSIONS)
  },
)

// POST /api/roles — create a custom role (Owner only)
router.post('/', requirePermission('employees.create'), async (req, res, next) => {
  try {
    const input = z
      .object({
        name: z.string().min(2).max(60),
        description: z.string().max(255).optional(),
        permissions: z.array(z.string()).min(1),
      })
      .parse(req.body)

    if (req.member!.roleName !== 'OWNER') {
      throw new AppError(403, 'FORBIDDEN', 'Only owners can create roles')
    }

    const unknown = input.permissions.filter(
      (k) => !(ALL_PERMISSIONS as readonly string[]).includes(k),
    )
    if (unknown.length) {
      throw new AppError(400, 'BAD_REQUEST', `Unknown permissions: ${unknown.join(', ')}`)
    }

    const organizationId = req.member!.organizationId
    const role = await prisma.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: { organizationId, name: input.name, description: input.description },
      })
      const perms = await tx.permission.findMany({
        where: { key: { in: input.permissions } },
        select: { id: true },
      })
      await tx.rolePermission.createMany({
        data: perms.map((p) => ({ roleId: created.id, permissionId: p.id })),
      })
      return created
    })

    await logAudit({
      organizationId,
      memberId: req.member!.memberId,
      action: 'CREATE',
      entity: 'Role',
      entityId: role.id,
    })
    res.status(201).json(role)
  } catch (e) {
    next(e)
  }
})

export default router
