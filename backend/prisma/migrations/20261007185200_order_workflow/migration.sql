-- Order workflow: statuses, payment statuses/methods, numbering, totals

-- 1. OrderStatus: PENDING->DRAFT, SHIPPED->PROCESSING, DELIVERED->COMPLETED
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'RETURNED');
ALTER TABLE "Order" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "status" TYPE "OrderStatus" USING (
  CASE "status"::text
    WHEN 'PENDING' THEN 'DRAFT'::"OrderStatus"
    WHEN 'SHIPPED' THEN 'PROCESSING'::"OrderStatus"
    WHEN 'DELIVERED' THEN 'COMPLETED'::"OrderStatus"
    ELSE "status"::text::"OrderStatus"
  END
);
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
DROP TYPE "OrderStatus_old";

-- 2. PaymentStatus (new enum)
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'REFUNDED');

-- 3. PaymentMethod: BANK->BANK_TRANSFER, ONLINE->OTHER, + JAZZCASH, EASYPAISA
ALTER TYPE "PaymentMethod" RENAME TO "PaymentMethod_old";
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA', 'CARD', 'OTHER');
ALTER TABLE "Payment" ALTER COLUMN "method" DROP DEFAULT;
ALTER TABLE "Payment" ALTER COLUMN "method" TYPE "PaymentMethod" USING (
  CASE "method"::text
    WHEN 'BANK' THEN 'BANK_TRANSFER'::"PaymentMethod"
    WHEN 'ONLINE' THEN 'OTHER'::"PaymentMethod"
    ELSE "method"::text::"PaymentMethod"
  END
);
ALTER TABLE "Payment" ALTER COLUMN "method" SET DEFAULT 'CASH';
ALTER TABLE "SupplierPayment" ALTER COLUMN "method" DROP DEFAULT;
ALTER TABLE "SupplierPayment" ALTER COLUMN "method" TYPE "PaymentMethod" USING (
  CASE "method"::text
    WHEN 'BANK' THEN 'BANK_TRANSFER'::"PaymentMethod"
    WHEN 'ONLINE' THEN 'OTHER'::"PaymentMethod"
    ELSE "method"::text::"PaymentMethod"
  END
);
ALTER TABLE "SupplierPayment" ALTER COLUMN "method" SET DEFAULT 'CASH';
DROP TYPE "PaymentMethod_old";

-- 4. Order columns
ALTER TABLE "Order" ADD COLUMN "orderNumber" TEXT;
ALTER TABLE "Order" ADD COLUMN "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID';
ALTER TABLE "Order" ADD COLUMN "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Backfill orderNumber: ORD-2026-0001, 0002… per organization (by creation time)
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt", id) AS rn
  FROM "Order"
)
UPDATE "Order" o SET "orderNumber" = 'ORD-2026-' || LPAD(n.rn::text, 4, '0')
FROM numbered n WHERE o.id = n.id;

-- Backfill totals from items
UPDATE "Order" o SET "subtotal" = COALESCE((
  SELECT SUM(oi."quantity" * oi."unitPrice") FROM "OrderItem" oi WHERE oi."orderId" = o.id
), 0);

-- Backfill paidAmount from payments
UPDATE "Order" o SET "paidAmount" = COALESCE((
  SELECT SUM(p."amount") FROM "Payment" p WHERE p."orderId" = o.id
), 0);

-- Backfill paymentStatus from paid vs total
UPDATE "Order" o SET "paymentStatus" = CASE
  WHEN o."paidAmount" >= o."totalAmount" AND o."totalAmount" > 0 THEN 'PAID'::"PaymentStatus"
  WHEN o."paidAmount" > 0 THEN 'PARTIALLY_PAID'::"PaymentStatus"
  ELSE 'UNPAID'::"PaymentStatus"
END;

ALTER TABLE "Order" ALTER COLUMN "orderNumber" SET NOT NULL;
CREATE UNIQUE INDEX "Order_organizationId_orderNumber_key" ON "Order"("organizationId", "orderNumber");

-- 5. BusinessSetting: orderPrefix + allowNegativeStock
ALTER TABLE "BusinessSetting" ADD COLUMN "orderPrefix" TEXT NOT NULL DEFAULT 'ORD';
ALTER TABLE "BusinessSetting" ADD COLUMN "allowNegativeStock" BOOLEAN NOT NULL DEFAULT false;
