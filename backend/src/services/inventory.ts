import type { InventoryTransactionType, Prisma } from '@prisma/client'
import { AppError } from '../utils/errors'

interface MovementInput {
  organizationId: string
  productId: string
  type: InventoryTransactionType
  quantity: number // IN/OUT/RETURN/DAMAGED: positive magnitude; ADJUSTMENT: signed
  reason: string
  reference?: string
  memberId?: string
  allowNegative?: boolean // when true, stock may go below zero (per org settings)
}

export interface MovementResult {
  productName: string
  newQty: number
  reorderLevel: number
}

/**
 * The ONLY sanctioned way to change stock. Finds (or creates) the product's
 * Inventory row and applies the movement inside the caller's transaction.
 *
 * It does NOT create notifications or emit sockets itself: those must happen
 * AFTER the caller's transaction commits. The caller inspects the returned
 * MovementResult and calls the notify() helpers (which dedupe + push).
 */
export async function recordMovement(
  tx: Prisma.TransactionClient,
  input: MovementInput,
): Promise<MovementResult> {
  let inventory = await tx.inventory.findUnique({
    where: { productId: input.productId },
    include: { product: { select: { organizationId: true, name: true } } },
  })
  if (!inventory) {
    if (input.type === 'OUT' || input.type === 'DAMAGED') {
      throw new Error('No inventory record for product')
    }
    inventory = await tx.inventory.create({
      data: {
        organizationId: input.organizationId,
        productId: input.productId,
        quantity: 0,
      },
      include: { product: { select: { organizationId: true, name: true } } },
    })
  }
  if (inventory.product.organizationId !== input.organizationId) {
    throw new Error('Product does not belong to this organization')
  }

  const delta =
    input.type === 'OUT' || input.type === 'DAMAGED'
      ? -Math.abs(input.quantity)
      : input.type === 'IN' || input.type === 'RETURN'
        ? Math.abs(input.quantity)
        : input.quantity // ADJUSTMENT: signed as passed

  const newQty = inventory.quantity + delta
  if (newQty < 0 && !input.allowNegative) {
    throw new AppError(
      400,
      'INSUFFICIENT_STOCK',
      `Insufficient stock for ${inventory.product.name} (have ${inventory.quantity})`,
    )
  }

  await tx.inventoryTransaction.create({
    data: {
      organizationId: input.organizationId,
      inventoryId: inventory.id,
      type: input.type,
      quantity: input.quantity,
      reason: input.reason,
      reference: input.reference,
      createdById: input.memberId,
    },
  })
  await tx.inventory.update({
    where: { id: inventory.id },
    data: { quantity: newQty },
  })

  return {
    productName: inventory.product.name,
    newQty,
    reorderLevel: inventory.reorderLevel,
  }
}
