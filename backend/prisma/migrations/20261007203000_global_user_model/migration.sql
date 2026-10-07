-- Global User model: identity moves from OrganizationMember to User.
-- A User is a person; OrganizationMember links a user to one organization,
-- so one person can belong to many organizations.

CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- Backfill one user per distinct member email (email was globally unique)
INSERT INTO "User" ("email", "name", "passwordHash", "tokenVersion", "createdAt", "updatedAt")
SELECT DISTINCT ON ("email") "email", "name", "passwordHash", "tokenVersion", "createdAt", "updatedAt"
FROM "OrganizationMember" ORDER BY "email", "createdAt";

-- Link members to their user
ALTER TABLE "OrganizationMember" ADD COLUMN "userId" UUID;
UPDATE "OrganizationMember" m SET "userId" = u."id" FROM "User" u WHERE u."email" = m."email";
ALTER TABLE "OrganizationMember" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "OrganizationMember_userId_organizationId_key"
    ON "OrganizationMember"("userId", "organizationId");

-- Move reset tokens to users
ALTER TABLE "PasswordResetToken" ADD COLUMN "userId" UUID;
UPDATE "PasswordResetToken" t SET "userId" = (
  SELECT u."id" FROM "User" u
  JOIN "OrganizationMember" m ON m."email" = u."email"
  WHERE m."id" = t."memberId"
);
ALTER TABLE "PasswordResetToken" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
ALTER TABLE "PasswordResetToken" DROP CONSTRAINT "PasswordResetToken_memberId_fkey";
ALTER TABLE "PasswordResetToken" DROP COLUMN "memberId";

-- Drop moved columns from OrganizationMember
ALTER TABLE "OrganizationMember" DROP COLUMN "email";
ALTER TABLE "OrganizationMember" DROP COLUMN "name";
ALTER TABLE "OrganizationMember" DROP COLUMN "passwordHash";
ALTER TABLE "OrganizationMember" DROP COLUMN "tokenVersion";
