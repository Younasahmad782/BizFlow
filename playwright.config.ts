import { defineConfig, devices } from '@playwright/test'

// Browser tests for ./e2e.
//
// Servers are started manually (Playwright's webServer is unreliable in some
// sandboxes, so this config intentionally has none):
//
//   Terminal 1: cd backend  && npx tsx src/index.ts        # → :4000
//   Terminal 2: cd frontend && npm run dev -- --port 5173  # → :5173
//   Terminal 3: npx playwright test
//
// The backend loads backend/.env via dotenv; override with DATABASE_URL etc.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
