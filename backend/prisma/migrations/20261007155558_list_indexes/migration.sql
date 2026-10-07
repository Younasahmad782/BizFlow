-- DropIndex (removed: Employee_roleId_idx is created by a later migration;
-- dropping it here breaks fresh deploys)

-- CreateIndex
CREATE INDEX "Customer_organizationId_createdAt_idx" ON "Customer"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Employee_organizationId_createdAt_idx" ON "Employee"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "File_organizationId_createdAt_idx" ON "File"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_organizationId_createdAt_idx" ON "Invoice"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_organizationId_createdAt_idx" ON "Notification"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_organizationId_createdAt_idx" ON "Order"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_organizationId_createdAt_idx" ON "Payment"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Product_organizationId_createdAt_idx" ON "Product"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Purchase_organizationId_createdAt_idx" ON "Purchase"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Supplier_organizationId_createdAt_idx" ON "Supplier"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "SupplierPayment_organizationId_createdAt_idx" ON "SupplierPayment"("organizationId", "createdAt");
