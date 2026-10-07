/**
 * RBAC permission catalog — the exact permission keys BIZFLOW grants.
 * Format: <resource>.<action>
 */

/** Every grantable permission key. */
export const ALL_PERMISSIONS = [
  // customers
  'customers.read',
  'customers.create',
  'customers.update',
  'customers.delete',
  // products (also covers suppliers, product categories, inventory)
  'products.read',
  'products.create',
  'products.update',
  'products.delete',
  // orders
  'orders.read',
  'orders.create',
  'orders.update',
  'orders.delete',
  // invoices (also covers payments)
  'invoices.read',
  'invoices.create',
  'invoices.update',
  'invoices.delete',
  // expenses (also covers expense categories)
  'expenses.read',
  'expenses.create',
  'expenses.update',
  'expenses.delete',
  // employees (also covers departments, team members & roles)
  'employees.read',
  'employees.create',
  'employees.update',
  'employees.delete',
  // salary visibility is gated separately at the API level
  'employees.salary',
  // workspace-wide
  'reports.read',
  'settings.manage',
  'audit_logs.read',
] as const

export type PermissionKey = (typeof ALL_PERMISSIONS)[number]

const READ_KEYS: PermissionKey[] = [
  'customers.read',
  'products.read',
  'orders.read',
  'invoices.read',
  'expenses.read',
  'employees.read',
  'reports.read',
  'audit_logs.read',
]

const CRUD = (resource: string): PermissionKey[] =>
  ['read', 'create', 'update', 'delete'].map(
    (a) => `${resource}.${a}` as PermissionKey,
  )

/**
 * System role templates. OWNER keeps the literal '*' wildcard (grants
 * everything, including future permissions). ADMIN gets everything except
 * settings.manage.
 */
export const ROLE_TEMPLATES: Record<string, PermissionKey[] | ['*']> = {
  OWNER: ['*'],
  ADMIN: ALL_PERMISSIONS.filter((k) => k !== 'settings.manage') as PermissionKey[],
  MANAGER: [
    ...CRUD('customers'),
    ...CRUD('products'),
    ...CRUD('orders'),
    ...CRUD('invoices'),
    ...CRUD('employees'),
    'reports.read',
  ],
  EMPLOYEE: ['customers.read', 'orders.create', 'orders.read'],
  VIEWER: READ_KEYS,
}

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  OWNER: 'Full access to everything in the workspace',
  ADMIN: 'Almost all operational permissions (except workspace settings)',
  MANAGER: 'Customers, products, orders, invoices and reports',
  EMPLOYEE: 'View customers; view and create orders',
  VIEWER: 'Read-only access',
}

import type { Prisma, PrismaClient } from '@prisma/client'

type Tx = Prisma.TransactionClient

/** Idempotently ensures every permission key exists (global catalog). */
export async function ensureGlobalPermissions(tx: Tx): Promise<void> {
  await tx.permission.createMany({
    data: [
      ...ALL_PERMISSIONS.map((key) => {
        const [resource, action] = key.split('.')
        return {
          key,
          description: `${action} ${resource.replace(/-/g, ' ')}`,
        }
      }),
      { key: '*', description: 'All permissions (owner wildcard)' },
    ],
    skipDuplicates: true,
  })
}

/** Creates the 5 system roles for an organization. Returns name → roleId. */
export async function createSystemRoles(
  tx: Tx,
  organizationId: string,
): Promise<Map<string, string>> {
  const permissions = await tx.permission.findMany({
    where: { key: { in: [...ALL_PERMISSIONS, '*'] } },
    select: { id: true, key: true },
  })
  const permIdByKey = new Map(permissions.map((p) => [p.key, p.id]))
  const roleIds = new Map<string, string>()

  for (const [name, keys] of Object.entries(ROLE_TEMPLATES)) {
    const role = await tx.role.create({
      data: {
        organizationId,
        name,
        description: ROLE_DESCRIPTIONS[name] ?? `System role: ${name}`,
        isSystem: true,
      },
    })
    roleIds.set(name, role.id)

    // OWNER keeps the literal '*' wildcard; other roles get resolved keys
    const resolvedIds =
      name === 'OWNER'
        ? [permIdByKey.get('*')!]
        : (keys as PermissionKey[])
            .map((k) => permIdByKey.get(k))
            .filter((id): id is string => !!id)

    await tx.rolePermission.createMany({
      data: resolvedIds.map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    })
  }
  return roleIds
}

/** Effective permission keys for a role (resolves the OWNER wildcard). */
export async function permissionsForRole(
  prisma: PrismaClient | Tx,
  roleId: string,
): Promise<string[]> {
  const rows = await prisma.rolePermission.findMany({
    where: { roleId },
    include: { permission: { select: { key: true } } },
  })
  const keys = rows.map((r) => r.permission.key)
  if (keys.includes('*')) return ['*']
  return keys
}
