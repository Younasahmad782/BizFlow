-- Business profile + localization fields
ALTER TABLE "Organization" ADD COLUMN "website" TEXT;
ALTER TABLE "Organization" ADD COLUMN "country" TEXT NOT NULL DEFAULT 'Pakistan';
ALTER TABLE "BusinessSetting" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'en';
