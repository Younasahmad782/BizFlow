import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/authorize'
import { createMemberSchema } from '../schemas/auth'
import { logAudit } from '../services/audit'
import { AppError } from '../utils/errors'

const router = Router()
router.use(authenticate)

const SAFE_SELECT = {
  id: true,
  isActive: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true } },
  role: { select: { id: true, name: true } },
} as const

// GET /api/members
router.get('/', requirePermission('employees.read'), async (req, res, next) => {
  try {
    const members = await prisma.organizationMember.findMany({
      where: { organizationId: req.member!.organizationId },
      select: SAFE_SELECT,
      orderBy: { createdAt: 'asc' },
    })
    // Flatten for API compatibility: { id, name, email, ... }
    res.json(
      members.map((m) => ({
        id: m.id,
        name: m.user.name,
        email: m.user.email,
        userId: m.user.id,
        isActive: m.isActive,
        createdAt: m.createdAt,
        role: m.role,
      })),
    )
  } catch (e) {
    next(e)
  }
})

// POST /api/members — invite someone to this org. If a User with that email
// already exists, they are linked (one person, many organizations).
router.post('/', requirePermission('employees.create'), async (req, res, next) => {
  try {
    const input = createMemberSchema.parse(req.body)
    const organizationId = req.member!.organizationId

    const role = await prisma.role.findFirst({
      where: { id: input.roleId, organizationId },
    })
    if (!role) throw new AppError(400, 'BAD_REQUEST', 'Invalid role')
    if (role.name === 'OWNER' && req.member!.roleName !== 'OWNER') {
      throw new AppError(403, 'FORBIDDEN', 'Only owners can create owner accounts')
    }

    const alreadyMember = await prisma.organizationMember.findFirst({
      where: { organizationId, user: { email: input.email } },
    })
    if (alreadyMember) {
      throw new AppError(409, 'CONFLICT', 'This person is already a member of the organization')
    }

    const passwordHash = await bcrypt.hash(input.password, 12)
    const user = await prisma.user.upsert({
      where: { email: input.email },
      update: {}, // existing user keeps their password; they join a new org
      create: { name: input.name, email: input.email, passwordHash },
    })
    const member = await prisma.organizationMember.create({
      data: { userId: user.id, organizationId, roleId: role.id },
      select: SAFE_SELECT,
    })

    await logAudit({
      organizationId,
      memberId: req.member!.memberId,
      actorName: req.member!.name,
      action: 'CREATE',
      entity: 'OrganizationMember',
      entityId: member.id,
      details: { name: user.name, email: user.email, role: role.name },
    })
    res.status(201).json({
      id: member.id,
      name: user.name,
      email: user.email,
      userId: user.id,
      isActive: member.isActive,
      createdAt: member.createdAt,
      role: member.role,
    })
  } catch (e) {
    next(e)
  }
})

// PATCH /api/members/:id — change role / active status
router.patch('/:id', requirePermission('employees.update'), async (req, res, next) => {
  try {
    const organizationId = req.member!.organizationId
    const { roleId, isActive } = z
      .object({
        roleId: z.string().uuid().optional(),
        isActive: z.boolean().optional(),
      })
      .parse(req.body)
    const id = String(req.params.id)

    if (id === req.member!.memberId) {
      throw new AppError(400, 'BAD_REQUEST', 'You cannot change your own role or status')
    }
    const target = await prisma.organizationMember.findFirst({
      where: { id, organizationId },
      include: { role: true, user: { select: { name: true } } },
    })
    if (!target) throw new AppError(404, 'NOT_FOUND', 'Member not found')
    if (target.role.name === 'OWNER') {
      throw new AppError(403, 'FORBIDDEN', 'Owner accounts cannot be modified')
    }

    const data: { roleId?: string; isActive?: boolean } = {}
    if (roleId !== undefined) {
      const role = await prisma.role.findFirst({ where: { id: roleId, organizationId } })
      if (!role) throw new AppError(400, 'BAD_REQUEST', 'Invalid role')
      if (role.name === 'OWNER' && req.member!.roleName !== 'OWNER') {
        throw new AppError(403, 'FORBIDDEN', 'Only owners can assign the Owner role')
      }
      data.roleId = role.id
    }
    if (isActive !== undefined) data.isActive = Boolean(isActive)

    const member = await prisma.organizationMember.update({
      where: { id: target.id },
      data,
      select: SAFE_SELECT,
    })
    if (roleId !== undefined && data.roleId) {
      const newRole = await prisma.role.findUnique({ where: { id: data.roleId }, select: { name: true } })
      await logAudit({
        organizationId,
        memberId: req.member!.memberId,
        actorName: req.member!.name,
        action: 'ROLE_CHANGE',
        entity: 'OrganizationMember',
        entityId: member.id,
        details: {
          targetName: target.user.name,
          oldRole: target.role.name,
          newRole: newRole?.name ?? '',
        },
      })
    } else {
      await logAudit({
        organizationId,
        memberId: req.member!.memberId,
        actorName: req.member!.name,
        action: 'UPDATE',
        entity: 'OrganizationMember',
        entityId: member.id,
      })
    }
    res.json({
      id: member.id,
      name: member.user.name,
      email: member.user.email,
      userId: member.user.id,
      isActive: member.isActive,
      createdAt: member.createdAt,
      role: member.role,
    })
  } catch (e) {
    next(e)
  }
})

export default router
