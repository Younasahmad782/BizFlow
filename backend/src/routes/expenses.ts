import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/authorize'
import { createExpenseSchema } from '../schemas/entities'
import { logAudit } from '../services/audit'
import { AppError } from '../utils/errors'

const router = Router()
router.use(authenticate)

const dec = (d: unknown): string => (d as { toString(): string }).toString()

const listQuery = z.object({
  search: z.string().max(120).optional(),
  categoryId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  take: z.coerce.number().int().min(1).max(100).default(20),
  skip: z.coerce.number().int().min(0).default(0),
})

function shapeExpense(e: { amount: unknown }) {
  return { ...e, amount: dec(e.amount) }
}

// GET /api/expenses — search, filter by category/date, paginate
router.get('/', requirePermission('expenses.read'), async (req, res, next) => {
  try {
    const q = listQuery.parse(req.query)
    const organizationId = req.member!.organizationId

    const where: Record<string, unknown> = { organizationId, deletedAt: null }
    if (q.categoryId) where.categoryId = q.categoryId
    if (q.search) {
      where.description = { contains: q.search.trim(), mode: 'insensitive' }
    }
    if (q.from || q.to) {
      where.expenseDate = {
        ...(q.from ? { gte: q.from } : {}),
        ...(q.to ? { lte: q.to } : {}),
      }
    }

    const [total, sum, data] = await Promise.all([
      prisma.expense.count({ where }),
      prisma.expense.aggregate({ where, _sum: { amount: true } }),
      prisma.expense.findMany({
        where,
        include: { category: { select: { id: true, name: true } } },
        take: q.take,
        skip: q.skip,
        orderBy: { expenseDate: q.sortDir },
      }),
    ])

    res.json({
      data: data.map(shapeExpense),
      total,
      totalAmount: Number(sum._sum.amount ?? 0),
      take: q.take,
      skip: q.skip,
    })
  } catch (e) {
    next(e)
  }
})

// GET /api/expenses/monthly — per-month totals for the last 12 months
router.get('/monthly', requirePermission('expenses.read'), async (req, res, next) => {
  try {
    const organizationId = req.member!.organizationId
    const rows: { month: string; total: string }[] = await prisma.$queryRaw`
      SELECT TO_CHAR("expenseDate", 'YYYY-MM') AS month, SUM(amount)::text AS total
      FROM "Expense"
      WHERE "organizationId" = ${organizationId}::uuid AND "deletedAt" IS NULL
        AND "expenseDate" >= NOW() - INTERVAL '12 months'
      GROUP BY 1
      ORDER BY 1
    `
    res.json(
      rows.map((r) => ({
        month: r.month,
        label: new Date(r.month + '-02').toLocaleDateString('en-PK', {
          month: 'short',
          year: 'numeric',
        }),
        total: Number(r.total),
      })),
    )
  } catch (e) {
    next(e)
  }
})

// GET /api/expenses/categories — for the filter dropdown
router.get('/categories', requirePermission('expenses.read'), async (req, res, next) => {
  try {
    const categories = await prisma.expenseCategory.findMany({
      where: { organizationId: req.member!.organizationId, deletedAt: null },
      orderBy: { name: 'asc' },
    })
    res.json(categories)
  } catch (e) {
    next(e)
  }
})

// POST /api/expenses
router.post('/', requirePermission('expenses.create'), async (req, res, next) => {
  try {
    const input = createExpenseSchema.parse(req.body)
    const organizationId = req.member!.organizationId

    if (input.categoryId) {
      const cat = await prisma.expenseCategory.findFirst({
        where: { id: input.categoryId, organizationId, deletedAt: null },
      })
      if (!cat) throw new AppError(400, 'BAD_REQUEST', 'Invalid category')
    }

    const expense = await prisma.expense.create({
      data: { ...input, organizationId },
      include: { category: { select: { id: true, name: true } } },
    })
    await logAudit({
      organizationId,
      memberId: req.member!.memberId,
      action: 'CREATE',
      entity: 'Expense',
      entityId: expense.id,
    })
    res.status(201).json(shapeExpense(expense))
  } catch (e) {
    next(e)
  }
})

// PATCH /api/expenses/:id
router.patch('/:id', requirePermission('expenses.update'), async (req, res, next) => {
  try {
    const input = createExpenseSchema.partial().parse(req.body)
    const organizationId = req.member!.organizationId
    const existing = await prisma.expense.findFirst({
      where: { id: String(req.params.id), organizationId, deletedAt: null },
    })
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Expense not found')

    const expense = await prisma.expense.update({
      where: { id: existing.id },
      data: input,
      include: { category: { select: { id: true, name: true } } },
    })
    await logAudit({
      organizationId,
      memberId: req.member!.memberId,
      action: 'UPDATE',
      entity: 'Expense',
      entityId: expense.id,
    })
    res.json(shapeExpense(expense))
  } catch (e) {
    next(e)
  }
})

// DELETE /api/expenses/:id — soft delete
router.delete('/:id', requirePermission('expenses.delete'), async (req, res, next) => {
  try {
    const organizationId = req.member!.organizationId
    const existing = await prisma.expense.findFirst({
      where: { id: String(req.params.id), organizationId, deletedAt: null },
    })
    if (!existing) throw new AppError(404, 'NOT_FOUND', 'Expense not found')
    await prisma.expense.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    })
    await logAudit({
      organizationId,
      memberId: req.member!.memberId,
      action: 'DELETE',
      entity: 'Expense',
      entityId: existing.id,
    })
    res.status(204).end()
  } catch (e) {
    next(e)
  }
})

export default router
