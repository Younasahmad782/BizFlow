import { afterAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { io as ioClient, type Socket } from 'socket.io-client'
import { PrismaClient } from '@prisma/client'
import app from '../src/app'
import { initSockets } from '../src/lib/sockets'

const describeIfDb = process.env.TEST_DATABASE_URL ? describe : describe.skip
const prisma = new PrismaClient()

afterAll(async () => {
  await prisma.$disconnect()
})

let n = 0
async function registerOrganization(tag: string) {
  n += 1
  const res = await request(app)
    .post('/api/auth/register')
    .send({
      organization: { name: `Notif ${tag} ${n}`, city: 'Lahore', province: 'Punjab' },
      user: { name: `Owner ${n}`, email: `notif-${tag}-${n}-${Date.now()}@example.com`, password: 'password123' },
    })
  return { token: res.body.token as string }
}

async function createProduct(token: string, name: string) {
  const res = await request(app)
    .post('/api/products')
    .set('Authorization', `Bearer ${token}`)
    .send({ name, price: 5000 })
  expect(res.status).toBe(201)
  return res.body.id as string
}

async function receiveStock(token: string, productId: string, quantity: number) {
  const res = await request(app)
    .post('/api/inventory/receive')
    .set('Authorization', `Bearer ${token}`)
    .send({ productId, quantity, reason: 'Test purchase' })
  expect(res.status).toBe(200)
}

async function createCustomer(token: string) {
  const res = await request(app)
    .post('/api/customers')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Notif Customer', phone: '0300-1111111' })
  expect(res.status).toBe(201)
  return res.body.id as string
}

async function typesOf(token: string, query = '') {
  const res = await request(app)
    .get(`/api/notifications${query}`)
    .set('Authorization', `Bearer ${token}`)
  expect(res.status).toBe(200)
  return res.body.notifications as Array<{ type: string; isRead: boolean }>
}

describeIfDb('notifications', () => {
  it('order creation produces an ORDER_CREATED notification', async () => {
    const { token } = await registerOrganization('ordCreate')
    const productId = await createProduct(token, 'Notif Widget A')
    const customerId = await createCustomer(token)
    const order = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, items: [{ productId, quantity: 1, unitPrice: 5000 }] })
    expect(order.status).toBe(201)

    const types = (await typesOf(token)).map((x) => x.type)
    expect(types).toContain('ORDER_CREATED')
  })

  it('order confirmation produces ORDER_CONFIRMED and LOW_STOCK notifications', async () => {
    const { token } = await registerOrganization('ordConfirm')
    const productId = await createProduct(token, 'Notif Widget B')
    await receiveStock(token, productId, 10) // reorder level default 5
    const customerId = await createCustomer(token)
    const order = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, items: [{ productId, quantity: 8, unitPrice: 5000 }] })
    expect(order.status).toBe(201)

    const confirm = await request(app)
      .post(`/api/orders/${order.body.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
    expect(confirm.status).toBe(200)

    const types = (await typesOf(token)).map((x) => x.type)
    expect(types).toContain('ORDER_CONFIRMED')
    // 10 - 8 = 2 <= reorder level 5
    expect(types).toContain('LOW_STOCK')
  })

  it('low-stock alerts are deduped while unread', async () => {
    const { token } = await registerOrganization('lowDedupe')
    const productId = await createProduct(token, 'Notif Widget C')
    await receiveStock(token, productId, 3) // below reorder level
    await request(app)
      .post('/api/inventory/issue')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId, quantity: 1, reason: 'Test sale' })
    const notes = await typesOf(token)
    const lowStock = notes.filter((x) => x.type === 'LOW_STOCK')
    expect(lowStock.length).toBe(1)
  })

  it('order payment produces a PAYMENT_RECEIVED notification', async () => {
    const { token } = await registerOrganization('ordPay')
    const productId = await createProduct(token, 'Notif Widget D')
    await receiveStock(token, productId, 10)
    const customerId = await createCustomer(token)
    const order = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, items: [{ productId, quantity: 1, unitPrice: 5000 }] })
    const pay = await request(app)
      .post(`/api/orders/${order.body.id}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .send({ amount: 2000, method: 'CASH' })
    expect(pay.status).toBe(201)

    const types = (await typesOf(token)).map((x) => x.type)
    expect(types).toContain('PAYMENT_RECEIVED')
  })

  it('direct payment creation produces a PAYMENT_RECEIVED notification', async () => {
    const { token } = await registerOrganization('directPay')
    const productId = await createProduct(token, 'Notif Widget E')
    const customerId = await createCustomer(token)
    const invoice = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, items: [{ productId, quantity: 1, unitPrice: 5000 }] })
    expect(invoice.status).toBe(201)
    const pay = await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ invoiceId: invoice.body.id, amount: 1000, method: 'JAZZCASH' })
    expect(pay.status).toBe(201)

    const types = (await typesOf(token)).map((x) => x.type)
    expect(types).toContain('PAYMENT_RECEIVED')
  })

  it('employee creation produces an EMPLOYEE_ADDED notification', async () => {
    const { token } = await registerOrganization('empAdd')
    const emp = await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New Hire' })
    expect(emp.status).toBe(201)

    const types = (await typesOf(token)).map((x) => x.type)
    expect(types).toContain('EMPLOYEE_ADDED')
  })

  it('mark-all-read clears unread count and the unread filter works', async () => {
    const { token } = await registerOrganization('readAll')
    await request(app)
      .post('/api/employees')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Read Test' })

    const before = await request(app).get('/api/notifications').set('Authorization', `Bearer ${token}`)
    expect(before.body.unreadCount).toBeGreaterThan(0)

    const unreadOnly = await request(app)
      .get('/api/notifications?unread=true')
      .set('Authorization', `Bearer ${token}`)
    expect(unreadOnly.body.notifications.every((x: { isRead: boolean }) => !x.isRead)).toBe(true)

    const mark = await request(app)
      .patch('/api/notifications/read-all')
      .set('Authorization', `Bearer ${token}`)
    expect(mark.status).toBe(200)
    expect(mark.body.markedRead).toBeGreaterThan(0)

    const after = await request(app).get('/api/notifications').set('Authorization', `Bearer ${token}`)
    expect(after.body.unreadCount).toBe(0)
  })

  it('overdue invoices produce INVOICE_OVERDUE when notifications are listed', async () => {
    const { token } = await registerOrganization('overdue')
    const productId = await createProduct(token, 'Notif Widget F')
    const customerId = await createCustomer(token)
    const past = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()
    const invoice = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, dueDate: past, items: [{ productId, quantity: 1, unitPrice: 5000 }] })
    expect(invoice.status).toBe(201)

    const types = (await typesOf(token)).map((x) => x.type)
    expect(types).toContain('INVOICE_OVERDUE')
  })

  it('socket: same-org client receives the event, other-org client does not', async () => {
    const a = await registerOrganization('sockA')
    const b = await registerOrganization('sockB')

    const httpServer = createServer(app)
    initSockets(httpServer)
    await new Promise<void>((resolve) => httpServer.listen(0, resolve))
    const port = (httpServer.address() as AddressInfo).port

    const connect = (token: string): Promise<Socket> =>
      new Promise((resolve, reject) => {
        const s = ioClient(`http://127.0.0.1:${port}`, {
          auth: { token },
          transports: ['websocket'],
        })
        s.on('connect', () => resolve(s))
        s.on('connect_error', reject)
      })

    const clientA = await connect(a.token)
    const clientB = await connect(b.token)
    try {
      const receivedA = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('client A got no event')), 8000)
        clientA.on('notification', (payload) => {
          clearTimeout(timer)
          resolve(payload)
        })
      })
      let receivedB: unknown = null
      clientB.on('notification', (payload) => {
        receivedB = payload
      })

      // Trigger a notification in org A only
      const productId = await createProduct(a.token, 'Socket Widget')
      const customerId = await createCustomer(a.token)
      const order = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ customerId, items: [{ productId, quantity: 1, unitPrice: 5000 }] })
      expect(order.status).toBe(201)

      const payload = (await receivedA) as { type: string; organizationId: string }
      expect(payload.type).toBe('ORDER_CREATED')

      // give client B a moment — it must stay silent
      await new Promise((r) => setTimeout(r, 1000))
      expect(receivedB).toBeNull()
    } finally {
      clientA.disconnect()
      clientB.disconnect()
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    }
  })

  it('socket: unauthenticated connections are rejected', async () => {
    const httpServer = createServer(app)
    initSockets(httpServer)
    await new Promise<void>((resolve) => httpServer.listen(0, resolve))
    const port = (httpServer.address() as AddressInfo).port
    try {
      const err = await new Promise<Error>((resolve) => {
        const s = ioClient(`http://127.0.0.1:${port}`, {
          auth: { token: 'garbage' },
          transports: ['websocket'],
        })
        s.on('connect_error', (e: Error) => {
          s.disconnect()
          resolve(e)
        })
        s.on('connect', () => {
          s.disconnect()
          resolve(new Error('connected without a valid token'))
        })
      })
      expect(err.message).not.toBe('connected without a valid token')
    } finally {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    }
  })
})
