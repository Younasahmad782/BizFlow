// Runs before each test FILE: point Prisma at the test database.
// The schema reset happens once in tests/global-setup.ts.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
}
