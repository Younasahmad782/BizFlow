import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../lib/prisma'
import { AppError } from '../utils/errors'

export interface AuthMember {
  memberId: string
  userId: string
  organizationId: string
  email: string
  name: string
  roleName: string
  permissions: string[]
  /** token version — must match the user's current tokenVersion */
  tv: number
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      member?: AuthMember
      /** Set by authenticateForSwitch: the user choosing an organization. */
      switchUserId?: string
    }
  }
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    console.warn('WARNING: JWT_SECRET not set — using insecure dev default')
    return 'dev-secret-change-me'
  }
  return secret
}

export const JWT_SECRET = getSecret()

export function signToken(member: Omit<AuthMember, 'tv'> & { tv: number }): string {
  return jwt.sign(
    {
      memberId: member.memberId,
      userId: member.userId,
      organizationId: member.organizationId,
      email: member.email,
      name: member.name,
      roleName: member.roleName,
      permissions: member.permissions,
      tv: member.tv,
    },
    JWT_SECRET,
    { expiresIn: '7d' },
  )
}

/**
 * Short-lived token issued at login when a user has multiple active
 * memberships. It proves identity but grants NO organization access —
 * its only purpose is to call POST /auth/switch-organization and pick
 * which organization to enter. Expires in 10 minutes.
 */
export interface SelectTokenPayload {
  userId: string
  email: string
  name: string
  purpose: 'org_select'
  tv: number
}

export function signSelectToken(user: {
  id: string
  email: string
  name: string
  tokenVersion: number
}): string {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      name: user.name,
      purpose: 'org_select',
      tv: user.tokenVersion,
    } satisfies SelectTokenPayload,
    JWT_SECRET,
    { expiresIn: '10m' },
  )
}

/**
 * Verifies the JWT signature AND the session: the token's version must
 * match the user's current tokenVersion (bumped on logout / password
 * change), and the membership must still be active.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return next(new AppError(401, 'UNAUTHORIZED', 'Missing or invalid authorization header'))
  }
  let payload: AuthMember
  try {
    payload = jwt.verify(header.slice(7), JWT_SECRET) as AuthMember
  } catch {
    return next(new AppError(401, 'UNAUTHORIZED', 'Invalid or expired token'))
  }
  // A select token (purpose 'org_select') is not a session token.
  if (!payload.memberId || !payload.userId || !payload.organizationId) {
    return next(new AppError(401, 'UNAUTHORIZED', 'Invalid or expired token'))
  }

  try {
    const member = await prisma.organizationMember.findUnique({
      where: { id: payload.memberId },
      select: {
        isActive: true,
        organizationId: true,
        userId: true,
        user: { select: { tokenVersion: true } },
      },
    })
    if (!member || !member.isActive) {
      return next(new AppError(401, 'UNAUTHORIZED', 'Account is no longer active'))
    }
    if (member.organizationId !== payload.organizationId || member.userId !== payload.userId) {
      return next(new AppError(401, 'UNAUTHORIZED', 'Session is no longer valid'))
    }
    if (member.user.tokenVersion !== payload.tv) {
      return next(
        new AppError(401, 'SESSION_EXPIRED', 'Your session has expired. Please log in again.'),
      )
    }
    req.member = payload
    next()
  } catch (e) {
    next(e)
  }
}

/**
 * For POST /auth/switch-organization. Accepts EITHER a full session token
 * (an already-logged-in user switching orgs) OR a short-lived select token
 * (a user with several memberships who just logged in and hasn't picked an
 * org yet). Sets req.switchUserId — never grants any organization access
 * by itself.
 */
export async function authenticateForSwitch(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return next(new AppError(401, 'UNAUTHORIZED', 'Missing or invalid authorization header'))
  }
  let payload: (AuthMember | SelectTokenPayload) & { purpose?: string }
  try {
    payload = jwt.verify(header.slice(7), JWT_SECRET) as typeof payload
  } catch {
    return next(new AppError(401, 'UNAUTHORIZED', 'Invalid or expired token'))
  }

  try {
    if (payload.purpose === 'org_select') {
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { id: true, tokenVersion: true },
      })
      if (!user || user.tokenVersion !== payload.tv) {
        return next(new AppError(401, 'SESSION_EXPIRED', 'Session expired. Please log in again.'))
      }
      req.switchUserId = user.id
      return next()
    }
    // Full session token: fall back to the same checks as authenticate.
    const full = payload as AuthMember
    if (!full.memberId || !full.userId || !full.organizationId) {
      return next(new AppError(401, 'UNAUTHORIZED', 'Invalid or expired token'))
    }
    const member = await prisma.organizationMember.findUnique({
      where: { id: full.memberId },
      select: {
        isActive: true,
        organizationId: true,
        userId: true,
        user: { select: { tokenVersion: true } },
      },
    })
    if (
      !member ||
      !member.isActive ||
      member.organizationId !== full.organizationId ||
      member.userId !== full.userId ||
      member.user.tokenVersion !== full.tv
    ) {
      return next(new AppError(401, 'UNAUTHORIZED', 'Session is no longer valid'))
    }
    req.switchUserId = member.userId
    next()
  } catch (e) {
    next(e)
  }
}
