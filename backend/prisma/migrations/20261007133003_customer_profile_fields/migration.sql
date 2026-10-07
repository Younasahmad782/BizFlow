-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('RETAIL', 'WHOLESALE', 'CORPORATE');

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "area" TEXT,
ADD COLUMN     "customerType" "CustomerType",
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "openingBalance" DECIMAL(12,2);

-- CreateIndex
CREATE INDEX "Customer_organizationId_customerType_idx" ON "Customer"("organizationId", "customerType");
