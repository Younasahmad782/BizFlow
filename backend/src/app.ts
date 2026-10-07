import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { authenticate } from './middleware/authenticate'
import { errorHandler } from './middleware/errorHandler'
import assistantRouter from './routes/assistant'
import { prisma } from './lib/prisma'
import { AppError } from './utils/errors'
import auditLogsRouter from './routes/auditLogs'
import authRouter from './routes/auth'
import { crudRouter } from './routes/crud'
import customersRouter from './routes/customers'
import productsRouter from './routes/products'
import suppliersRouter from './routes/suppliers'
import expensesRouter from './routes/expenses'
import employeesRouter from './routes/employees'
import filesRouter from './routes/files'
import inventoryRouter from './routes/inventory'
import invoicesRouter from './routes/invoices'
import membersRouter from './routes/members'
import notificationsRouter from './routes/notifications'
import ordersRouter from './routes/orders'
import reportsRouter from './routes/reports'
import rolesRouter from './routes/roles'
import settingsRouter from './routes/settings'
import {
  createDepartmentSchema,
  createExpenseCategorySchema,
  createPaymentSchema,
  createProductCategorySchema,
} from './schemas/entities'
import { notifyPaymentReceived } from './services/notifications'

const app = express()

// Behind nginx/docker the client IP comes from X-Forwarded-For —
// required for rate limiting to see real IPs. Only one trusted proxy hop.
app.set('trust proxy', 1)

// Security headers (HSTS only when served over HTTPS — enable via env).
app.use(
  helmet({
    hsts: process.env.HSTS_ENABLED === 'true' ? undefined : false,
    crossOriginResourcePolicy: false, // API serves same-app clients
  }),
)

// CORS: explicit allow-list in production, permissive only in development.
const corsOrigins = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)
const isProd = process.env.NODE_ENV === 'production'
if (isProd && corsOrigins.length === 0) {
  console.warn(
    'WARNING: CORS_ORIGIN is not set in production — browser clients from other origins will be blocked',
  )
}
app.use(
  cors({
    origin: corsOrigins.length > 0 ? corsOrigins : !isProd,
    credentials: true,
  }),
)

// Fail fast in production without a real JWT secret.
if (isProd && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production')
}

// Global abuse protection (auth routes have their own stricter limiters).
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_MAX ?? 600),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, try again later' } },
  }),
)

app.use(express.json())

// Public
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'bizflow-api' })
})
app.use('/api/auth', authRouter)

// Authenticated (each router enforces tenancy + permissions)
app.use('/api/members', membersRouter)
app.use('/api/roles', rolesRouter)

app.use('/api/departments', crudRouter('department', {
  createSchema: createDepartmentSchema,
  updateSchema: createDepartmentSchema.partial(),
  entityLabel: 'Department',
  permissions: { read: 'employees.read', create: 'employees.create', update: 'employees.update', del: 'employees.delete' },
}))
app.use('/api/employees', employeesRouter)
app.use('/api/customers', customersRouter)
app.use('/api/suppliers', suppliersRouter)
app.use('/api/product-categories', crudRouter('productCategory', {
  createSchema: createProductCategorySchema,
  updateSchema: createProductCategorySchema.partial(),
  entityLabel: 'ProductCategory',
  permissions: { read: 'products.read', create: 'products.create', update: 'products.update', del: 'products.delete' },
}))
app.use('/api/products', productsRouter)
app.use('/api/expense-categories', crudRouter('expenseCategory', {
  createSchema: createExpenseCategorySchema,
  updateSchema: createExpenseCategorySchema.partial(),
  entityLabel: 'ExpenseCategory',
  permissions: { read: 'expenses.read', create: 'expenses.create', update: 'expenses.update', del: 'expenses.delete' },
}))
app.use('/api/expenses', expensesRouter)
app.use('/api/payments', crudRouter('payment', {
  createSchema: createPaymentSchema,
  updateSchema: createPaymentSchema.partial(),
  entityLabel: 'Payment',
  permissions: { read: 'invoices.read', create: 'invoices.create', update: 'invoices.update', del: 'invoices.delete' },
  softDelete: false,
  // All referenced records must belong to the caller's organization.
  validateCreate: async (body, organizationId) => {
    for (const [key, model] of [
      ['invoiceId', 'invoice'],
      ['orderId', 'order'],
      ['customerId', 'customer'],
    ] as const) {
      const id = body[key]
      if (id) {
        const found = await (prisma as unknown as Record<string, { findFirst: (a: unknown) => Promise<unknown> }>)[
          model
        ].findFirst({ where: { id, organizationId } })
        if (!found) throw new AppError(404, 'NOT_FOUND', `Referenced ${key.replace('Id', '')} not found`)
      }
    }
  },
  // Payments are created in a single statement (no explicit transaction),
  // so it is safe to notify right after the row exists.
  afterCreate: async (created, organizationId) => {
    const payment = await prisma.payment.findUnique({
      where: { id: created.id },
      include: { invoice: { select: { invoiceNumber: true } } },
    })
    if (payment) {
      await notifyPaymentReceived(
        prisma,
        organizationId,
        Number(payment.amount),
        payment.invoice?.invoiceNumber ?? undefined,
      )
    }
  },
}))

app.use('/api/orders', ordersRouter)
app.use('/api/invoices', invoicesRouter)
app.use('/api/inventory', inventoryRouter)
app.use('/api/notifications', notificationsRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/audit-logs', auditLogsRouter)
app.use('/api/files', filesRouter)
app.use('/api/reports', reportsRouter)
app.use('/api/assistant', authenticate, assistantRouter)

app.use(errorHandler)

export default app
