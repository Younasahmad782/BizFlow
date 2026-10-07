-- Add employeeId (EMP-1042 style), backfill existing rows, then enforce uniqueness
ALTER TABLE "Employee" ADD COLUMN "employeeId" TEXT;

WITH ranked AS (
  SELECT id, "organizationId", ROW_NUMBER() OVER (PARTITION BY "organizationId" ORDER BY "createdAt") AS rn
  FROM "Employee"
)
UPDATE "Employee" e SET "employeeId" = 'EMP-' || (1000 + r.rn)
FROM ranked r WHERE e.id = r.id;

ALTER TABLE "Employee" ALTER COLUMN "employeeId" SET NOT NULL;
CREATE UNIQUE INDEX "Employee_organizationId_employeeId_key" ON "Employee"("organizationId", "employeeId");

-- Optional role assignment for employees
ALTER TABLE "Employee" ADD COLUMN "roleId" UUID;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Employee_roleId_idx" ON "Employee"("roleId");
