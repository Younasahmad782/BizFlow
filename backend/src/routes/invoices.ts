import { Router } from 'express'
import { prisma } from '../lib/prisma'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/authorize'
import { pagination } from '../schemas/common'
import { createInvoiceSchema, updateInvoiceSchema } from '../schemas/entities'
import { logAudit } from '../services/audit'
import { nextInvoiceNumber } from '../services/numbering'
import { AppError } from '../utils/errors'

const router = Router()
router.use(authenticate)

router.get('/', requirePermission('invoices.read'), async (req, res, next) => {
  try {
    const { take, skip } = pagination.parse(req.query)
    const organizationId = req.member!.organizationId
    const where: Record<string, unknown> = { organizationId }
    if (req.query.status) where.status = String(req.query.status)
    if (req.query.search) {
      where.invoiceNumber = { contains: String(req.query.search).trim(), mode: 'insensitive' }
    }
    const [total, invoices] = await Promise.all([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where,
        take,
        skip,
        orderBy: { createdAt: 'desc' },
        include: { customer: { select: { id: true, name: true } } },
      }),
    ])
    res.json({ data: invoices, total, take, skip })
  } catch (e) {
    next(e)
  }
})

import { getInvoiceDetail, generateInvoicePdf } from '../services/invoices'

// GET /api/invoices/:id/pdf — download the real PDF (must come before /:id)
router.get('/:id/pdf', requirePermission('invoices.read'), async (req, res, next) => {
  try {
    const data = await getInvoiceDetail(prisma, req.member!.organizationId, String(req.params.id))
    const pdf = await generateInvoicePdf(data)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${data.invoice.invoiceNumber}.pdf"`,
    )
    res.send(pdf)
  } catch (e) {
    if ((e as Error).message === 'Invoice not found') {
      next(new AppError(404, 'NOT_FOUND', 'Invoice not found'))
    } else {
      next(e)
    }
  }
})

// GET /api/invoices/:id/share — share-ready payload. No email is sent;
// the frontend offers copyable text + the PDF download link.
router.get('/:id/share', requirePermission('invoices.read'), async (req, res, next) => {
  try {
    const data = await getInvoiceDetail(prisma, req.member!.organizationId, String(req.params.id))
    const { invoice, customer, business } = data
    const amount = `Rs. ${Number(invoice.totalAmount).toLocaleString('en-PK')}`
    const message =
      `Assalam-o-Alaikum ${customer.name},\n\n` +
      `Your invoice ${invoice.invoiceNumber} from ${business.name} is ready.\n` +
      `Total: ${amount}\n` +
      (data.balanceDue > 0
        ? `Balance due: Rs. ${data.balanceDue.toLocaleString('en-PK')}\n`
        : `Paid in full. Thank you!\n`) +
      `\n— ${business.name}${business.phone ? ` (${business.phone})` : ''}`
    res.json({
      invoiceNumber: invoice.invoiceNumber,
      customerName: customer.name,
      customerPhone: customer.phone,
      customerEmail: customer.email,
      message,
      pdfUrl: `/api/invoices/${invoice.id}/pdf`,
      emailSubject: `Invoice ${invoice.invoiceNumber} from ${business.name}`,
      note: 'Email integration is not configured — copy the message or download the PDF to share manually.',
    })
  } catch (e) {
    if ((e as Error).message === 'Invoice not found') {
      next(new AppError(404, 'NOT_FOUND', 'Invoice not found'))
    } else {
      next(e)
    }
  }
})

router.get('/:id', requirePermission('invoices.read'), async (req, res, next) => {
  try {
    const data = await getInvoiceDetail(prisma, req.member!.organizationId, String(req.params.id))
    // keep Decimal-like strings JSON-safe
    res.json({
      ...data,
      invoice: {
        ...data.invoice,
        issueDate: data.invoice.issueDate.toISOString(),
        dueDate: data.invoice.dueDate?.toISOString() ?? null,
      },
    })
  } catch (e) {
    if ((e as Error).message === 'Invoice not found') {
      next(new AppError(404, 'NOT_FOUND', 'Invoice not found'))
    } else {
      next(e)
    }
  }
})

// POST /invoices — auto-generates invoiceNumber, computes totals
router.post('/', requirePermission('invoices.create'), async (req, res, next) => {
  try {
    const input = createInvoiceSchema.parse(req.body)
    const organizationId = req.member!.organizationId
    const memberId = req.member!.memberId

    const customer = await prisma.customer.findFirst({
      where: { id: input.customerId, organizationId, deletedAt: null },
    })
    if (!customer) throw new AppError(400, 'BAD_REQUEST', 'Invalid customer')

    let orderTotal: number | null = null
    if (input.orderId) {
      const order = await prisma.order.findFirst({
        where: { id: input.orderId, organizationId },
        include: { invoice: true },
      })
      if (!order) throw new AppError(400, 'BAD_REQUEST', 'Invalid order')
      if (order.invoice) throw new AppError(409, 'CONFLICT', 'This order is already invoiced')
      orderTotal = Number(order.totalAmount)
    }

    const itemsTotal = input.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
    const discountAmount = input.discountAmount ?? 0
    const taxAmount = input.taxAmount ?? 0
    const totalAmount = (orderTotal ?? itemsTotal) - discountAmount + taxAmount

    const invoice = await prisma.$transaction(async (tx) => {
      const invoiceNumber = await nextInvoiceNumber(tx, organizationId)
      const productIds = [...new Set(input.items.map((i) => i.productId))]
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, organizationId, deletedAt: null },
        select: { id: true, name: true },
      })
      if (products.length !== productIds.length) {
        throw new AppError(400, 'BAD_REQUEST', 'One or more products are invalid')
      }
      const nameOf = new Map(products.map((p) => [p.id, p.name]))
      return tx.invoice.create({
        data: {
          organizationId,
          orderId: input.orderId,
          customerId: input.customerId,
          invoiceNumber,
          dueDate: input.dueDate,
          subtotal: orderTotal ?? itemsTotal,
          discountAmount,
          taxAmount,
          totalAmount,
          notes: input.notes,
          items: {
            create: input.items.map((i) => ({
              productId: i.productId,
              description: nameOf.get(i.productId) ?? 'Item',
              quantity: i.quantity,
              unitPrice: i.unitPrice,
            })),
          },
        },
        include: { items: true },
      })
    })

    await logAudit({
      organizationId,
      memberId,
      action: 'CREATE',
      entity: 'Invoice',
      entityId: invoice.id,
      details: { invoiceNumber: invoice.invoiceNumber, totalAmount: String(invoice.totalAmount) },
    })
    res.status(201).json(invoice)
  } catch (e) {
    next(e)
  }
})

router.patch('/:id', requirePermission('invoices.update'), async (req, res, next) => {
  try {
    const input = updateInvoiceSchema.parse(req.body)
    const organizationId = req.member!.organizationId
    const invoice = await prisma.invoice.findFirst({
      where: { id: String(req.params.id), organizationId },
    })
    if (!invoice) throw new AppError(404, 'NOT_FOUND', 'Invoice not found')

    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: input,
    })
    await logAudit({
      organizationId,
      memberId: req.member!.memberId,
      action: 'UPDATE',
      entity: 'Invoice',
      entityId: invoice.id,
      details: input,
    })
    res.json(updated)
  } catch (e) {
    next(e)
  }
})

export default router
