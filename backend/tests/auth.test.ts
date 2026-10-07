import { afterAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { PrismaClient } from '@prisma/client'
import app from '../src/app'

const describeIfDb = process.env.TEST_DATABASE_URL ? describe : describe.skip
const prisma = new PrismaClient()

afterAll(async () => {
  await prisma.$disconnect()
})

let n = 0
const org = (name: string) => {
  n += 1
  return {
    organization: { name, city: 'Lahore', province: 'Punjab', category: 'Retail' },
    user: { name: `Owner ${n}`, email: `owner-auth-${n}@example.com`, password: 'password123' },
  }
}

describeIfDb('auth', () => {
  it('registers an organization with an Owner member', async () => {
    const res = await request(app).post('/api/auth/register').send(org('AuthOrg1'))
    expect(res.status).toBe(201)
    expect(res.body.token).toBeDefined()
    expect(res.body.member.role.name).toBe('OWNER')
    expect(res.body.organization.name).toBe('AuthOrg1')
    expect(res.body.member.passwordHash).toBeUndefined()
    expect(res.body.permissions).toContain('*')
  })

  it('rejects duplicate emails', async () => {
    const payload = org('AuthOrg2')
    await request(app).post('/api/auth/register').send(payload)
    const res = await request(app).post('/api/auth/register').send(payload)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONFLICT')
  })

  it('logs in with correct credentials', async () => {
    const payload = org('AuthOrg3')
    await request(app).post('/api/auth/register').send(payload)
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: payload.user.email, password: 'password123' })
    expect(res.status).toBe(200)
    expect(res.body.token).toBeDefined()
    expect(res.body.organization.name).toBe('AuthOrg3')
  })

  it('rejects wrong passwords', async () => {
    const payload = org('AuthOrg4')
    await request(app).post('/api/auth/register').send(payload)
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: payload.user.email, password: 'wrongpassword' })
    expect(res.status).toBe(401)
  })

  it('returns /me for a valid token', async () => {
    const payload = org('AuthOrg5')
    const reg = await request(app).post('/api/auth/register').send(payload)
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${reg.body.token}`)
    expect(res.status).toBe(200)
    expect(res.body.member.email).toBe(payload.user.email)
  })

  it('rejects /me without a token', async () => {
    const res = await request(app).get('/api/auth/me')
    expect(res.status).toBe(401)
  })

  it('enforces role-based access control (403 where forbidden)', async () => {
    const payload = org('AuthOrg6')
    const reg = await request(app).post('/api/auth/register').send(payload)
    const ownerToken = reg.body.token as string

    const rolesRes = await request(app)
      .get('/api/roles')
      .set('Authorization', `Bearer ${ownerToken}`)
    expect(rolesRes.status).toBe(200)
    const roleId = (name: string) =>
      (rolesRes.body as Array<{ name: string; id: string }>).find((r) => r.name === name)!.id
    // all 5 system roles exist
    for (const name of ['OWNER', 'ADMIN', 'MANAGER', 'EMPLOYEE', 'VIEWER']) {
      expect(roleId(name), name).toBeDefined()
    }

    async function loginAs(roleName: string) {
      const email = `${roleName.toLowerCase()}-rbac-${Date.now()}@example.com`
      const created = await request(app)
        .post('/api/members')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: `${roleName} User`, email, password: 'password123', roleId: roleId(roleName) })
      expect(created.status).toBe(201)
      const login = await request(app)
        .post('/api/auth/login')
        .send({ email, password: 'password123' })
      expect(login.status).toBe(200)
      return login.body.token as string
    }

    const viewer = await loginAs('VIEWER')
    const employee = await loginAs('EMPLOYEE')
    const manager = await loginAs('MANAGER')
    const admin = await loginAs('ADMIN')

    const get = (token: string, url: string) =>
      request(app).get(url).set('Authorization', `Bearer ${token}`)
    const post = (token: string, url: string, body: unknown) =>
      request(app).post(url).set('Authorization', `Bearer ${token}`).send(body)
    const patch = (token: string, url: string, body: unknown) =>
      request(app).patch(url).set('Authorization', `Bearer ${token}`).send(body)

    // VIEWER: read-only
    expect((await get(viewer, '/api/products')).status).toBe(200)
    expect((await get(viewer, '/api/reports/summary')).status).toBe(200)
    expect((await post(viewer, '/api/products', { name: 'X', price: 1 })).status).toBe(403)
    expect((await post(viewer, '/api/orders', { items: [] })).status).toBe(403)

    // EMPLOYEE: customers.read + orders.read/create only
    expect((await get(employee, '/api/customers')).status).toBe(200)
    expect((await get(employee, '/api/orders')).status).toBe(200)
    expect((await get(employee, '/api/products')).status).toBe(403)
    expect((await post(employee, '/api/customers', { name: 'X' })).status).toBe(403)
    expect((await get(employee, '/api/reports/summary')).status).toBe(403)

    // MANAGER: customers/products/orders/invoices/employees + reports, but not settings/audit
    expect((await post(manager, '/api/products', { name: 'M Widget', price: 100 })).status).toBe(201)
    expect((await get(manager, '/api/reports/summary')).status).toBe(200)
    expect((await post(manager, '/api/employees', { name: 'M Emp' })).status).toBe(201)
    expect((await patch(manager, '/api/settings', { currency: 'USD' })).status).toBe(403)
    expect((await get(manager, '/api/audit-logs')).status).toBe(403)

    // ADMIN: almost everything, but not settings.manage
    expect((await post(admin, '/api/employees', { name: 'A Emp' })).status).toBe(201)
    expect((await get(admin, '/api/audit-logs')).status).toBe(200)
    expect((await patch(admin, '/api/settings', { currency: 'USD' })).status).toBe(403)

    // OWNER: everything, including settings
    expect((await patch(ownerToken, '/api/settings', { currency: 'PKR' })).status).toBe(200)

    // unauthenticated -> 401 (not 403)
    expect((await request(app).get('/api/products')).status).toBe(401)
  })

  it('soft-deletes customers instead of hard-deleting', async () => {
    const payload = org('AuthOrg7')
    const reg = await request(app).post('/api/auth/register').send(payload)
    const token = reg.body.token

    const created = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Doomed Customer', phone: '0300-0000001' })
    expect(created.status).toBe(201)

    const del = await request(app)
      .delete(`/api/customers/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(del.status).toBe(204)

    // gone from list…
    const list = await request(app)
      .get('/api/customers')
      .set('Authorization', `Bearer ${token}`)
    expect(list.body.data.find((c: { id: string }) => c.id === created.body.id)).toBeUndefined()

    // …but still in the database with deletedAt set
    const row = await prisma.customer.findUnique({ where: { id: created.body.id } })
    expect(row?.deletedAt).not.toBeNull()
  })
})

describeIfDb('auth sessions & passwords', () => {
  async function registerOrg(tag: string, password = 'password123') {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        organization: { name: `Sess ${tag}`, city: 'Lahore', province: 'Punjab' },
        user: { name: `Owner ${tag}`, email: `sess-${tag}-${Date.now()}@example.com`, password },
      })
    return { token: res.body.token as string, email: res.body.member.email as string }
  }

  it('logout invalidates the token', async () => {
    const { token } = await registerOrg('logout1')
    const me1 = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)
    expect(me1.status).toBe(200)

    const out = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`)
    expect(out.status).toBe(200)

    const me2 = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)
    expect(me2.status).toBe(401)
    expect(me2.body.error.code).toBe('SESSION_EXPIRED')
  })

  it('rejects weak passwords at registration', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        organization: { name: 'Weak Org' },
        user: { name: 'Weak User', email: `weak-${Date.now()}@example.com`, password: 'short' },
      })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('change-password requires the current password and logs out sessions', async () => {
    const { token, email } = await registerOrg('chpwd1')

    const wrong = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'nottherightone1', newPassword: 'newpassword456' })
    expect(wrong.status).toBe(401)

    const ok = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'password123', newPassword: 'newpassword456' })
    expect(ok.status).toBe(200)

    // old token is dead
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)
    expect(me.status).toBe(401)

    // old password dead, new password works
    const oldLogin = await request(app).post('/api/auth/login').send({ email, password: 'password123' })
    expect(oldLogin.status).toBe(401)
    const newLogin = await request(app).post('/api/auth/login').send({ email, password: 'newpassword456' })
    expect(newLogin.status).toBe(200)
  })

  it('forgot/reset password flow works and tokens are single-use', async () => {
    const { email } = await registerOrg('reset1')

    const forgot = await request(app).post('/api/auth/forgot-password').send({ email })
    expect(forgot.status).toBe(200)
    const devToken = forgot.body.devToken as string | undefined
    expect(devToken).toBeDefined()

    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: devToken, password: 'brandnewpass789' })
    expect(reset.status).toBe(200)

    // single use
    const reuse = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: devToken, password: 'anotherpass000' })
    expect(reuse.status).toBe(400)

    // login with the new password
    const login = await request(app).post('/api/auth/login').send({ email, password: 'brandnewpass789' })
    expect(login.status).toBe(200)
  })

  it('forgot-password does not enumerate emails', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody-real-here@example.com' })
    expect(res.status).toBe(200)
    expect(res.body.devToken).toBeUndefined()
  })

  it('rejects invalid reset tokens', async () => {
    const res = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'not-a-real-token', password: 'somepass123' })
    expect(res.status).toBe(400)
  })
})

describeIfDb('auth multi-organization', () => {
  async function twoOrgsSameUser(tag: string) {
    const email = `multi-${tag}-${Date.now()}@example.com`
    const regA = await request(app)
      .post('/api/auth/register')
      .send({
        organization: { name: `MultiA ${tag}`, city: 'Lahore', province: 'Punjab' },
        user: { name: 'Multi User', email, password: 'password123' },
      })
    const regB = await request(app)
      .post('/api/auth/register')
      .send({
        organization: { name: `MultiB ${tag}`, city: 'Multan', province: 'Punjab' },
        user: { name: 'Owner B', email: `ownerb-${tag}-${Date.now()}@example.com`, password: 'password123' },
      })
    const tokenB = regB.body.token as string
    const roles = await request(app).get('/api/roles').set('Authorization', `Bearer ${tokenB}`)
    const managerRole = (roles.body as Array<{ id: string; name: string }>).find((r) => r.name === 'MANAGER')
    const invite = await request(app)
      .post('/api/members')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'Multi User', email, password: 'password123', roleId: managerRole!.id })
    expect(invite.status).toBe(201)
    return {
      email,
      tokenA: regA.body.token as string,
      orgA: regA.body.organization as { id: string; name: string },
      orgB: regB.body.organization as { id: string; name: string },
    }
  }

  it('login with two memberships returns a select token, not a session', async () => {
    const { email } = await twoOrgsSameUser('login2')
    const res = await request(app).post('/api/auth/login').send({ email, password: 'password123' })
    expect(res.status).toBe(200)
    expect(res.body.requiresOrgSelection).toBe(true)
    expect(res.body.token).toBeUndefined()
    expect(res.body.selectToken).toBeDefined()
    expect(res.body.memberships).toHaveLength(2)
  })

  it('switch-organization with the select token issues a full session', async () => {
    const { email, orgA, orgB } = await twoOrgsSameUser('switch1')
    const login = await request(app).post('/api/auth/login').send({ email, password: 'password123' })
    const selectToken = login.body.selectToken as string

    // The select token alone grants no org access
    const denied = await request(app)
      .get('/api/customers')
      .set('Authorization', `Bearer ${selectToken}`)
    expect(denied.status).toBe(401)

    const sw = await request(app)
      .post('/api/auth/switch-organization')
      .set('Authorization', `Bearer ${selectToken}`)
      .send({ organizationId: orgB.id })
    expect(sw.status).toBe(200)
    expect(sw.body.token).toBeDefined()
    expect(sw.body.organization.id).toBe(orgB.id)
    expect(sw.body.member.role.name).toBe('MANAGER')

    // The issued session works for org B…
    const meB = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${sw.body.token}`)
    expect(meB.status).toBe(200)
    expect(meB.body.organization.id).toBe(orgB.id)

    // …and cannot read org A's data
    const custA = await request(app).get('/api/customers').set('Authorization', `Bearer ${sw.body.token}`)
    expect(custA.status).toBe(200)
    expect(custA.body.data ?? custA.body).toEqual([])

    // switching back to org A with the same select token also works
    const swA = await request(app)
      .post('/api/auth/switch-organization')
      .set('Authorization', `Bearer ${selectToken}`)
      .send({ organizationId: orgA.id })
    expect(swA.status).toBe(200)
    expect(swA.body.organization.id).toBe(orgA.id)
    expect(swA.body.member.role.name).toBe('OWNER')
  })

  it('switch-organization rejects orgs the user is not a member of', async () => {
    const { email } = await twoOrgsSameUser('switch2')
    const other = await request(app)
      .post('/api/auth/register')
      .send({
        organization: { name: `Stranger ${Date.now()}`, city: 'Lahore', province: 'Punjab' },
        user: { name: 'Stranger', email: `stranger-${Date.now()}@example.com`, password: 'password123' },
      })
    const login = await request(app).post('/api/auth/login').send({ email, password: 'password123' })
    const res = await request(app)
      .post('/api/auth/switch-organization')
      .set('Authorization', `Bearer ${login.body.selectToken}`)
      .send({ organizationId: other.body.organization.id })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('switch-organization rejects missing and garbage tokens', async () => {
    const { orgA } = await twoOrgsSameUser('switch3')
    const noToken = await request(app)
      .post('/api/auth/switch-organization')
      .send({ organizationId: orgA.id })
    expect(noToken.status).toBe(401)
    const garbage = await request(app)
      .post('/api/auth/switch-organization')
      .set('Authorization', 'Bearer not-a-token')
      .send({ organizationId: orgA.id })
    expect(garbage.status).toBe(401)
  })

  it('a full session token can also switch organizations', async () => {
    const { tokenA, orgB } = await twoOrgsSameUser('switch4')
    // tokenA is a live session for org A; use it to move to org B
    const sw = await request(app)
      .post('/api/auth/switch-organization')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ organizationId: orgB.id })
    expect(sw.status).toBe(200)
    expect(sw.body.organization.id).toBe(orgB.id)
    expect(sw.body.token).toBeDefined()
  })
})
