import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { getIo, orgRoom } from '../lib/sockets'

export type NotifyType =
  | 'LOW_STOCK'
  | 'INVOICE_OVERDUE'
  | 'PAYMENT_RECEIVED'
  | 'ORDER_CREATED'
  | 'ORDER_CONFIRMED'
  | 'EMPLOYEE_ADDED'
  | 'SYSTEM'

export interface NotifyInput {
  organizationId: string
  type: NotifyType
  title: string
  message: string
  /** Optional: notify a single member instead of the whole organization. */
  memberId?: string
  /** Dedupe key: skip creating if an unread notification with this key exists. */
  dedupeKey?: string
}

/**
 * Creates a notification in the database and pushes it in real time to every
 * connected client of that organization (their own org room only).
 */
export async function notify(
  tx: Prisma.TransactionClient | typeof prisma,
  input: NotifyInput,
) {
  let notification
  if (input.dedupeKey) {
    const existing = await tx.notification.findFirst({
      where: {
        organizationId: input.organizationId,
        isRead: false,
        title: input.title,
        message: input.message,
      },
    })
    if (existing) return existing
  }

  notification = await tx.notification.create({
    data: {
      organizationId: input.organizationId,
      memberId: input.memberId,
      type: input.type as NotifyType,
      title: input.title,
      message: input.message,
    },
  })

  const io = getIo()
  if (io) {
    const payload = {
      id: notification.id,
      organizationId: notification.organizationId,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      isRead: notification.isRead,
      createdAt: notification.createdAt.toISOString(),
    }
    if (input.memberId) {
      // targeted: emit to the org room; clients filter by memberId if set
      io.to(orgRoom(input.organizationId)).emit('notification', { ...payload, memberId: input.memberId })
    } else {
      io.to(orgRoom(input.organizationId)).emit('notification', payload)
    }
  }

  return notification
}

const pkr = (n: number): string => `Rs. ${Math.round(n).toLocaleString('en-PK')}`

export const notifyOrderCreated = (
  tx: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  orderNumber: string,
) =>
  notify(tx, {
    organizationId,
    type: 'ORDER_CREATED',
    title: 'New order created',
    message: `New order ${orderNumber} was created.`,
    dedupeKey: orderNumber,
  })

export const notifyOrderConfirmed = (
  tx: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  orderNumber: string,
) =>
  notify(tx, {
    organizationId,
    type: 'ORDER_CONFIRMED',
    title: 'Order confirmed',
    message: `Order ${orderNumber} was confirmed and stock was deducted.`,
    dedupeKey: orderNumber,
  })

export const notifyPaymentReceived = (
  tx: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  amount: number,
  invoiceNumber?: string,
) =>
  notify(tx, {
    organizationId,
    type: 'PAYMENT_RECEIVED',
    title: 'Payment recorded',
    message: `Payment of ${pkr(amount)} was recorded${invoiceNumber ? ` against ${invoiceNumber}` : ''}.`,
  })

export const notifyLowStock = (
  tx: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  productName: string,
) =>
  notify(tx, {
    organizationId,
    type: 'LOW_STOCK',
    title: 'Low stock alert',
    message: `${productName} stock has fallen below minimum level.`,
    dedupeKey: productName,
  })

export const notifyInvoiceOverdue = (
  tx: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  invoiceNumber: string,
) =>
  notify(tx, {
    organizationId,
    type: 'INVOICE_OVERDUE',
    title: 'Invoice overdue',
    message: `Invoice ${invoiceNumber} is overdue.`,
    dedupeKey: invoiceNumber,
  })

export const notifyEmployeeAdded = (
  tx: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
  name: string,
) =>
  notify(tx, {
    organizationId,
    type: 'EMPLOYEE_ADDED',
    title: 'Team update',
    message: `${name} was added as a new employee.`,
  })

/**
 * Finds overdue invoices (past due, unpaid, not cancelled) and creates
 * INVOICE_OVERDUE notifications for any that don't already have an unread one.
 * Called opportunistically (e.g. when the notification list is read) so no
 * scheduler is required for correctness.
 */
export async function checkOverdueInvoices(
  tx: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
) {
  const overdue = await tx.invoice.findMany({
    where: {
      organizationId,
      status: { notIn: ['CANCELLED', 'PAID'] },
      dueDate: { lt: new Date() },
    },
    include: { payments: { select: { amount: true } } },
    take: 50,
  })
  for (const inv of overdue) {
    const paid = inv.payments.reduce(
      (s, p) => s + Number((p.amount as { toString(): string }).toString()),
      0,
    )
    if (paid < Number((inv.totalAmount as { toString(): string }).toString()) - 0.01) {
      await notifyInvoiceOverdue(tx, organizationId, inv.invoiceNumber)
    }
  }
}
