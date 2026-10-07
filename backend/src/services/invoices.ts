import PDFDocument from 'pdfkit'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'

export type DerivedInvoiceStatus =
  | 'DRAFT'
  | 'SENT'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'OVERDUE'
  | 'CANCELLED'

export interface InvoiceDetailData {
  invoice: {
    id: string
    invoiceNumber: string
    issueDate: Date
    dueDate: Date | null
    subtotal: string
    discountAmount: string
    taxAmount: string | null
    totalAmount: string
    notes: string | null
    items: { description: string; quantity: number; unitPrice: string }[]
  }
  customer: {
    name: string
    phone: string | null
    email: string | null
    address: string | null
    city: string | null
  }
  business: {
    name: string
    address: string | null
    phone: string | null
    email: string | null
  }
  paidAmount: number
  balanceDue: number
  derivedStatus: DerivedInvoiceStatus
}

/** Status is always derived from actual payments — never trusted from storage alone. */
export function deriveInvoiceStatus(
  stored: string,
  total: number,
  paid: number,
  dueDate: Date | null,
): DerivedInvoiceStatus {
  if (stored === 'CANCELLED') return 'CANCELLED'
  if (paid >= total - 0.01 && total > 0) return 'PAID'
  if (paid > 0.01) return 'PARTIALLY_PAID'
  if (dueDate && new Date(dueDate) < new Date()) return 'OVERDUE'
  return stored === 'DRAFT' ? 'DRAFT' : 'SENT'
}

const num = (d: unknown): number => Number((d as { toString(): string }).toString())
const str = (d: unknown): string => (d as { toString(): string }).toString()

export async function getInvoiceDetail(
  tx: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  invoiceId: string,
): Promise<InvoiceDetailData> {
  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId, organizationId },
    include: {
      items: { orderBy: { id: 'asc' } },
      customer: true,
      organization: { include: { settings: true } },
      payments: true,
    },
  })
  if (!invoice) throw new Error('Invoice not found')

  const total = num(invoice.totalAmount)
  const paid = invoice.payments.reduce((s, p) => s + num(p.amount), 0)

  return {
    invoice: {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      subtotal: str(invoice.subtotal),
      discountAmount: str(invoice.discountAmount),
      taxAmount: invoice.taxAmount != null ? str(invoice.taxAmount) : null,
      totalAmount: str(invoice.totalAmount),
      notes: invoice.notes,
      items: invoice.items.map((i) => ({
        description: i.description,
        quantity: i.quantity,
        unitPrice: str(i.unitPrice),
      })),
    },
    customer: {
      name: invoice.customer.name,
      phone: invoice.customer.phone,
      email: invoice.customer.email,
      address: invoice.customer.address,
      city: invoice.customer.city,
    },
    business: {
      name: invoice.organization.name,
      address: invoice.organization.address,
      phone: invoice.organization.phone,
      email: invoice.organization.email,
    },
    paidAmount: paid,
    balanceDue: Math.max(0, total - paid),
    derivedStatus: deriveInvoiceStatus(invoice.status, total, paid, invoice.dueDate),
  }
}

const fmtPKR = (n: number | string): string =>
  'Rs. ' + Number(n).toLocaleString('en-PK', { maximumFractionDigits: 2 })

const fmtDate = (d: Date | null): string =>
  d ? new Date(d).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const STATUS_COLOR: Record<DerivedInvoiceStatus, string> = {
  DRAFT: '#64748b',
  SENT: '#2563eb',
  PARTIALLY_PAID: '#d97706',
  PAID: '#15803d',
  OVERDUE: '#dc2626',
  CANCELLED: '#64748b',
}

/** Generates a professional, printable A4 invoice PDF from real database data. */
export function generateInvoicePdf(data: InvoiceDetailData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const { invoice, customer, business } = data
    const W = 499 // usable width (595 - 96)

    // ── Header: business ──────────────────────────────────────────
    doc.fontSize(22).fillColor('#0f172a').font('Helvetica-Bold').text(business.name, 48, 48)
    doc.fontSize(9).fillColor('#475569').font('Helvetica')
    if (business.address) doc.text(business.address)
    const contact = [business.phone, business.email].filter(Boolean).join('  ·  ')
    if (contact) doc.text(contact)
    doc.moveDown(0.4)
    doc.fontSize(20).fillColor('#0f172a').font('Helvetica-Bold').text('INVOICE', { align: 'right' })
    doc.fontSize(10).fillColor('#475569').font('Helvetica').text(invoice.invoiceNumber, { align: 'right' })

    // status pill
    const pill = data.derivedStatus.replace('_', ' ')
    doc.fillColor(STATUS_COLOR[data.derivedStatus]).font('Helvetica-Bold').fontSize(10)
    doc.text(pill, { align: 'right' })
    doc.fillColor('#0f172a')

    doc.moveDown(0.6)
    doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(48, doc.y).lineTo(48 + W, doc.y).stroke()
    doc.moveDown(0.6)

    // ── Bill-to + meta ────────────────────────────────────────────
    const metaY = doc.y
    doc.fontSize(9).fillColor('#64748b').font('Helvetica-Bold').text('BILL TO', 48, metaY)
    doc.fontSize(11).fillColor('#0f172a').font('Helvetica-Bold').text(customer.name, 48, doc.y + 2)
    doc.fontSize(9).font('Helvetica').fillColor('#475569')
    if (customer.address) doc.text(customer.address, 48)
    if (customer.city) doc.text(customer.city, 48)
    if (customer.phone) doc.text(customer.phone, 48)
    if (customer.email) doc.text(customer.email, 48)

    doc.fontSize(9).fillColor('#64748b').font('Helvetica-Bold').text('Invoice date', 380, metaY)
    doc.fontSize(10).fillColor('#0f172a').font('Helvetica').text(fmtDate(invoice.issueDate), 380, doc.y + 2)
    doc.fontSize(9).fillColor('#64748b').font('Helvetica-Bold').text('Due date', 380, doc.y + 6)
    doc.fontSize(10).fillColor('#0f172a').font('Helvetica').text(fmtDate(invoice.dueDate), 380, doc.y + 2)

    doc.y = Math.max(doc.y, metaY + 90)
    doc.moveDown(0.4)

    // ── Items table ───────────────────────────────────────────────
    const cols = [48, 300, 370, 440] // desc | qty | unit | total
    doc.fontSize(9).fillColor('#64748b').font('Helvetica-Bold')
    doc.text('DESCRIPTION', cols[0], doc.y)
    doc.text('QTY', cols[1], doc.y, { width: 60, align: 'right' })
    doc.text('UNIT PRICE', cols[2], doc.y, { width: 70, align: 'right' })
    doc.text('AMOUNT', cols[3], doc.y, { width: 107, align: 'right' })
    doc.moveDown(0.3)
    doc.strokeColor('#e2e8f0').moveTo(48, doc.y).lineTo(48 + W, doc.y).stroke()
    doc.moveDown(0.4)

    doc.font('Helvetica').fillColor('#0f172a').fontSize(10)
    for (const item of invoice.items) {
      const y = doc.y
      const lineTotal = Number(item.unitPrice) * item.quantity
      doc.text(item.description, cols[0], y, { width: 240 })
      doc.text(String(item.quantity), cols[1], y, { width: 60, align: 'right' })
      doc.text(fmtPKR(item.unitPrice), cols[2], y, { width: 70, align: 'right' })
      doc.text(fmtPKR(lineTotal), cols[3], y, { width: 107, align: 'right' })
      doc.y = Math.max(doc.y, y + 16)
      doc.moveDown(0.25)
    }
    doc.strokeColor('#e2e8f0').moveTo(48, doc.y).lineTo(48 + W, doc.y).stroke()
    doc.moveDown(0.5)

    // ── Totals ────────────────────────────────────────────────────
    const totalsX = 340
    const valX = 440
    const row = (label: string, value: string, bold = false, color = '#0f172a') => {
      doc.fontSize(10).fillColor('#475569').font(bold ? 'Helvetica-Bold' : 'Helvetica')
      doc.text(label, totalsX, doc.y, { width: 95, align: 'right' })
      doc.fillColor(color).font(bold ? 'Helvetica-Bold' : 'Helvetica')
      doc.text(value, valX, doc.y - (bold ? 0 : 0), { width: 107, align: 'right' })
      doc.moveDown(0.35)
    }
    row('Subtotal', fmtPKR(invoice.subtotal))
    if (Number(invoice.discountAmount) > 0) row('Discount', '− ' + fmtPKR(invoice.discountAmount))
    row('Tax', fmtPKR(invoice.taxAmount ?? 0))
    doc.moveDown(0.15)
    row('Total', fmtPKR(invoice.totalAmount), true)
    row('Paid', fmtPKR(data.paidAmount), false, '#15803d')
    doc.moveDown(0.15)
    row('Balance due', fmtPKR(data.balanceDue), true, data.balanceDue > 0 ? '#dc2626' : '#15803d')

    doc.moveDown(1)
    if (invoice.notes) {
      doc.fontSize(9).fillColor('#64748b').font('Helvetica-Bold').text('NOTES')
      doc.fontSize(9).fillColor('#475569').font('Helvetica').text(invoice.notes)
      doc.moveDown(0.6)
    }

    // ── Footer ────────────────────────────────────────────────────
    doc.fontSize(8).fillColor('#94a3b8').font('Helvetica')
    doc.text('Thank you for your business.', 48, 780, { align: 'center', width: W })
    doc.text(`Generated by ${business.name} · Amounts in Pakistani Rupees (PKR)`, 48, 792, {
      align: 'center',
      width: W,
    })

    doc.end()
  })
}
