import { createHash, randomBytes } from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma'

// Brute-force protection on auth endpoints.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again later' } },
})
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts, try again later' } },
})
import {
  createSystemRoles,
  ensureGlobalPermissions,
  permissionsForRole,
} from '../auth/permissions'
import { authenticate, authenticateForSwitch, signSelectToken, signToken } from '../middleware/authenticate'
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '../schemas/auth'
import { logAudit } from '../services/audit'
import { frontendUrl, getEmailProvider } from '../services/email'
import { AppError } from '../utils/errors'

const router = Router()

const DEFAULT_EXPENSE_CATEGORIES = [
  'Rent',
  'Electricity',
  'Internet',
  'Transport',
  'Salaries',
  'Office Supplies',
  'Maintenance',
  'Marketing',
  'Utilities',
  'Purchases',
  'Other',
]

const DEFAULT_DEPARTMENTS = [
  'Sales',
  'Accounts',
  'Inventory',
  'Operations',
  'Administration',
  'Management',
]

// In production this MUST be false and reset links sent by email.
const DEV_EXPOSE_TOKENS = process.env.ALLOW_DEV_RESET_TOKENS === 'true'
const RESET_TTL_MS = 60 * 60 * 1000 // 1 hour

function toSafeMember(
  user: { id: string; name: string; email: string },
  m: {
    id: string
    organizationId: string
    isActive: boolean
    role: { id: string; name: string }
  },
) {
  return {
    id: m.id,
    userId: user.id,
    organizationId: m.organizationId,
    name: user.name,
    email: user.email,
    isActive: m.isActive,
    role: m.role,
  }
}

async function issueToken(
  user: { id: string; email: string; name: string; tokenVersion: number },
  member: {
    id: string
    organizationId: string
    role: { id: string; name: string }
  },
) {
  const permissions = await permissionsForRole(prisma, member.role.id)
  const token = signToken({
    memberId: member.id,
    userId: user.id,
    organizationId: member.organizationId,
    email: user.email,
    name: user.name,
    roleName: member.role.name,
    permissions,
    tv: user.tokenVersion,
  })
  return { token, permissions }
}

// POST /api/auth/register — Organization + system roles + settings + OWNER member
router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const { organization, user } = registerSchema.parse(req.body)

    const existing = await prisma.user.findUnique({
      where: { email: user.email },
    })
    if (existing) {
      throw new AppError(409, 'CONFLICT', 'An account with this email already exists')
    }

    const passwordHash = await bcrypt.hash(user.password, 12)

    const result = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: organization })
      await ensureGlobalPermissions(tx)
      const roleIds = await createSystemRoles(tx, org.id)
      await tx.businessSetting.create({ data: { organizationId: org.id } })
      await tx.expenseCategory.createMany({
        data: DEFAULT_EXPENSE_CATEGORIES.map((name) => ({
          organizationId: org.id,
          name,
        })),
        skipDuplicates: true,
      })
      await tx.department.createMany({
        data: DEFAULT_DEPARTMENTS.map((name) => ({
          organizationId: org.id,
          name,
        })),
        skipDuplicates: true,
      })
      const newUser = await tx.user.create({
        data: {
          name: user.name,
          email: user.email,
          passwordHash,
        },
      })
      const member = await tx.organizationMember.create({
        data: {
          userId: newUser.id,
          organizationId: org.id,
          roleId: roleIds.get('OWNER')!,
        },
        include: { role: { select: { id: true, name: true } } },
      })
      return { org, user: newUser, member }
    })

    const { token, permissions } = await issueToken(result.user, result.member)
    const safeMember = toSafeMember(result.user, result.member)

    await logAudit({
      organizationId: safeMember.organizationId,
      memberId: safeMember.id,
      action: 'CREATE',
      entity: 'Organization',
      entityId: result.org.id,
    })

    res.status(201).json({ token, member: safeMember, organization: result.org, permissions })
  } catch (e) {
    next(e)
  }
})

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body)

    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        members: {
          where: { isActive: true },
          include: {
            organization: true,
            role: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    })
    if (!user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Invalid email or password')
    }
    const ok = await bcrypt.compare(password, user.passwordHash)
    if (!ok) {
      throw new AppError(401, 'UNAUTHORIZED', 'Invalid email or password')
    }
    if (user.members.length === 0) {
      throw new AppError(403, 'FORBIDDEN', 'Your account has no active organization memberships')
    }

    // Multiple organizations → client picks one via /auth/switch-organization
    // using the short-lived select token (it grants no org access by itself).
    if (user.members.length > 1) {
      return res.json({
        user: { id: user.id, name: user.name, email: user.email },
        memberships: user.members.map((m) => ({
          memberId: m.id,
          organizationId: m.organizationId,
          organizationName: m.organization.name,
          roleName: m.role.name,
        })),
        requiresOrgSelection: true,
        selectToken: signSelectToken(user),
      })
    }

    const member = user.members[0]
    const { token, permissions } = await issueToken(user, member)

    await logAudit({
      organizationId: member.organizationId,
      memberId: member.id,
      actorName: user.name,
      action: 'LOGIN',
      entity: 'OrganizationMember',
      entityId: member.id,
    })

    res.json({
      token,
      member: toSafeMember(user, member),
      organization: member.organization,
      permissions,
    })
  } catch (e) {
    next(e)
  }
})

// POST /api/auth/switch-organization — for users in multiple orgs.
// Accepts the short-lived select token from login (or a full session token)
// and issues a full session for the chosen organization.
router.post('/switch-organization', authLimiter, authenticateForSwitch, async (req, res, next) => {
  try {
    const { organizationId } = z.object({ organizationId: z.string().uuid() }).parse(req.body)
    const userId = req.switchUserId!

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) throw new AppError(401, 'UNAUTHORIZED', 'User not found')

    const member = await prisma.organizationMember.findFirst({
      where: { userId, organizationId, isActive: true },
      include: {
        organization: true,
        role: { select: { id: true, name: true } },
      },
    })
    if (!member) throw new AppError(403, 'FORBIDDEN', 'No active membership in this organization')

    const { token, permissions } = await issueToken(user, member)

    await logAudit({
      organizationId: member.organizationId,
      memberId: member.id,
      actorName: user.name,
      action: 'LOGIN',
      entity: 'OrganizationMember',
      entityId: member.id,
      details: { switched: true },
    })

    res.json({
      token,
      member: toSafeMember(user, member),
      organization: member.organization,
      permissions,
    })
  } catch (e) {
    next(e)
  }
})

// POST /api/auth/logout — invalidates all sessions for this user
// (across all organizations) by bumping the token version
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    await prisma.user.update({
      where: { id: req.member!.userId },
      data: { tokenVersion: { increment: 1 } },
    })
    await logAudit({
      organizationId: req.member!.organizationId,
      memberId: req.member!.memberId,
      actorName: req.member!.name,
      action: 'LOGOUT',
      entity: 'OrganizationMember',
      entityId: req.member!.memberId,
    })
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

// GET /api/auth/me
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const member = await prisma.organizationMember.findUnique({
      where: { id: req.member!.memberId },
      include: {
        user: true,
        organization: true,
        role: { select: { id: true, name: true } },
      },
    })
    if (!member || !member.isActive) {
      throw new AppError(401, 'UNAUTHORIZED', 'Account is no longer active')
    }
    const permissions = await permissionsForRole(prisma, member.role.id)
    // Other organizations this user belongs to (for the org switcher)
    const memberships = await prisma.organizationMember.findMany({
      where: { userId: member.userId, isActive: true },
      include: { organization: { select: { id: true, name: true, city: true } } },
      orderBy: { createdAt: 'asc' },
    })
    res.json({
      member: toSafeMember(member.user, member),
      organization: member.organization,
      permissions,
      memberships: memberships.map((m) => ({
        memberId: m.id,
        organizationId: m.organizationId,
        organizationName: m.organization.name,
        organizationCity: m.organization.city,
      })),
    })
  } catch (e) {
    next(e)
  }
})

// POST /api/auth/change-password — requires current password
router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body)

    const member = await prisma.organizationMember.findUnique({
      where: { id: req.member!.memberId },
      include: { user: true },
    })
    if (!member) throw new AppError(401, 'UNAUTHORIZED', 'Account not found')

    const ok = await bcrypt.compare(currentPassword, member.user.passwordHash)
    if (!ok) {
      throw new AppError(401, 'UNAUTHORIZED', 'Current password is incorrect')
    }

    await prisma.user.update({
      where: { id: member.userId },
      data: {
        passwordHash: await bcrypt.hash(newPassword, 12),
        tokenVersion: { increment: 1 }, // log out all sessions, all orgs
      },
    })

    await logAudit({
      organizationId: member.organizationId,
      memberId: member.id,
      actorName: member.user.name,
      action: 'PASSWORD_CHANGE',
      entity: 'OrganizationMember',
      entityId: member.id,
    })

    res.json({ ok: true, message: 'Password changed. Please log in again.' })
  } catch (e) {
    next(e)
  }
})

// POST /api/auth/forgot-password — always 200 (no email enumeration)
router.post('/forgot-password', authLimiter, async (req, res, next) => {
  try {
    const { email } = forgotPasswordSchema.parse(req.body)

    const user = await prisma.user.findUnique({
      where: { email },
      include: { members: { where: { isActive: true }, select: { id: true } } },
    })
    if (user && user.members.length > 0) {
      const rawToken = randomBytes(32).toString('hex')
      const tokenHash = createHash('sha256').update(rawToken).digest('hex')
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + RESET_TTL_MS),
        },
      })
      // The token only ever travels inside the emailed reset URL.
      // It is NEVER written to logs (not even in development).
      const resetUrl = `${frontendUrl()}/reset-password?token=${rawToken}`
      await getEmailProvider().sendPasswordReset({
        to: user.email,
        name: user.name,
        resetUrl,
      })
      if (DEV_EXPOSE_TOKENS) {
        return res.json({
          ok: true,
          message: 'If an account exists, a reset link has been sent.',
          devToken: rawToken,
        })
      }
    }
    res.json({ ok: true, message: 'If an account exists, a reset link has been sent.' })
  } catch (e) {
    next(e)
  }
})

// POST /api/auth/reset-password — consumes a reset token
router.post('/reset-password', async (req, res, next) => {
  try {
    const { token, password } = resetPasswordSchema.parse(req.body)
    const tokenHash = createHash('sha256').update(token).digest('hex')

    const reset = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: { include: { members: { where: { isActive: true }, select: { id: true, organizationId: true } } } } },
    })
    if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
      throw new AppError(400, 'BAD_REQUEST', 'This reset link is invalid or has expired')
    }
    if (reset.user.members.length === 0) {
      throw new AppError(400, 'BAD_REQUEST', 'This reset link is invalid or has expired')
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: reset.userId },
        data: {
          passwordHash: await bcrypt.hash(password, 12),
          tokenVersion: { increment: 1 }, // invalidate all sessions
        },
      })
      await tx.passwordResetToken.update({
        where: { id: reset.id },
        data: { usedAt: new Date() },
      })
      // invalidate any other outstanding tokens for this user
      await tx.passwordResetToken.updateMany({
        where: { userId: reset.userId, usedAt: null, id: { not: reset.id } },
        data: { usedAt: new Date() },
      })
    })

    // Audit in each of the user's active organizations
    for (const m of reset.user.members) {
      await logAudit({
        organizationId: m.organizationId,
        memberId: m.id,
        actorName: reset.user.name,
        action: 'PASSWORD_CHANGE',
        entity: 'OrganizationMember',
        entityId: m.id,
        details: { via: 'password reset' },
      })
    }

    res.json({ ok: true, message: 'Password has been reset. Please log in.' })
  } catch (e) {
    next(e)
  }
})

export default router
