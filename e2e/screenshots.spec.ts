/**
 * Screenshot generator for docs/screenshots (NOT part of the CI test suite).
 * It self-skips unless GENERATE_SCREENSHOTS=1 is set.
 *
 * Run: GENERATE_SCREENSHOTS=1 [SHOTS=orders,invoices] npx playwright test e2e/screenshots.spec.ts
 * Uses the seeded demo org (owner.1@example.com / password123) — all fictional data.
 * The backend webServer loads backend/.env, so seed the DEV database first:
 *   cd backend && npx prisma migrate reset --force --skip-seed && SEED_DEMO_DATA=true npm run prisma:seed
 */
import { test } from '@playwright/test'
import { mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

// Portable: <repo>/docs/screenshots (no absolute paths, no work at import time
// — CI runners must be able to load this file without side effects).
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots')

const all: Array<[string, string]> = [
  ['login', '/login'],
  ['dashboard', '/'],
  ['customers', '/customers'],
  ['products', '/products'],
  ['inventory', '/inventory'],
  ['orders', '/orders'],
  ['invoices', '/invoices'],
  ['expenses', '/expenses'],
  ['employees', '/employees'],
  ['reports', '/reports'],
  ['notifications', '/notifications'],
  ['assistant', '/assistant'],
]

const only = (process.env.SHOTS ?? '').split(',').filter(Boolean)
const todo = only.length ? all.filter(([n]) => only.includes(n)) : all
const needsLogin = !todo.some(([n]) => n === 'login')
const plan: Array<[string, string]> = needsLogin ? [['__login', '/login'], ...todo] : todo

test('capture docs screenshots', async ({ page }) => {
  test.skip(process.env.GENERATE_SCREENSHOTS !== '1', 'screenshot generation only')
  mkdirSync(DIR, { recursive: true })
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1000)
  if (!only.length || only.includes('login')) {
    await page.screenshot({ path: `${DIR}/login.png` })
  }

  await page.fill('input[type="email"], input[name="email"]', 'owner.1@example.com')
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  // wait until we actually leave the login page (token stored + redirect)
  await page.waitForFunction(() => !window.location.pathname.includes('/login'), null, { timeout: 20000 })
  await page.waitForTimeout(2000)

  for (const [name, url] of plan) {
    if (name === '__login') continue
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      // let TanStack Query finish: wait until the generic "Loading..." disappears
      await page.waitForFunction(
        () => !document.body.innerText.includes('Loading...'),
        null, { timeout: 15000 },
      ).catch(() => {})
      await page.waitForTimeout(1200)
      await page.screenshot({ path: `${DIR}/${name}.png` })
      console.log(`ok: ${name}`)
    } catch (e) {
      console.log(`shot failed for ${name}: ${(e as Error).message?.slice(0, 100)}`)
    }
  }
})
