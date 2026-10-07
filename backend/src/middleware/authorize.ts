import type { NextFunction, Request, Response } from 'express'
import { AppError } from '../utils/errors'

/**
 * Requires the member to hold at least one of the given permission keys.
 * The wildcard '*' (Owner role) grants everything.
 */
export function requirePermission(...keys: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const perms = req.member?.permissions ?? []
    if (!req.member) {
      return next(new AppError(401, 'UNAUTHORIZED', 'Not authenticated'))
    }
    if (perms.includes('*') || keys.some((k) => perms.includes(k))) {
      return next()
    }
    next(
      new AppError(
        403,
        'FORBIDDEN',
        `You do not have permission for this action (needs: ${keys.join(' or ')})`,
      ),
    )
  }
}
