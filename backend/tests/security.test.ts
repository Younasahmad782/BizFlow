/**
 * Security audit suite — automated tests for authentication, authorization,
 * RBAC, multi-tenancy and input-attack resistance.
 */
import { afterAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { PrismaClient } from '@prisma/client'
import jwt from 'jsonwebtoken'
import app from '../src/app'

const describeIfDb = process.env.TEST_DATABASE_URL ? describe : describe.skip
const prisma = new PrismaClient()

afterAll(async () => {
  await prisma.$disconnect()
})


let n = 0
async function registerOrganization(tag: string) {
  n += 1
  const email = `sec-${tag}-${n}@example.com`
  const res = await request(app).post('/api/auth/register').send({
    organization: { name: `SecOrg ${tag}`, city: 'Lahore', province: 'Punjab' },
    user: { name: `Owner ${n}`, email, password: 'password123' },
  })
  return { token: res.body.token as string, email, memberId: res.body.member?.id as string }
}

async function createViewer(ownerToken: string, tag: string) {
  n += 1
  const roles = await request(app).get('/api/roles').set('Authorization', `Bearer ${ownerToken}`)
  const viewerRole = roles.body.find((r: { name: string }) => r.name === 'VIEWER')
  const email = `viewer-${tag}-${n}@example.com`
  const created = await request(app)
    .post('/api/members')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ name: `Viewer ${n}`, email, password: 'password123', roleId: viewerRole.id })
  expect(created.status).toBe(201)
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'password123' })
  return { token: login.body.token as string, email }
}

describeIfDb('authentication', () => {
  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/customers')
    expect(res.status).toBe(401)
  })

  it('rejects malformed JWTs', async () => {
    for (const bad of ['Bearer garbage', 'Bearer a.b.c', 'Token xyz', 'Bearer ']) {
      const res = await request(app).get('/api/customers').set('Authorization', bad)
      expect(res.status).toBe(401)
    }
  })

  it('rejects tokens signed with the wrong secret', async () => {
    const fake = jwt.sign({ memberId: 'x', tv: 1 }, 'wrong-secret', { expiresIn: '1h' })
    const res = await request(app).get('/api/customers').set('Authorization', `Bearer ${fake}`)
    expect(res.status).toBe(401)
  })

  it('rejects expired tokens', async () => {
    const { token } = await registerOrganization('exp')
    const payload = jwt.decode(token) as Record<string, unknown>
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { exp, iat, ...claims } = payload
    const expired = jwt.sign(claims, process.env.JWT_SECRET ?? 'dev-secret-change-me', {
      expiresIn: '-1s',
    })
    const res = await request(app).get('/api/customers').set('Authorization', `Bearer ${expired}`)
    expect(res.status).toBe(401)
  })

  it('invalidates sessions on logout (token version bump)', async () => {
    const { token, email } = await registerOrganization('logout')
    const before = await request(app).get('/api/customers').set('Authorization', `Bearer ${token}`)
    expect(before.status).toBe(200)
    await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`)
    const after = await request(app).get('/api/customers').set('Authorization', `Bearer ${token}`)
    expect(after.status).toBe(401)

    // re-login works with a fresh token
    const relogin = await request(app).post('/api/auth/login').send({ email, password: 'password123' })
    expect(relogin.status).toBe(200)
  })

  it('rejects login with wrong password', async () => {
    const { email } = await registerOrganization('wrongpw')
    const res = await request(app).post('/api/auth/login').send({ email, password: 'wrongpassword' })
    expect(res.status).toBe(401)
  })
})

describeIfDb('multi-tenancy — org A vs org B', () => {
  it('org A user cannot read org B customer (404, no leak)', async () => {
    const a = await registerOrganization('xa')
    const b = await registerOrganization('xb')
    const created = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ name: 'B Secret Customer' })
    expect(created.status).toBe(201)

    const direct = await request(app)
      .get(`/api/customers/${created.body.id}`)
      .set('Authorization', `Bearer ${a.token}`)
    expect(direct.status).toBe(404)

    const list = await request(app).get('/api/customers').set('Authorization', `Bearer ${a.token}`)
    expect(list.body.data.find((c: { id: string }) => c.id === created.body.id)).toBeUndefined()
  })

  it('org A user cannot update org B invoice', async () => {
    const a = await registerOrganization('ya')
    const b = await registerOrganization('yb')
    const invoices = await request(app).get('/api/invoices').set('Authorization', `Bearer ${b.token}`)
    // create an invoice via order flow
    const product = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ name: 'YB Product', price: 5000 })
    await request(app)
      .post('/api/inventory/receive')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ productId: product.body.id, quantity: 5, reason: 'stock' })
    const customer = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ name: 'YB Customer' })
    const order = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ customerId: customer.body.id, items: [{ productId: product.body.id, quantity: 1, unitPrice: 5000 }] })
    await request(app).post(`/api/orders/${order.body.id}/confirm`).set('Authorization', `Bearer ${b.token}`)
    const invList = await request(app).get('/api/invoices').set('Authorization', `Bearer ${b.token}`)
    expect(invList.body.data.length).toBeGreaterThan(0)
    const invId = invList.body.data[0].id
    expect(invoices.status).toBe(200)

    // org A tries every write path on org B's invoice
    const pay = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ invoiceId: invId, amount: 100, method: 'CASH' })
    expect([400, 404]).toContain(pay.status)

    const pdf = await request(app)
      .get(`/api/invoices/${invId}/pdf`)
      .set('Authorization', `Bearer ${a.token}`)
    expect(pdf.status).toBe(404)
  })

  it('org A user cannot touch org B employee, order, product, expense', async () => {
    const a = await registerOrganization('za')
    const b = await registerOrganization('zb')

    const product = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ name: 'ZB Product', price: 2000 })
    const expense = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ title: 'ZB Rent', amount: 30000, category: 'Rent' })

    for (const path of [
      `/api/products/${product.body.id}`,
      `/api/expenses/${expense.body.id}`,
    ]) {
      const read = await request(app).get(path).set('Authorization', `Bearer ${a.token}`)
      expect(read.status).toBe(404)
      const del = await request(app).delete(path).set('Authorization', `Bearer ${a.token}`)
      expect(del.status).toBe(404)
    }

    const emp = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ name: 'ZB Employee', department: 'Sales' })
    const empRead = await request(app)
      .get(`/api/employees/${emp.body.id}`)
      .set('Authorization', `Bearer ${a.token}`)
    expect(empRead.status).toBe(404)
  })
})

describeIfDb('RBAC — privilege escalation', () => {
  it('org A employee cannot access owner-only settings', async () => {
    const owner = await registerOrganization('esc')
    const viewer = await createViewer(owner.token, 'esc')

    const read = await request(app).get('/api/settings').set('Authorization', `Bearer ${viewer.token}`)
    expect(read.status).toBe(403)

    const write = await request(app)
      .patch('/api/settings')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ taxRate: 99 })
    expect(write.status).toBe(403)

    const profile = await request(app)
      .patch('/api/settings/profile')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ name: 'Hijacked' })
    expect(profile.status).toBe(403)
  })

  it('viewer cannot delete, create users, or change roles', async () => {
    const owner = await registerOrganization('priv')
    const viewer = await createViewer(owner.token, 'priv')

    const product = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Priv Product', price: 1000 })
    const del = await request(app)
      .delete(`/api/products/${product.body.id}`)
      .set('Authorization', `Bearer ${viewer.token}`)
    expect(del.status).toBe(403)

    const addMember = await request(app)
      .post('/api/members')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ name: 'Sneaky', email: 'sneaky@example.com', password: 'password123', roleId: 'x' })
    expect(addMember.status).toBe(403)

    const audit = await request(app).get('/api/audit-logs').set('Authorization', `Bearer ${viewer.token}`)
    expect(audit.status).toBe(200) // viewers have read-only access, including audit logs

    const assistantAsk = await request(app)
      .post('/api/assistant/ask')
      .set('Authorization', `Bearer ${viewer.token}`)
      .send({ question: 'How much revenue did we make this month?' })
    expect(assistantAsk.status).toBe(200) // viewers can ask (reports.read)
  })

  it('non-owner cannot create an OWNER account', async () => {
    const owner = await registerOrganization('noesc')
    // create an admin via owner
    const roles = await request(app).get('/api/roles').set('Authorization', `Bearer ${owner.token}`)
    const adminRole = roles.body.find((r: { name: string }) => r.name === 'ADMIN')
    const admin = await request(app)
      .post('/api/members')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Admin X', email: `adminx-${n}@example.com`, password: 'password123', roleId: adminRole.id })
    expect(admin.status).toBe(201)
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: `adminx-${n}@example.com`, password: 'password123' })

    const ownerRole = roles.body.find((r: { name: string }) => r.name === 'OWNER')
    const attempt = await request(app)
      .post('/api/members')
      .set('Authorization', `Bearer ${adminLogin.body.token}`)
      .send({ name: 'Fake Owner', email: `fakeowner-${n}@example.com`, password: 'password123', roleId: ownerRole.id })
    expect(attempt.status).toBe(403)
  })
})

describeIfDb('rate limiting', () => {
  it('throttles repeated login attempts', async () => {
    // loginLimiter: 20 per 15 min. Fire 25 bad logins; expect 429s at the tail.
    let limited = 0
    for (let i = 0; i < 25; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'ratelimit@example.com', password: 'wrong' })
      if (res.status === 429) limited++
    }
    expect(limited).toBeGreaterThan(0)
  })
})
describeIfDb('input attacks', () => {
  it('SQL injection attempts in search are neutralized', async () => {
    const { token } = await registerOrganization('sqli')
    const payloads = [
      `' OR '1'='1`,
      `'; DROP TABLE "Customer"; --`,
      `1' UNION SELECT * FROM "Organization" --`,
    ]
    for (const p of payloads) {
      const res = await request(app)
        .get('/api/customers')
        .query({ search: p })
        .set('Authorization', `Bearer ${token}`)
      expect([200, 400]).toContain(res.status)
    }
    // tables still intact
    const check = await request(app).get('/api/customers').set('Authorization', `Bearer ${token}`)
    expect(check.status).toBe(200)
  })

  it('XSS payloads are stored as inert text, not executed markup', async () => {
    const { token } = await registerOrganization('xss')
    const payload = `<script>alert('xss')</script><img src=x onerror=alert(1)>`
    const created = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: payload })
    expect(created.status).toBe(201)
    // returned verbatim — the React frontend renders it as escaped text
    expect(created.body.name).toBe(payload)
    expect(created.body.name).not.toContain('&lt;')
  })

  it('malformed JSON is rejected cleanly', async () => {
    const { token } = await registerOrganization('badjson')
    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send('{invalid json')
    expect(res.status).toBe(400)
  })

  it('mass assignment is blocked — client cannot set organizationId, roles, flags', async () => {
    const a = await registerOrganization('massA')
    const b = await registerOrganization('massB')

    // try to create a product in org B's tenant
    const created = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ name: 'Mass Product', price: 100, organizationId: 'injected' } as never)
    expect(created.status).toBe(201)
    // it must belong to org A, not the injected id
    const bList = await request(app).get('/api/products').set('Authorization', `Bearer ${b.token}`)
    expect(bList.body.data.find((p: { id: string }) => p.id === created.body.id)).toBeUndefined()

    // try to escalate own member record via update
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${a.token}`)
    const memberId = me.body.member?.id ?? me.body.id
    if (memberId) {
      const escalate = await request(app)
        .patch(`/api/members/${memberId}`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({ isActive: true, roleName: 'OWNER' } as never)
      expect([400, 403, 404]).toContain(escalate.status)
    }
  })

  it('ID manipulation — random UUIDs and other-org ids return 404', async () => {
    const a = await registerOrganization('idmA')
    const b = await registerOrganization('idmB')
    const created = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ name: 'IDM Customer' })

    for (const id of [
      created.body.id, // other org's real id
      '00000000-0000-0000-0000-000000000000', // valid UUID, nonexistent
      'not-a-uuid', // invalid format
    ]) {
      const res = await request(app).get(`/api/customers/${id}`).set('Authorization', `Bearer ${a.token}`)
      expect([400, 404]).toContain(res.status)
    }
  })
})

describeIfDb('file uploads', () => {
  it('real upload validates type, size, tenant refs and traversal names', async () => {
    const a = await registerOrganization('fileA')
    const b = await registerOrganization('fileB')
    const product = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ name: 'File Product', price: 100 })

    // traversal-style filename: stored under a UUID name inside the org dir
    const traversal = await request(app)
      .post('/api/files')
      .set('Authorization', `Bearer ${a.token}`)
      .attach('file', Buffer.alloc(512, 0x25), { filename: '../../../etc/evil.pdf', contentType: 'application/pdf' })
    expect(traversal.status).toBe(201)
    expect(traversal.body.filename).not.toContain('..')

    // cross-tenant entity reference
    const crossRef = await request(app)
      .post('/api/files')
      .set('Authorization', `Bearer ${a.token}`)
      .field('entity', 'product')
      .field('entityId', product.body.id)
      .attach('file', Buffer.alloc(512, 0x25), { filename: 'doc.pdf', contentType: 'application/pdf' })
    expect(crossRef.status).toBe(404)

    // disallowed extension
    const badExt = await request(app)
      .post('/api/files')
      .set('Authorization', `Bearer ${a.token}`)
      .attach('file', Buffer.alloc(512, 0x4d), { filename: 'run.exe', contentType: 'application/x-msdownload' })
    expect(badExt.status).toBe(400)

    // MIME/extension mismatch
    const mismatch = await request(app)
      .post('/api/files')
      .set('Authorization', `Bearer ${a.token}`)
      .attach('file', Buffer.alloc(512, 0x25), { filename: 'fake.pdf', contentType: 'image/png' })
    expect(mismatch.status).toBe(400)

    // oversized
    const huge = await request(app)
      .post('/api/files')
      .set('Authorization', `Bearer ${a.token}`)
      .attach('file', Buffer.alloc(11 * 1024 * 1024, 0x25), { filename: 'big.pdf', contentType: 'application/pdf' })
    expect(huge.status).toBe(400)

    // happy path: upload + download round-trip
    const content = Buffer.from('%PDF-1.4 test invoice content')
    const ok = await request(app)
      .post('/api/files')
      .set('Authorization', `Bearer ${a.token}`)
      .attach('file', content, { filename: 'invoice.pdf', contentType: 'application/pdf' })
    expect(ok.status).toBe(201)
    expect(ok.body.id).toBeDefined()

    const dl = await request(app)
      .get(`/api/files/${ok.body.id}/download`)
      .set('Authorization', `Bearer ${a.token}`)
    expect(dl.status).toBe(200)
    expect(dl.headers['content-type']).toContain('application/pdf')
    expect(Buffer.from(dl.body as Buffer).equals(content)).toBe(true)

    // cross-tenant download → 404
    const crossDl = await request(app)
      .get(`/api/files/${ok.body.id}/download`)
      .set('Authorization', `Bearer ${b.token}`)
    expect(crossDl.status).toBe(404)

    // unauthenticated download → 401
    const noAuth = await request(app).get(`/api/files/${ok.body.id}/download`)
    expect(noAuth.status).toBe(401)

    // list shows the file with the uploader's name (no storage internals)
    const list = await request(app).get('/api/files').set('Authorization', `Bearer ${a.token}`)
    expect(list.status).toBe(200)
    const entry = (list.body as Array<{ id: string; filename: string; uploadedBy: { name: string } | null }>).find(
      (f) => f.id === ok.body.id,
    )
    expect(entry?.filename).toBe('invoice.pdf')
    expect(entry?.uploadedBy?.name).toBeDefined()
  })

  it('upload requires a file and rejects unauthenticated callers', async () => {
    const noFile = await request(app).post('/api/files')
    expect(noFile.status).toBe(401)

    const a = await registerOrganization('fileC')
    const empty = await request(app)
      .post('/api/files')
      .set('Authorization', `Bearer ${a.token}`)
      .field('entity', 'product')
    expect(empty.status).toBe(400)
  })
})
