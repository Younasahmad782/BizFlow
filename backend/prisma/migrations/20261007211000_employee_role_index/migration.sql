-- Declare the roleId index on Employee (created by an earlier migration but
-- never declared in the schema). IF NOT EXISTS keeps it idempotent.
CREATE INDEX IF NOT EXISTS "Employee_roleId_idx" ON "Employee"("roleId");
