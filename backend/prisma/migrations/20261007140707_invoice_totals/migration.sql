-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0;
