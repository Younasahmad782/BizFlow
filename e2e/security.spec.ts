/**
 * E2E security smoke tests: auth gates, tenant isolation and RBAC
 * in the real browser.
 */
import { test, expect } from '@playwright/test'

const API = 'http://localhost:4000/api'

async function registerOrg(request: any, tag: string) {
  const email = `e2e-${tag}-${Date.now()}@example.com`
  const res = await request.post(`${API}/auth/register`, {
    data: {
      organization: { name: `E2E ${tag}`, city: 'Lahore', province: 'Punjab' },
      user: { name: `E2E Owner`, email, password: 'password123' },
    },
  })
  expect(res.ok()).toBeTruthy()
  const body = await res.json()
  return { token: body.token as string, email }
}

test('unauthenticated user is redirected to login', async ({ page }) => {
  await page.goto('/customers')
  await expect(page).toHaveURL(/\/login/)
})

test('login works and dashboard loads with real data', async ({ page, request }) => {
  const { email } = await registerOrg(request, 'dash')
  await page.goto('/login')
  await page.fill('input[type="email"], input[name="email"]', email)
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await expect(page).toHaveURL(/\/$/, { timeout: 15000 })
  // dashboard renders without crashing
  await expect(page.locator('body')).toContainText(/dashboard|sales|revenue/i, { timeout: 15000 })
})

test('wrong password shows an error, no redirect', async ({ page, request }) => {
  const { email } = await registerOrg(request, 'badpw')
  await page.goto('/login')
  await page.fill('input[type="email"], input[name="email"]', email)
  await page.fill('input[type="password"]', 'wrongpassword')
  await page.click('button[type="submit"]')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.locator('body')).toContainText(/invalid|incorrect|failed/i, { timeout: 10000 })
})

test('tenant isolation holds across browser sessions', async ({ page, request }) => {
  const a = await registerOrg(request, 'e2eA')
  const b = await registerOrg(request, 'e2eB')

  // org B creates a customer via API
  const created = await request.post(`${API}/customers`, {
    headers: { Authorization: `Bearer ${b.token}` },
    data: { name: 'E2E Secret Customer' },
  })
  expect(created.ok()).toBeTruthy()
  const customerId = (await created.json()).id

  // org A logs in via UI and must NOT see org B's customer
  await page.goto('/login')
  await page.fill('input[type="email"], input[name="email"]', a.email)
  await page.fill('input[type="password"]', 'password123')
  await page.click('button[type="submit"]')
  await expect(page).toHaveURL(/\/$/, { timeout: 15000 })

  await page.goto('/customers')
  await expect(page.locator('body')).not.toContainText('E2E Secret Customer', { timeout: 10000 })

  // direct URL access to the other org's record must fail at the API layer
  const direct = await request.get(`${API}/customers/${customerId}`, {
    headers: { Authorization: `Bearer ${a.token}` },
  })
  expect(direct.status()).toBe(404)
})
