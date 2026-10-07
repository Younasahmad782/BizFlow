import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/authorize'
import { createEmployeeSchema } from '../schemas/entities'
import { logAudit } from '../services/audit'
import { notifyEmployeeAdded } from '../services/notifications'
import { AppError } from '../utils/errors'

const router = Router()
router.use(authenticate)

const dec = (d: unknown): string => (d as { toString(): string }).toString()

/** Salary is only visible to members with the employees.salary permission. */
function canSeeSalary(perms: string[]): boolean {
  return perms.includes('*') || perms.includes('employees.salary')
}

function shapeEmployee(e: { salary: unknown }, showSalary: boolean) {
  const { salary, ...rest } = e as Record<string, unknown>
  return { ...rest, salary: showSalary && salary != null ? dec(salary) : undefined }
}

const listQuery = z.object({
  search: z.string().max(120).optional(),
  departmentId: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  roleId: z.string().optional(),
  sortBy: z.enum(['name', 'employeeId', 'hireDate']).default('name'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  take: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
})

const include = {
  department: { select: { id: true, name: true } },
  role: { select: { id: true, name: true } },
}

async function nextEmployeeId(organizationId: string): Promise<string> {
  const last = await prisma.employee.findFirst({
    where: { organizationId, employeeId: { startsWith: 'EMP-' } },
    orderBy: { employeeId: 'desc' },
    select: { employeeId: true },
  })
  const num = last ? parseInt(last.employeeId.replace('EMP-', ''), 10) || 1041 : 1041
  return `EMP-${num + 1}`
}

// GET /api/employees — search, filter by department/status, paginate
router.get('/', requirePermission('employees.read'), async (req, res, next) => {
  try {
    const q = listQuery.parse(req.query)
    const organizationId = req.member!.organizationId
    const showSalary = canSeeSalary(req.member!.permissions)

    const where: Record<string, unknown> = { organizationId, deletedAt: null }
    if (q.departmentId) where.departmentId = q.departmentId
    if (q.roleId) where.roleId = q.roleId
    if (q.status === 'active') where.isActive = true
    if (q.status === 'inactive') where.isActive = false
    if (q.search) {
      const s = q.search.trim()
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { employeeId: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s, mode: 'insensitive' } },
      ]
    }

    const [total, data] = await Promise.all([
      prisma.employee.count({ where }),
      prisma.employee.findMany({
        where,
        include,
        take: q.take,
        skip: q.skip,
        orderBy: { [q.sortBy]: q.sortDir },
      }),
    ])
    res.json({
      data: data.map((e) => shapeEmployee(e, showSalary)),
      total,
      take: q.take,
      skip: q.skip,
      salaryVisible: showSalary,
    })
  } catch (e) {
    next(e)
  }
})

// GET /api/employees/departments — department list for filters
router.get('/departments', requirePermission('employees.read'), async (req, res, next) => {
  try {
    const departments = await prisma.department.findMany({
      where: { organizationId: req.member!.organizationId, deletedAt: null },
      orderBy: { name: 'asc' },
      include: { _count: { select: { employees: true } } },
    })
    res.json(departments)
  } catch (e) {
    next(e)
  }
})

// GET /api/employees/:id — profile; salary gated by permission
router.get('/:id', requirePermission('employees.read'), async (req, res, next) => {
  try {
    const employee = await prisma.employee.findFirst({
      where: { id: String(req.params.id), organizationId: req.member!.organizationId, deletedAt: null },
      include,
    })
    if (!employee) throw new AppError(404, 'NOT_FOUND', 'Employee not found')
    res.json({ ...shapeEmployee(employee, canSeeSalary(req.member!.permissions)), salaryVisible: canSeeSalary(req.member!.permissions) })
  } catch (e) {
    next(e)
  }
})

// POST /api/employees — salary requires employees.salary permission
router.post('/', requirePermission('employees.create'), async (req, res, next) => {
  try {
    const input = createEmployeeSchema.parse(req.body)
    const organizationId = req.member!.organizationId
    const showSalary = canSeeSalary(req.member!.permissions)

    if (input.departmentId) {
      const dept = await prisma.department.findFirst({
        where: { id: input.departmentId, organizationId, deletedAt: null },
      })
      if (!dept) throw new AppError(400, 'BAD_REQUEST', 'Invalid department')
    }
    if (input.roleId) {
      const role = await prisma.role.findFirst({ where: { id: input.roleId, organizationId } })
      if (!role) throw new AppError(400, 'BAD_REQUEST', 'Invalid role')
    }

    const employee = await prisma.employee.create({
      data: {
        organizationId,
        employeeId: await nextEmployeeId(organizationId),
        name: input.name,
        email: input.email,
        phone: input.phone,
        departmentId: input.departmentId,
        roleId: input.roleId,
        title: input.title,
        // salary is silently dropped without the permission — never stored from unauthorized input
        ...(showSalary && input.salary != null ? { salary: input.salary } : {}),
        hireDate: input.hireDate,
        isActive: input.isActive,
      },
      include,
    })
    await logAudit({
      organizationId,
      memberId: req.member!.memberId,
      action: 'CREATE',
      entity: 'Employee',
      entityId: employee.id,
    })
    await notifyEmployeeAdded(prisma, organizationId, employee.name)
    res.status(201).json(shapeEmployee(employee, showSalary))
  } catch (e) {
    next(e)
  }
})

// PATCH /api/employees/:id — salary changes require employees.salary
router.patch('/:id', requirePermission('employees.update'), async (req, res, next) => {
  try {
    const input = createEmployeeSchema.partial().parse(req.body)
    const organizationId = req.member!.organizationId
    const showSalary = canSeeSalary(req.member!.permissions)

    const existing = await prisma.employee.findFirst({
      where: { id: String(req.params.id), organizationId, deletedAt: null },
    })
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Employee not found')

    if (input.departmentId) {
      const dept = await prisma.department.findFirst({
        where: { id: input.departmentId, organizationId, deletedAt: null },
      })
      if (!dept) throw new AppError(400, 'BAD_REQUEST', 'Invalid department')
    }
    if (input.roleId) {
      const role = await prisma.role.findFirst({ where: { id: input.roleId, organizationId } })
      if (!role) throw new AppError(400, 'BAD_REQUEST', 'Invalid role')
    }

    const { salary, ...rest } = input
    const employee = await prisma.employee.update({
      where: { id: existing.id },
      data: {
        ...rest,
        ...(showSalary && salary !== undefined ? { salary } : {}),
      },
      include,
    })
    await logAudit({
      organizationId,
      memberId: req.member!.memberId,
      action: 'UPDATE',
      entity: 'Employee',
      entityId: employee.id,
    })
    res.json(shapeEmployee(employee, showSalary))
  } catch (e) {
    next(e)
  }
})

// DELETE /api/employees/:id — soft delete
router.delete('/:id', requirePermission('employees.delete'), async (req, res, next) => {
  try {
    const organizationId = req.member!.organizationId
    const existing = await prisma.employee.findFirst({
      where: { id: String(req.params.id), organizationId, deletedAt: null },
    })
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Employee not found')
    await prisma.employee.update({ where: { id: existing.id }, data: { deletedAt: new Date() } })
    await logAudit({
      organizationId,
      memberId: req.member!.memberId,
      action: 'DELETE',
      entity: 'Employee',
      entityId: existing.id,
    })
    res.status(204).end()
  } catch (e) {
    next(e)
  }
})

export default router
