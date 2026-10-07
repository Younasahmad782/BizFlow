import type { Prisma } from '@prisma/client'

/** Generates the next invoice number: {prefix}-{year}-{seq padded}. */
export async function nextInvoiceNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> {
  const settings = await tx.businessSetting.findUnique({ where: { organizationId } })
  const prefix = settings?.invoicePrefix ?? 'INV'
  const year = new Date().getFullYear()

  const last = await tx.invoice.findFirst({
    where: { organizationId, invoiceNumber: { startsWith: `${prefix}-${year}-` } },
    orderBy: { invoiceNumber: 'desc' },
    select: { invoiceNumber: true },
  })

  let seq = 1
  if (last) {
    const n = parseInt(last.invoiceNumber.split('-').pop() ?? '0', 10)
    if (!Number.isNaN(n)) seq = n + 1
  }
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`
}

/** Generates the next order number: {prefix}-{year}-{seq padded}, sequential per org. */
export async function nextOrderNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> {
  const settings = await tx.businessSetting.findUnique({ where: { organizationId } })
  const prefix = settings?.orderPrefix ?? 'ORD'
  const year = new Date().getFullYear()

  const last = await tx.order.findFirst({
    where: { organizationId, orderNumber: { startsWith: `${prefix}-${year}-` } },
    orderBy: { orderNumber: 'desc' },
    select: { orderNumber: true },
  })

  let seq = 1
  if (last) {
    const n = parseInt(last.orderNumber.split('-').pop() ?? '0', 10)
    if (!Number.isNaN(n)) seq = n + 1
  }
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`
}
