import type { AuditAction, Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'

interface AuditInput {
  organizationId: string
  memberId?: string
  actorName?: string
  action: AuditAction
  entity: string
  entityId?: string
  details?: Prisma.InputJsonValue
}

/**
 * Keys that must never appear in audit details. Values are replaced with
 * '[REDACTED]' — passwords, tokens and secrets are never stored in the log.
 */
const SENSITIVE_KEYS = [
  'password',
  'passwordhash',
  'newpassword',
  'currentpassword',
  'token',
  'refreshtoken',
  'accesstoken',
  'resettoken',
  'secret',
  'apikey',
  'api_key',
  'otp',
  'pin',
  'cvv',
  'cardnumber',
  'authorization',
]

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.includes(k.toLowerCase()) ? '[REDACTED]' : scrub(v)
    }
    return out
  }
  return value
}

/** Fire-and-forget audit trail — never throws into the request path. */
export async function logAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: input.organizationId,
        memberId: input.memberId,
        actorName: input.actorName,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        details: input.details != null ? (scrub(input.details) as Prisma.InputJsonValue) : undefined,
      },
    })
  } catch (e) {
    console.error('Audit log failed:', e)
  }
}

const ACTION_VERB: Record<string, string> = {
  CREATE: 'created',
  UPDATE: 'updated',
  DELETE: 'deleted',
  LOGIN: 'logged in',
  LOGOUT: 'logged out',
  ROLE_CHANGE: 'changed the role of',
  PASSWORD_CHANGE: 'changed the password for',
}

const ENTITY_LABEL: Record<string, string> = {
  OrganizationMember: 'team member',
  Product: 'product',
  Customer: 'customer',
  Supplier: 'supplier',
  Employee: 'employee',
  Expense: 'expense',
  Invoice: 'invoice',
  Order: 'order',
  Payment: 'payment',
  InventoryTransaction: 'inventory adjustment',
}

/** Human-readable one-liner, e.g. "Muhammad Saad created order ORD-2026-00124". */
export function summarizeLog(log: {
  actorName?: string | null
  member?: { name?: string | null } | null
  action: string
  entity: string
  details?: unknown
}): string {
  const actor = log.actorName ?? log.member?.name ?? 'System'
  const verb = ACTION_VERB[log.action] ?? log.action.toLowerCase()

  if (log.action === 'LOGIN') return `${actor} logged in`
  if (log.action === 'LOGOUT') return `${actor} logged out`
  if (log.action === 'PASSWORD_CHANGE') return `${actor} changed their password`

  const d = (log.details ?? {}) as Record<string, unknown>
  const ref =
    (d.orderNumber as string) ||
    (d.invoiceNumber as string) ||
    (d.employeeId as string) ||
    (d.name as string) ||
    (d.productName as string) ||
    ''

  if (log.action === 'ROLE_CHANGE') {
    const target = (d.targetName as string) ?? 'a team member'
    const role = (d.newRole as string) ?? ''
    return `${actor} changed ${target}'s role${role ? ` to ${role}` : ''}`.trim()
  }

  const entityLabel = ENTITY_LABEL[log.entity] ?? log.entity.toLowerCase()
  const quoted = ref && !/^(ORD|INV|EMP)-/.test(ref) ? `"${ref}"` : ref
  return `${actor} ${verb} ${entityLabel}${quoted ? ` ${quoted}` : ''}`.trim()
}
