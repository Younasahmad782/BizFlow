-- Invoice numbers are sequential per organization, so uniqueness must be per-org
DROP INDEX "Invoice_invoiceNumber_key";
CREATE UNIQUE INDEX "Invoice_organizationId_invoiceNumber_key" ON "Invoice"("organizationId", "invoiceNumber");
