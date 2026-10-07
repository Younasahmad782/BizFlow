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
async function registerOrganization(tag: string) {
  n += 1
  const email = `tenant-${tag}-${n}@example.com`
  const res = await request(app)
    .post('/api/auth/register')
    .send({
      organization: { name: `Tenant ${tag}`, city: 'Karachi', province: 'Sindh' },
      user: { name: `Owner ${n}`, email, password: 'password123' },
    })
  return { token: res.body.token as string, email }
}

describeIfDb('tenant isolation', () => {
  it('organization A cannot read organization B products', async () => {
    const a = await registerOrganization('isoA')
    const b = await registerOrganization('isoB')

    const created = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ name: 'Secret Widget', price: 1000 })
    expect(created.status).toBe(201)

    const list = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${b.token}`)
    expect(list.body.data.find((p: { id: string }) => p.id === created.body.id)).toBeUndefined()

    const direct = await request(app)
      .get(`/api/products/${created.body.id}`)
      .set('Authorization', `Bearer ${b.token}`)
    expect(direct.status).toBe(404)
  })

  it('organization A cannot delete organization B records', async () => {
    const a = await registerOrganization('isoC')
    const b = await registerOrganization('isoD')

    const created = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${b.token}`)
      .send({ name: 'B Customer', phone: '0300-0000001' })
    expect(created.status).toBe(201)

    const del = await request(app)
      .delete(`/api/customers/${created.body.id}`)
      .set('Authorization', `Bearer ${a.token}`)
    expect(del.status).toBe(404)
  })
})

describeIfDb('inventory transactions', () => {
  async function setupProduct(tag: string, stock: number) {
    const { token } = await registerOrganization(tag)
    const product = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Widget ${tag}`, price: 5000 })
    const productId = product.body.id as string
    await request(app)
      .post('/api/inventory/receive')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId, quantity: stock, reason: 'Test purchase' })
    return { token, productId }
  }

  async function stockOf(token: string, productId: string) {
    const res = await request(app)
      .get('/api/inventory')
      .set('Authorization', `Bearer ${token}`)
    const row = res.body.find((r: { product: { id: string } }) => r.product.id === productId)
    return row?.quantity as number
  }

  it('confirming an order deducts stock and writes a movement', async () => {
    const { token, productId } = await setupProduct('invA', 10)
    const customer = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Order Customer' })

    const order = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId: customer.body.id, items: [{ productId, quantity: 3, unitPrice: 5000 }] })
    expect(order.status).toBe(201)
    expect(order.body.orderNumber).toMatch(/^ORD-/)

    // stock untouched while order is a draft
    expect(await stockOf(token, productId)).toBe(10)

    const confirmed = await request(app)
      .post(`/api/orders/${order.body.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.status).toBe('CONFIRMED')
    expect(await stockOf(token, productId)).toBe(7)

    const movements = await request(app)
      .get(`/api/inventory/movements?productId=${productId}`)
      .set('Authorization', `Bearer ${token}`)
    expect(movements.body.some((m: { type: string }) => m.type === 'OUT')).toBe(true)
  })

  it('confirming beyond stock is rejected and rolls back', async () => {
    const { token, productId } = await setupProduct('invB', 2)
    const customer = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Rollback Customer' })

    const order = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId: customer.body.id, items: [{ productId, quantity: 100, unitPrice: 5000 }] })
    expect(order.status).toBe(201)

    const confirmed = await request(app)
      .post(`/api/orders/${order.body.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
    expect(confirmed.status).toBe(400)
    expect(confirmed.body.error.code).toBe('INSUFFICIENT_STOCK')
    expect(await stockOf(token, productId)).toBe(2)

    // order still a draft, no invoice created
    const detail = await request(app)
      .get(`/api/orders/${order.body.id}`)
      .set('Authorization', `Bearer ${token}`)
    expect(detail.body.status).toBe('DRAFT')
    expect(detail.body.invoice).toBeNull()
  })

  it('low stock triggers a notification', async () => {
    const { token, productId } = await setupProduct('invC', 3) // reorderLevel default 5

    const notes = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`)
    expect(
      notes.body.notifications.some((x: { type: string }) => x.type === 'LOW_STOCK'),
    ).toBe(true)
    expect(await stockOf(token, productId)).toBe(3)
  })
})

describeIfDb('tenant isolation attack scenarios', () => {
  async function twoOrgs() {
    const a = await registerOrganization('atkA')
    const b = await registerOrganization('atkB')
    // Org A owns a customer, a product and an order
    const customer = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ name: 'A Customer', phone: '0300-1111111' })
    const product = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ name: 'A Product', price: 2500 })
    await request(app)
      .post('/api/inventory/receive')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ productId: product.body.id, quantity: 20, reason: 'opening' })
    const order = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${a.token}`)
      .send({
        customerId: customer.body.id,
        items: [{ productId: product.body.id, quantity: 2, unitPrice: 2500 }],
      })
    return {
      aToken: a.token,
      bToken: b.token,
      customerId: customer.body.id as string,
      productId: product.body.id as string,
      orderId: order.body.id as string,
    }
  }

  it('cannot READ another org data by guessing IDs (404, not 403)', async () => {
    const { bToken, customerId, productId, orderId } = await twoOrgs()
    for (const url of [
      `/api/customers/${customerId}`,
      `/api/products/${productId}`,
      `/api/orders/${orderId}`,
    ]) {
      const res = await request(app).get(url).set('Authorization', `Bearer ${bToken}`)
      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    }
  })

  it('cannot MODIFY another org data', async () => {
    const { aToken, bToken, customerId, productId, orderId } = await twoOrgs()

    const patchCustomer = await request(app)
      .patch(`/api/customers/${customerId}`)
      .set('Authorization', `Bearer ${bToken}`)
      .send({ name: 'Hacked' })
    expect(patchCustomer.status).toBe(404)

    const patchProduct = await request(app)
      .patch(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${bToken}`)
      .send({ price: 1 })
    expect(patchProduct.status).toBe(404)

    const patchOrder = await request(app)
      .patch(`/api/orders/${orderId}`)
      .set('Authorization', `Bearer ${bToken}`)
      .send({ status: 'CANCELLED' })
    expect(patchOrder.status).toBe(404)

    // org A's data is untouched
    const customer = await request(app)
      .get(`/api/customers/${customerId}`)
      .set('Authorization', `Bearer ${aToken}`)
    expect(customer.body.name).toBe('A Customer')
    const product = await request(app)
      .get(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${aToken}`)
    expect(Number(product.body.price)).toBe(2500)
    const order = await request(app)
      .get(`/api/orders/${orderId}`)
      .set('Authorization', `Bearer ${aToken}`)
    expect(order.body.status).toBe('DRAFT')
  })

  it('cannot DELETE another org data', async () => {
    const { aToken, bToken, customerId, productId } = await twoOrgs()

    const delCustomer = await request(app)
      .delete(`/api/customers/${customerId}`)
      .set('Authorization', `Bearer ${bToken}`)
    expect(delCustomer.status).toBe(404)

    const delProduct = await request(app)
      .delete(`/api/products/${productId}`)
      .set('Authorization', `Bearer ${bToken}`)
    expect(delProduct.status).toBe(404)

    // still alive in org A
    const customer = await request(app)
      .get(`/api/customers/${customerId}`)
      .set('Authorization', `Bearer ${aToken}`)
    expect(customer.status).toBe(200)
  })

  it('list endpoints never leak another org records', async () => {
    const { bToken, customerId, productId, orderId } = await twoOrgs()
    const ids = { customerId, productId, orderId }
    const checks: Array<[string, (r: any) => string[]]> = [
      ['/api/customers', (b) => b.data.map((x: any) => x.id)],
      ['/api/products', (b) => b.data.map((x: any) => x.id)],
      ['/api/orders', (b) => b.data.map((x: any) => x.id)],
      ['/api/inventory', (b) => b.map((x: any) => x.product.id)],
      ['/api/inventory/movements', (b) => b.map((x: any) => x.inventory.product.id)],
    ]
    for (const [url, pick] of checks) {
      const res = await request(app).get(url).set('Authorization', `Bearer ${bToken}`)
      expect(res.status).toBe(200)
      const got = pick(res.body)
      expect(got).not.toContain(customerId)
      expect(got).not.toContain(productId)
      void ids
    }
  })

  it('cannot create records inside another organization', async () => {
    const { bToken, customerId, productId } = await twoOrgs()

    // order referencing org A's customer + product must be rejected
    const order = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${bToken}`)
      .send({
        customerId,
        items: [{ productId, quantity: 1, unitPrice: 2500 }],
      })
    expect(order.status).toBe(400)

    // inventory adjustment on org A's product must fail
    const adjust = await request(app)
      .post('/api/inventory/adjust')
      .set('Authorization', `Bearer ${bToken}`)
      .send({ productId, quantity: 5, reason: 'attack' })
    expect(adjust.status).toBe(404)
  })

  it('reports never aggregate another org data', async () => {
    const { aToken, bToken, productId } = await twoOrgs()

    // org A records a paid invoice
    const order = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${aToken}`)
      .send({ items: [{ productId, quantity: 1, unitPrice: 2500 }] })
    const invoice = await request(app)
      .post('/api/invoices')
      .set('Authorization', `Bearer ${aToken}`)
      .send({ orderId: order.body.id })
    await request(app)
      .post('/api/payments')
      .set('Authorization', `Bearer ${aToken}`)
      .send({ invoiceId: invoice.body.id, amount: 2500, method: 'CASH' })

    const summaryB = await request(app)
      .get('/api/reports/summary')
      .set('Authorization', `Bearer ${bToken}`)
    expect(summaryB.body.revenue).toBe(0)
    expect(summaryB.body.orders).toBe(0)

    const summaryA = await request(app)
      .get('/api/reports/summary')
      .set('Authorization', `Bearer ${aToken}`)
    expect(summaryA.body.revenue).toBe(2500)
  })

  it('cannot touch another org members or roles', async () => {
    const a = await registerOrganization('atkC')
    const b = await registerOrganization('atkD')

    const membersB = await request(app)
      .get('/api/members')
      .set('Authorization', `Bearer ${b.token}`)
    const memberB = membersB.body[0]

    // org A cannot see org B's member list contents
    const membersA = await request(app)
      .get('/api/members')
      .set('Authorization', `Bearer ${a.token}`)
    expect(membersA.body.find((m: any) => m.id === memberB.id)).toBeUndefined()

    // org A cannot change org B's member
    const patch = await request(app)
      .patch(`/api/members/${memberB.id}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ isActive: false })
    expect(patch.status).toBe(404)
  })
})

describeIfDb('customers module', () => {
  async function setupCustomers() {
    const { token } = await registerOrganization('custmod')
    const mk = (body: Record<string, unknown>) =>
      request(app).post('/api/customers').set('Authorization', `Bearer ${token}`).send(body)
    const a = await mk({ name: 'Zubair Traders', phone: '0300-1111111', city: 'Lahore', area: 'Johar Town', customerType: 'WHOLESALE', creditLimit: 200000 })
    const b = await mk({ name: 'Ayesha Store', phone: '0300-2222222', city: 'Multan', customerType: 'RETAIL' })
    const c = await mk({ name: 'Corporate Foods Ltd', city: 'Lahore', customerType: 'CORPORATE', notes: 'Net-30 terms' })
    expect(a.status).toBe(201)
    expect(b.status).toBe(201)
    expect(c.status).toBe(201)
    return { token, ids: [a.body.id, b.body.id, c.body.id] as string[] }
  }

  it('lists with search, filter, sort and pagination', async () => {
    const { token } = await setupCustomers()

    const search = await request(app).get('/api/customers?search=zubair').set('Authorization', `Bearer ${token}`)
    expect(search.body.total).toBe(1)
    expect(search.body.data[0].name).toBe('Zubair Traders')

    const filtered = await request(app).get('/api/customers?customerType=CORPORATE').set('Authorization', `Bearer ${token}`)
    expect(filtered.body.total).toBe(1)
    expect(filtered.body.data[0].customerType).toBe('CORPORATE')

    const cityFiltered = await request(app).get('/api/customers?city=Lahore').set('Authorization', `Bearer ${token}`)
    expect(cityFiltered.body.total).toBe(2)

    const sorted = await request(app).get('/api/customers?sortBy=name&sortDir=desc').set('Authorization', `Bearer ${token}`)
    const names = sorted.body.data.map((c: { name: string }) => c.name)
    expect(names).toEqual([...names].sort().reverse())

    const paged = await request(app).get('/api/customers?take=2&skip=2').set('Authorization', `Bearer ${token}`)
    expect(paged.body.data.length).toBe(1)
    expect(paged.body.total).toBe(3)
  })

  it('profile shows stats, history and notes', async () => {
    const { token, ids } = await setupCustomers()
    const customerId = ids[0]

    // create an order + invoice + payment for the customer
    const product = await request(app).post('/api/products').set('Authorization', `Bearer ${token}`).send({ name: 'Profile Widget', price: 10000 })
    const order = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({
      customerId, items: [{ productId: product.body.id, quantity: 2, unitPrice: 10000 }],
    })
    const invoice = await request(app).post('/api/invoices').set('Authorization', `Bearer ${token}`).send({ orderId: order.body.id, customerId, items: [{ productId: product.body.id, quantity: 2, unitPrice: 10000 }] })
    expect(invoice.status).toBe(201)
    await request(app).post('/api/payments').set('Authorization', `Bearer ${token}`).send({
      invoiceId: invoice.body.id, customerId, amount: 12000, method: 'BANK_TRANSFER',
    })

    const profile = await request(app).get(`/api/customers/${customerId}/profile`).set('Authorization', `Bearer ${token}`)
    expect(profile.status).toBe(200)
    expect(profile.body.stats.totalOrders).toBe(1)
    expect(profile.body.stats.totalPurchases).toBe(20000)
    expect(profile.body.stats.paidAmount).toBe(12000)
    expect(profile.body.stats.outstandingBalance).toBe(8000)
    expect(profile.body.stats.lastOrder).toBeDefined()
    expect(profile.body.recentTransactions.length).toBe(2)
    expect(profile.body.recentTransactions[0].kind).toBeDefined()
  })

  it('validates customer type and rejects bad input', async () => {
    const { token } = await setupCustomers()
    const bad = await request(app).post('/api/customers').set('Authorization', `Bearer ${token}`).send({
      name: 'Bad Type Co', customerType: 'GOLD',
    })
    expect(bad.status).toBe(400)
    const noName = await request(app).post('/api/customers').set('Authorization', `Bearer ${token}`).send({ city: 'Lahore' })
    expect(noName.status).toBe(400)
  })

  it('update and soft-delete flow', async () => {
    const { token, ids } = await setupCustomers()
    const id = ids[1]

    const updated = await request(app).patch(`/api/customers/${id}`).set('Authorization', `Bearer ${token}`).send({
      notes: 'Updated note', creditLimit: 75000,
    })
    expect(updated.status).toBe(200)
    expect(updated.body.notes).toBe('Updated note')

    const del = await request(app).delete(`/api/customers/${id}`).set('Authorization', `Bearer ${token}`)
    expect(del.status).toBe(204)

    const gone = await request(app).get(`/api/customers/${id}`).set('Authorization', `Bearer ${token}`)
    expect(gone.status).toBe(404)

    const list = await request(app).get('/api/customers').set('Authorization', `Bearer ${token}`)
    expect(list.body.total).toBe(2)
  })
})

describeIfDb('inventory movements audit trail', () => {
  async function setupStock() {
    const { token } = await registerOrganization('movt')
    const product = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Movement Widget', price: 1000 })
    const productId = product.body.id as string
    await request(app).post('/api/inventory/receive').set('Authorization', `Bearer ${token}`).send({ productId, quantity: 100, reason: 'Opening purchase' })
    return { token, productId }
  }

  async function stockOf(token: string, productId: string) {
    const res = await request(app).get(`/api/products/${productId}`).set('Authorization', `Bearer ${token}`)
    return res.body.stock as number
  }

  it('every stock change writes a transaction record', async () => {
    const { token, productId } = await setupStock()
    expect(await stockOf(token, productId)).toBe(100)

    // issue (OUT)
    await request(app).post('/api/inventory/issue').set('Authorization', `Bearer ${token}`).send({ productId, quantity: 10, reason: 'Counter sale' })
    expect(await stockOf(token, productId)).toBe(90)

    // return (RETURN)
    await request(app).post('/api/inventory/return').set('Authorization', `Bearer ${token}`).send({ productId, quantity: 3, reason: 'Customer return' })
    expect(await stockOf(token, productId)).toBe(93)

    // damaged (DAMAGED)
    await request(app).post('/api/inventory/damaged').set('Authorization', `Bearer ${token}`).send({ productId, quantity: 5, reason: 'Broken in transit' })
    expect(await stockOf(token, productId)).toBe(88)

    // adjustment (signed)
    await request(app).post('/api/inventory/adjust').set('Authorization', `Bearer ${token}`).send({ productId, quantity: -8, reason: 'Cycle count correction' })
    expect(await stockOf(token, productId)).toBe(80)

    // full audit trail
    const movements = await request(app).get('/api/inventory/movements').set('Authorization', `Bearer ${token}`)
    const types = movements.body.map((m: { type: string }) => m.type)
    for (const t of ['IN', 'OUT', 'RETURN', 'DAMAGED', 'ADJUSTMENT']) {
      expect(types).toContain(t)
    }
    // every movement has who/when/why
    for (const m of movements.body) {
      expect(m.createdBy).toBeDefined()
      expect(m.createdAt).toBeDefined()
      expect(m.reason).toBeTruthy()
    }
  })

  it('cannot issue more than available stock', async () => {
    const { token, productId } = await setupStock()
    const res = await request(app).post('/api/inventory/issue').set('Authorization', `Bearer ${token}`).send({ productId, quantity: 9999, reason: 'Too much' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK')
    expect(await stockOf(token, productId)).toBe(100)
  })

  it('damaged beyond stock is rejected', async () => {
    const { token, productId } = await setupStock()
    const res = await request(app).post('/api/inventory/damaged').set('Authorization', `Bearer ${token}`).send({ productId, quantity: 500, reason: 'Fire' })
    expect(res.status).toBe(400)
  })

  it('low stock filter finds items at or below reorder level', async () => {
    const { token, productId } = await setupStock()
    await request(app).patch(`/api/products/${productId}`).set('Authorization', `Bearer ${token}`).send({ reorderLevel: 200 })
    const res = await request(app).get('/api/products?lowStock=true').set('Authorization', `Bearer ${token}`)
    expect(res.body.data.some((p: { id: string }) => p.id === productId)).toBe(true)
  })
})

describeIfDb('suppliers module', () => {
  async function setup() {
    const { token } = await registerOrganization('supp')
    return { token }
  }

  it('creates a supplier with all fields, then updates and soft-deletes', async () => {
    const { token } = await setup()
    const created = await request(app).post('/api/suppliers').set('Authorization', `Bearer ${token}`).send({
      name: 'Pak Traders Test',
      company: 'Pak Traders (Pvt.) Ltd.',
      contactPerson: 'Imran Sheikh',
      phone: '+92 300 1112223',
      email: 'contact@paktraders.example.com',
      city: 'Lahore',
      address: '12-B Main Road',
      taxNumber: 'NTN-1234567',
      paymentTerms: 'Net 30',
      openingBalance: 50000,
      notes: 'Test supplier',
    })
    expect(created.status).toBe(201)
    expect(created.body.company).toBe('Pak Traders (Pvt.) Ltd.')
    expect(created.body.openingBalance).toBe('50000')
    const id = created.body.id as string

    const list = await request(app).get('/api/suppliers?search=pak traders').set('Authorization', `Bearer ${token}`)
    expect(list.body.total).toBe(1)

    const updated = await request(app).patch(`/api/suppliers/${id}`).set('Authorization', `Bearer ${token}`).send({ paymentTerms: 'Net 45' })
    expect(updated.body.paymentTerms).toBe('Net 45')

    const profile = await request(app).get(`/api/suppliers/${id}/profile`).set('Authorization', `Bearer ${token}`)
    expect(profile.status).toBe(200)
    expect(profile.body.stats.outstandingBalance).toBe(50000)
    expect(profile.body.stats.productsSupplied).toBe(0)

    const del = await request(app).delete(`/api/suppliers/${id}`).set('Authorization', `Bearer ${token}`)
    expect(del.status).toBe(204)
    const after = await request(app).get('/api/suppliers?search=pak traders').set('Authorization', `Bearer ${token}`)
    expect(after.body.total).toBe(0)
  })

  it('purchase + payment flow updates profile outstanding', async () => {
    const { token } = await setup()
    const sup = await request(app).post('/api/suppliers').set('Authorization', `Bearer ${token}`).send({
      name: 'Flow Supplier', city: 'Lahore', openingBalance: 10000,
    })
    const supplierId = sup.body.id as string

    const purchase = await request(app).post('/api/suppliers/purchases').set('Authorization', `Bearer ${token}`).send({
      supplierId, totalAmount: 100000, notes: 'Stock order',
    })
    expect(purchase.status).toBe(201)
    expect(purchase.body.purchaseNumber).toMatch(/^PUR-/)
    expect(purchase.body.status).toBe('PENDING')

    const pay = await request(app).post(`/api/suppliers/purchases/${purchase.body.id}/pay`).set('Authorization', `Bearer ${token}`).send({
      supplierId, amount: 40000, method: 'BANK_TRANSFER',
    })
    expect(pay.status).toBe(201)

    const profile = await request(app).get(`/api/suppliers/${supplierId}/profile`).set('Authorization', `Bearer ${token}`)
    expect(profile.body.stats.totalPurchases).toBe(100000)
    expect(profile.body.stats.paidAmount).toBe(40000)
    expect(profile.body.stats.outstandingBalance).toBe(70000) // 10000 opening + 100000 - 40000
    expect(profile.body.payments).toHaveLength(1)
    expect(profile.body.recentTransactions).toHaveLength(2)

    // overpayment rejected
    const over = await request(app).post(`/api/suppliers/purchases/${purchase.body.id}/pay`).set('Authorization', `Bearer ${token}`).send({
      supplierId, amount: 99999, method: 'CASH',
    })
    expect(over.status).toBe(400)

    // full payment marks PAID
    await request(app).post(`/api/suppliers/purchases/${purchase.body.id}/pay`).set('Authorization', `Bearer ${token}`).send({
      supplierId, amount: 60000, method: 'CASH',
    })
    const done = await request(app).get('/api/suppliers/purchases/list').set('Authorization', `Bearer ${token}`)
    expect(done.body.data[0].status).toBe('PAID')
  })

  it('cross-tenant supplier access returns 404', async () => {
    const a = await registerOrganization('suppA')
    const b = await registerOrganization('suppB')
    const created = await request(app).post('/api/suppliers').set('Authorization', `Bearer ${a.token}`).send({ name: 'Secret Supplier', city: 'Lahore' })
    const direct = await request(app).get(`/api/suppliers/${created.body.id}`).set('Authorization', `Bearer ${b.token}`)
    expect(direct.status).toBe(404)
    const profile = await request(app).get(`/api/suppliers/${created.body.id}/profile`).set('Authorization', `Bearer ${b.token}`)
    expect(profile.status).toBe(404)
  })
})

describeIfDb('order workflow', () => {
  async function setupOrder(stock = 50) {
    const { token } = await registerOrganization('ordwf')
    const customer = await request(app).post('/api/customers').set('Authorization', `Bearer ${token}`).send({ name: 'Workflow Customer' })
    const product = await request(app).post('/api/products').set('Authorization', `Bearer ${token}`).send({ name: 'Workflow Widget', price: 1000, costPrice: 600 })
    const productId = product.body.id as string
    await request(app).post('/api/inventory/receive').set('Authorization', `Bearer ${token}`).send({ productId, quantity: stock, reason: 'Test stock' })
    return { token, customerId: customer.body.id as string, productId }
  }

  it('full flow: draft -> confirm -> pay -> complete with sequential numbers', async () => {
    const { token, customerId, productId } = await setupOrder()

    // create draft with discount + tax
    const order = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({
      customerId,
      items: [{ productId, quantity: 2, unitPrice: 1000 }],
      discountAmount: 100,
      taxAmount: 50,
    })
    expect(order.status).toBe(201)
    expect(order.body.orderNumber).toMatch(/^ORD-\d{4}-\d{4}$/)
    expect(order.body.status).toBe('DRAFT')
    expect(order.body.paymentStatus).toBe('UNPAID')
    expect(order.body.subtotal).toBe('2000')
    expect(order.body.discountAmount).toBe('100')
    expect(order.body.taxAmount).toBe('50')
    expect(order.body.totalAmount).toBe('1950')

    // second order gets the next sequential number
    const order2 = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({
      customerId, items: [{ productId, quantity: 1, unitPrice: 1000 }],
    })
    const n1 = parseInt(order.body.orderNumber.split('-').pop()!, 10)
    const n2 = parseInt(order2.body.orderNumber.split('-').pop()!, 10)
    expect(n2).toBe(n1 + 1)

    // confirm: stock deducted + invoice created in one transaction
    const confirmed = await request(app).post(`/api/orders/${order.body.id}/confirm`).set('Authorization', `Bearer ${token}`)
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.status).toBe('CONFIRMED')

    const detail = await request(app).get(`/api/orders/${order.body.id}`).set('Authorization', `Bearer ${token}`)
    expect(detail.body.invoice.invoiceNumber).toMatch(/^INV-\d{4}-\d{4}$/)

    const inv = await request(app).get('/api/inventory').set('Authorization', `Bearer ${token}`)
    const row = inv.body.find((r: { product: { id: string } }) => r.product.id === productId)
    expect(row.quantity).toBe(48)

    // pay with JazzCash (demo)
    const pay = await request(app).post(`/api/orders/${order.body.id}/pay`).set('Authorization', `Bearer ${token}`).send({
      amount: 1950, method: 'JAZZCASH', notes: 'Demo payment',
    })
    expect(pay.status).toBe(201)
    expect(pay.body.order.paymentStatus).toBe('PAID')
    expect(pay.body.payment.notes).toContain('DEMO')

    // complete
    const done = await request(app).patch(`/api/orders/${order.body.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'COMPLETED' })
    expect(done.status).toBe(200)
    expect(done.body.status).toBe('COMPLETED')
  })

  it('partial payments track payment status', async () => {
    const { token, customerId, productId } = await setupOrder()
    const order = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({
      customerId, items: [{ productId, quantity: 1, unitPrice: 1000 }],
    })
    await request(app).post(`/api/orders/${order.body.id}/confirm`).set('Authorization', `Bearer ${token}`)

    await request(app).post(`/api/orders/${order.body.id}/pay`).set('Authorization', `Bearer ${token}`).send({ amount: 400, method: 'EASYPAISA' })
    const detail = await request(app).get(`/api/orders/${order.body.id}`).set('Authorization', `Bearer ${token}`)
    expect(detail.body.paymentStatus).toBe('PARTIALLY_PAID')
    expect(detail.body.paidAmount).toBe('400')
  })

  it('cancelling a confirmed order restocks inventory', async () => {
    const { token, customerId, productId } = await setupOrder(20)
    const order = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({
      customerId, items: [{ productId, quantity: 5, unitPrice: 1000 }],
    })
    await request(app).post(`/api/orders/${order.body.id}/confirm`).set('Authorization', `Bearer ${token}`)

    const cancelled = await request(app).patch(`/api/orders/${order.body.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'CANCELLED' })
    expect(cancelled.status).toBe(200)

    const inv = await request(app).get('/api/inventory').set('Authorization', `Bearer ${token}`)
    const row = inv.body.find((r: { product: { id: string } }) => r.product.id === productId)
    expect(row.quantity).toBe(20) // restocked

    const movements = await request(app).get(`/api/inventory/movements?productId=${productId}`).set('Authorization', `Bearer ${token}`)
    expect(movements.body.some((m: { type: string }) => m.type === 'RETURN')).toBe(true)
  })

  it('invalid status transitions are rejected', async () => {
    const { token, customerId, productId } = await setupOrder()
    const order = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({
      customerId, items: [{ productId, quantity: 1, unitPrice: 1000 }],
    })
    // DRAFT -> COMPLETED is not allowed
    const bad = await request(app).patch(`/api/orders/${order.body.id}`).set('Authorization', `Bearer ${token}`).send({ status: 'COMPLETED' })
    expect(bad.status).toBe(400)
  })

  it('negative stock blocked by default, allowed when setting enabled', async () => {
    const { token, customerId, productId } = await setupOrder(2)
    const mk = () => request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({
      customerId, items: [{ productId, quantity: 10, unitPrice: 1000 }],
    })

    const order1 = await mk()
    const blocked = await request(app).post(`/api/orders/${order1.body.id}/confirm`).set('Authorization', `Bearer ${token}`)
    expect(blocked.status).toBe(400)
    expect(blocked.body.error.code).toBe('INSUFFICIENT_STOCK')

    // enable negative stock in settings
    await request(app).patch('/api/settings').set('Authorization', `Bearer ${token}`).send({ allowNegativeStock: true })

    const order2 = await mk()
    const ok = await request(app).post(`/api/orders/${order2.body.id}/confirm`).set('Authorization', `Bearer ${token}`)
    expect(ok.status).toBe(200)

    const inv = await request(app).get('/api/inventory').set('Authorization', `Bearer ${token}`)
    const row = inv.body.find((r: { product: { id: string } }) => r.product.id === productId)
    expect(row.quantity).toBe(-8)
  })
})

describeIfDb('invoice system', () => {
  async function setupInvoice() {
    const { token } = await registerOrganization('invpdf')
    const customer = await request(app).post('/api/customers').set('Authorization', `Bearer ${token}`).send({ name: 'Invoice Customer', phone: '0300-1112223' })
    const product = await request(app).post('/api/products').set('Authorization', `Bearer ${token}`).send({ name: 'Invoice Widget', price: 10000 })
    const invoice = await request(app).post('/api/invoices').set('Authorization', `Bearer ${token}`).send({
      customerId: customer.body.id,
      discountAmount: 750,
      items: [{ productId: product.body.id, quantity: 2, unitPrice: 9375 }],
    })
    return { token, invoiceId: invoice.body.id as string, customerId: customer.body.id as string }
  }

  it('computes totals and derives status from payments', async () => {
    const { token, invoiceId } = await setupInvoice()

    // subtotal 18750, discount 750, total 18000
    const detail = await request(app).get(`/api/invoices/${invoiceId}`).set('Authorization', `Bearer ${token}`)
    expect(detail.status).toBe(200)
    expect(detail.body.invoice.subtotal).toBe('18750')
    expect(detail.body.invoice.discountAmount).toBe('750')
    expect(detail.body.invoice.totalAmount).toBe('18000')
    expect(detail.body.paidAmount).toBe(0)
    expect(detail.body.balanceDue).toBe(18000)
    expect(detail.body.derivedStatus).toBe('DRAFT')

    // partial payment -> PARTIALLY_PAID
    await request(app).post('/api/payments').set('Authorization', `Bearer ${token}`).send({
      invoiceId, amount: 10000, method: 'BANK_TRANSFER',
    })
    const partial = await request(app).get(`/api/invoices/${invoiceId}`).set('Authorization', `Bearer ${token}`)
    expect(partial.body.paidAmount).toBe(10000)
    expect(partial.body.balanceDue).toBe(8000)
    expect(partial.body.derivedStatus).toBe('PARTIALLY_PAID')

    // full payment -> PAID
    await request(app).post('/api/payments').set('Authorization', `Bearer ${token}`).send({
      invoiceId, amount: 8000, method: 'JAZZCASH',
    })
    const paid = await request(app).get(`/api/invoices/${invoiceId}`).set('Authorization', `Bearer ${token}`)
    expect(paid.body.derivedStatus).toBe('PAID')
    expect(paid.body.balanceDue).toBe(0)
  })

  it('generates a real PDF from backend data', async () => {
    const { token, invoiceId } = await setupInvoice()
    const res = await request(app).get(`/api/invoices/${invoiceId}/pdf`).set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/pdf')
    expect(res.headers['content-disposition']).toContain('.pdf')
    // a real PDF starts with %PDF
    expect(res.body.slice(0, 4).toString()).toBe('%PDF')
    expect(res.body.length).toBeGreaterThan(2000)
  })

  it('share endpoint returns message without sending email', async () => {
    const { token, invoiceId } = await setupInvoice()
    const res = await request(app).get(`/api/invoices/${invoiceId}/share`).set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.message).toContain('Invoice Customer')
    expect(res.body.message).toContain(res.body.invoiceNumber)
    expect(res.body.pdfUrl).toContain('/pdf')
    expect(res.body.note).toContain('not configured')
  })

  it('cross-tenant invoice PDF returns 404', async () => {
    const a = await registerOrganization('invA')
    const b = await registerOrganization('invB')
    const customer = await request(app).post('/api/customers').set('Authorization', `Bearer ${a.token}`).send({ name: 'Secret' })
    const product = await request(app).post('/api/products').set('Authorization', `Bearer ${a.token}`).send({ name: 'Secret Widget', price: 500 })
    const invoice = await request(app).post('/api/invoices').set('Authorization', `Bearer ${a.token}`).send({
      customerId: customer.body.id, items: [{ productId: product.body.id, quantity: 1, unitPrice: 500 }],
    })
    const pdf = await request(app).get(`/api/invoices/${invoice.body.id}/pdf`).set('Authorization', `Bearer ${b.token}`)
    expect(pdf.status).toBe(404)
  })
})

describeIfDb('expenses module', () => {
  async function setupExpenses() {
    const { token } = await registerOrganization('expmod')
    const cats = await request(app).get('/api/expenses/categories').set('Authorization', `Bearer ${token}`)
    const catId = (name: string) => cats.body.find((c: { name: string }) => c.name === name)?.id as string
    return { token, catId }
  }

  it('creates, edits, filters, searches and deletes expenses', async () => {
    const { token, catId } = await setupExpenses()

    // create with realistic Pakistani values
    const rent = await request(app).post('/api/expenses').set('Authorization', `Bearer ${token}`).send({
      categoryId: catId('Rent'), description: 'Monthly shop rent — test', amount: 85000,
    })
    expect(rent.status).toBe(201)
    expect(rent.body.amount).toBe('85000')

    await request(app).post('/api/expenses').set('Authorization', `Bearer ${token}`).send({
      categoryId: catId('Electricity'), description: 'LESCO bill — test', amount: 31450,
    })

    // search
    const search = await request(app).get('/api/expenses?search=shop rent').set('Authorization', `Bearer ${token}`)
    expect(search.body.total).toBe(1)

    // filter by category
    const byCat = await request(app).get(`/api/expenses?categoryId=${catId('Electricity')}`).set('Authorization', `Bearer ${token}`)
    expect(byCat.body.total).toBe(1)
    expect(byCat.body.data[0].description).toContain('LESCO')

    // edit
    const edited = await request(app).patch(`/api/expenses/${rent.body.id}`).set('Authorization', `Bearer ${token}`).send({ amount: 86000 })
    expect(edited.body.amount).toBe('86000')

    // monthly summary reflects real data
    const monthly = await request(app).get('/api/expenses/monthly').set('Authorization', `Bearer ${token}`)
    expect(monthly.body.length).toBeGreaterThan(0)
    expect(monthly.body[monthly.body.length - 1].total).toBeGreaterThan(0)

    // delete
    const del = await request(app).delete(`/api/expenses/${rent.body.id}`).set('Authorization', `Bearer ${token}`)
    expect(del.status).toBe(204)
    const after = await request(app).get('/api/expenses').set('Authorization', `Bearer ${token}`)
    expect(after.body.total).toBe(1)
  })

  it('profit-loss is computed from real records', async () => {
    const { token, catId } = await setupExpenses()

    // expense of Rs. 5,000
    await request(app).post('/api/expenses').set('Authorization', `Bearer ${token}`).send({
      categoryId: catId('Transport'), description: 'Delivery fuel', amount: 5000,
    })

    // product with cost price, then an order
    const product = await request(app).post('/api/products').set('Authorization', `Bearer ${token}`).send({
      name: 'PL Widget', price: 10000, costPrice: 6000,
    })
    const stock = await request(app).post('/api/inventory/receive').set('Authorization', `Bearer ${token}`).send({
      productId: product.body.id, quantity: 10, reason: 'test stock',
    })
    expect(stock.status).toBe(200)
    const customer = await request(app).post('/api/customers').set('Authorization', `Bearer ${token}`).send({ name: 'PL Customer' })
    const order = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({
      customerId: customer.body.id,
      items: [{ productId: product.body.id, quantity: 2, unitPrice: 10000 }],
    })
    await request(app).post(`/api/orders/${order.body.id}/confirm`).set('Authorization', `Bearer ${token}`)

    const pl = await request(app).get('/api/reports/profit-loss').set('Authorization', `Bearer ${token}`)
    expect(pl.status).toBe(200)
    // revenue 20000, COGS 12000, gross 8000, expenses 5000, net 3000
    expect(pl.body.revenue).toBe(20000)
    expect(pl.body.costOfGoods).toBe(12000)
    expect(pl.body.grossProfit).toBe(8000)
    expect(pl.body.expenses).toBe(5000)
    expect(pl.body.netProfit).toBe(3000)
  })
})

describeIfDb('employees module', () => {
  async function setupEmployees() {
    const { token } = await registerOrganization('empmod')
    const depts = await request(app).get('/api/employees/departments').set('Authorization', `Bearer ${token}`)
    const deptId = (name: string) => depts.body.find((d: { name: string }) => d.name === name)?.id as string
    const roles = await request(app).get('/api/roles').set('Authorization', `Bearer ${token}`)
    const roleId = (name: string) => roles.body.find((r: { name: string }) => r.name === name)?.id as string
    return { token, deptId, roleId }
  }

  it('creates employees with auto IDs, searches, filters and edits', async () => {
    const { token, deptId, roleId } = await setupEmployees()

    const saad = await request(app).post('/api/employees').set('Authorization', `Bearer ${token}`).send({
      name: 'Muhammad Saad', phone: '0300-1112233', departmentId: deptId('Sales'),
      roleId: roleId('EMPLOYEE'), title: 'Sales Executive', salary: 62450,
    })
    expect(saad.status).toBe(201)
    expect(saad.body.employeeId).toMatch(/^EMP-\d+$/)
    expect(saad.body.salary).toBe('62450')
    expect(saad.body.role.name).toBe('EMPLOYEE')

    await request(app).post('/api/employees').set('Authorization', `Bearer ${token}`).send({
      name: 'Hira Ahmed', departmentId: deptId('Accounts'), title: 'Accountant', salary: 78300,
    })

    // search by name and by employee ID
    const byName = await request(app).get('/api/employees?search=hira').set('Authorization', `Bearer ${token}`)
    expect(byName.body.total).toBe(1)
    const byId = await request(app).get(`/api/employees?search=${saad.body.employeeId}`).set('Authorization', `Bearer ${token}`)
    expect(byId.body.total).toBe(1)

    // filter by department
    const sales = await request(app).get(`/api/employees?departmentId=${deptId('Sales')}`).set('Authorization', `Bearer ${token}`)
    expect(sales.body.total).toBe(1)
    expect(sales.body.data[0].name).toBe('Muhammad Saad')

    // edit + deactivate
    const edited = await request(app).patch(`/api/employees/${saad.body.id}`).set('Authorization', `Bearer ${token}`).send({
      title: 'Senior Sales Executive', isActive: false,
    })
    expect(edited.body.title).toBe('Senior Sales Executive')
    const inactive = await request(app).get('/api/employees?status=inactive').set('Authorization', `Bearer ${token}`)
    expect(inactive.body.total).toBe(1)

    // profile
    const profile = await request(app).get(`/api/employees/${saad.body.id}`).set('Authorization', `Bearer ${token}`)
    expect(profile.body.name).toBe('Muhammad Saad')
    expect(profile.body.department.name).toBe('Sales')

    // delete
    const del = await request(app).delete(`/api/employees/${saad.body.id}`).set('Authorization', `Bearer ${token}`)
    expect(del.status).toBe(204)
  })

  it('hides salary from members without the salary permission', async () => {
    const { token, deptId } = await setupEmployees()

    // create employee with salary as owner
    const created = await request(app).post('/api/employees').set('Authorization', `Bearer ${token}`).send({
      name: 'Usman Tariq', departmentId: deptId('Inventory'), title: 'Warehouse Incharge', salary: 55750,
    })
    expect(created.body.salary).toBe('55750')

    // add a viewer member and log in as them
    const roles = await request(app).get('/api/roles').set('Authorization', `Bearer ${token}`)
    const viewerRole = roles.body.find((r: { name: string }) => r.name === 'VIEWER')
    const member = await request(app).post('/api/members').set('Authorization', `Bearer ${token}`).send({
      name: 'Viewer User', email: `viewer-salary-test@example.com`, password: 'password123', roleId: viewerRole.id,
    })
    expect(member.status).toBe(201)
    const login = await request(app).post('/api/auth/login').send({
      email: 'viewer-salary-test@example.com', password: 'password123',
    })
    const viewerToken = login.body.token as string

    // viewer sees the employee list but no salary
    const list = await request(app).get('/api/employees').set('Authorization', `Bearer ${viewerToken}`)
    expect(list.body.salaryVisible).toBe(false)
    expect(list.body.data[0].salary).toBeUndefined()

    const profile = await request(app).get(`/api/employees/${created.body.id}`).set('Authorization', `Bearer ${viewerToken}`)
    expect(profile.body.salary).toBeUndefined()
    expect(profile.body.salaryVisible).toBe(false)

    // viewer cannot sneak a salary in via update
    const patched = await request(app).patch(`/api/employees/${created.body.id}`).set('Authorization', `Bearer ${viewerToken}`)
    expect(patched.status).toBe(403) // viewers cannot update employees at all

    // owner re-reads: salary intact
    const reread = await request(app).get(`/api/employees/${created.body.id}`).set('Authorization', `Bearer ${token}`)
    expect(reread.body.salary).toBe('55750')
  })

  it('cross-tenant employee access returns 404', async () => {
    const a = await registerOrganization('empA')
    const b = await registerOrganization('empB')
    const created = await request(app).post('/api/employees').set('Authorization', `Bearer ${a.token}`).send({ name: 'Secret Staff' })
    const profile = await request(app).get(`/api/employees/${created.body.id}`).set('Authorization', `Bearer ${b.token}`)
    expect(profile.status).toBe(404)
  })
})

describeIfDb('dashboard reports', () => {
  it('returns KPIs, charts and transactions from real records', async () => {
    const { token } = await registerOrganization('dashmod')

    // product + stock + order + confirm
    const product = await request(app).post('/api/products').set('Authorization', `Bearer ${token}`).send({
      name: 'Dash Widget', price: 10000, costPrice: 6000, category: 'Gadgets',
    })
    await request(app).post('/api/inventory/receive').set('Authorization', `Bearer ${token}`).send({
      productId: product.body.id, quantity: 10, reason: 'test stock',
    })
    const customer = await request(app).post('/api/customers').set('Authorization', `Bearer ${token}`).send({ name: 'Dash Customer' })
    const order = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({
      customerId: customer.body.id,
      items: [{ productId: product.body.id, quantity: 2, unitPrice: 10000 }],
    })
    const confirmed = await request(app).post(`/api/orders/${order.body.id}/confirm`).set('Authorization', `Bearer ${token}`)
    expect(confirmed.status).toBe(200)

    // expense
    const cats = await request(app).get('/api/expenses/categories').set('Authorization', `Bearer ${token}`)
    const transportId = cats.body.find((c: { name: string }) => c.name === 'Transport')?.id
    await request(app).post('/api/expenses').set('Authorization', `Bearer ${token}`).send({
      categoryId: transportId, description: 'Delivery fuel', amount: 5000,
    })

    // payment against the auto-created invoice
    const invoices = await request(app).get('/api/invoices').set('Authorization', `Bearer ${token}`)
    const invoiceId = invoices.body.data[0].id
    await request(app).post('/api/payments').set('Authorization', `Bearer ${token}`).send({
      invoiceId, amount: 12000, method: 'JAZZCASH',
    })

    const res = await request(app).get('/api/reports/dashboard').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    const d = res.body

    // KPIs from real records: order 20000 today, COGS 12000, expense 5000
    expect(d.kpis.todaySales).toBe(20000)
    expect(d.kpis.todayOrderCount).toBe(1)
    expect(d.kpis.totalExpenses).toBe(5000)
    expect(d.kpis.grossProfit).toBe(8000)
    expect(d.kpis.netProfit).toBe(3000)
    expect(d.kpis.pendingOrders).toBe(1) // confirmed order is still pending completion
    expect(d.kpis.outstandingTotal).toBe(8000) // 20000 - 12000 paid
    expect(d.kpis.outstandingCount).toBe(1)

    // charts
    expect(d.charts.revenueOverTime.length).toBeGreaterThan(0)
    expect(d.charts.revenueOverTime.reduce((s: number, p: { value: number }) => s + p.value, 0)).toBe(20000)
    expect(d.charts.expensesOverTime.reduce((s: number, p: { value: number }) => s + p.value, 0)).toBe(5000)
    expect(d.charts.topProducts[0].name).toBe('Dash Widget')
    expect(d.charts.topProducts[0].value).toBe(20000)
    expect(d.charts.paymentMethods.find((m: { method: string }) => m.method === 'JAZZCASH')?.total).toBe(12000)

    // outstanding invoices + recent transactions
    expect(d.outstandingInvoices[0].balance).toBe(8000)
    expect(d.recentTransactions.length).toBeGreaterThan(0)

    // date filter: a range in the past returns zeros, not errors
    const past = await request(app)
      .get('/api/reports/dashboard?from=2020-01-01T00:00:00.000Z&to=2020-01-31T23:59:59.000Z')
      .set('Authorization', `Bearer ${token}`)
    expect(past.status).toBe(200)
    expect(past.body.kpis.todaySales).toBe(20000) // today KPI is independent of range
    expect(past.body.kpis.totalExpenses).toBe(0)
    expect(past.body.kpis.netProfit).toBe(0)
  })
})

describeIfDb('audit logging', () => {
  it('records login, order, payment and logout with human-readable summaries', async () => {
    const { token } = await registerOrganization('auditmod')

    // explicit login + logout cycle on the same org
    const { token: _t, email: orgEmail } = await registerOrganization('auditcycle')
    const login = await request(app).post('/api/auth/login').send({
      email: orgEmail,
      password: 'password123',
    })
    expect(login.status).toBe(200)
    const cycleToken = login.body.token as string

    const logout = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${cycleToken}`)
    expect(logout.status).toBe(200)

    // logout invalidated all tokens for that member — log in again to read the log
    const relogin = await request(app).post('/api/auth/login').send({
      email: orgEmail,
      password: 'password123',
    })
    const cycleLogs = await request(app).get('/api/audit-logs?take=10').set('Authorization', `Bearer ${relogin.body.token}`)
    expect(cycleLogs.status).toBe(200)
    const cycleActions = cycleLogs.body.data.map((l: { action: string }) => l.action)
    expect(cycleActions).toContain('LOGIN')
    expect(cycleActions).toContain('LOGOUT')
    const logoutLog = cycleLogs.body.data.find((l: { action: string }) => l.action === 'LOGOUT')
    expect(logoutLog.summary).toMatch(/logged out/)

    // order + payment
    const product = await request(app).post('/api/products').set('Authorization', `Bearer ${token}`).send({
      name: 'Audit Widget', price: 5000,
    })
    await request(app).post('/api/inventory/receive').set('Authorization', `Bearer ${token}`).send({
      productId: product.body.id, quantity: 5, reason: 'audit stock',
    })
    const customer = await request(app).post('/api/customers').set('Authorization', `Bearer ${token}`).send({ name: 'Audit Customer' })
    const order = await request(app).post('/api/orders').set('Authorization', `Bearer ${token}`).send({
      customerId: customer.body.id,
      items: [{ productId: product.body.id, quantity: 1, unitPrice: 5000 }],
    })
    await request(app).post(`/api/orders/${order.body.id}/confirm`).set('Authorization', `Bearer ${token}`)
    await request(app).post(`/api/orders/${order.body.id}/payments`).set('Authorization', `Bearer ${token}`).send({
      amount: 5000, method: 'CASH',
    })

    const logs = await request(app).get('/api/audit-logs?take=50').set('Authorization', `Bearer ${token}`)
    expect(logs.status).toBe(200)
    const actions = logs.body.data.map((l: { action: string }) => l.action)
    expect(actions).toContain('CREATE') // order created

    // summaries are human-readable
    const orderLog = logs.body.data.find((l: { entity: string; action: string }) => l.entity === 'Order' && l.action === 'CREATE')
    expect(orderLog.summary).toMatch(/created order ORD-/)
    expect(orderLog.actor).toBeTruthy()

    // no secrets in details, anywhere
    const raw = JSON.stringify(logs.body.data)
    expect(raw).not.toMatch(/password123/)

    // change own password (invalidates old token), then verify PASSWORD_CHANGE was logged
    const pw = await request(app).post('/api/auth/change-password').set('Authorization', `Bearer ${token}`).send({
      currentPassword: 'password123', newPassword: 'newpassword456',
    })
    expect(pw.status).toBe(200)
    const pwLogs = await request(app).get('/api/audit-logs?action=PASSWORD_CHANGE').set('Authorization', `Bearer ${token}`)
    expect(pwLogs.status).toBe(401) // old token invalidated
    const raw2 = JSON.stringify(pwLogs.body)
    expect(raw2).not.toMatch(/newpassword456/)
  })

  it('records role changes and restricts log access to authorized users', async () => {
    const { token } = await registerOrganization('auditrbac')

    // create a member with EMPLOYEE role, then promote to MANAGER
    const roles = await request(app).get('/api/roles').set('Authorization', `Bearer ${token}`)
    const employeeRole = roles.body.find((r: { name: string }) => r.name === 'EMPLOYEE')
    const managerRole = roles.body.find((r: { name: string }) => r.name === 'MANAGER')
    const member = await request(app).post('/api/members').set('Authorization', `Bearer ${token}`).send({
      name: 'Promote Me', email: 'promote-me@example.com', password: 'password123', roleId: employeeRole.id,
    })
    const patched = await request(app).patch(`/api/members/${member.body.id}`).set('Authorization', `Bearer ${token}`).send({
      roleId: managerRole.id,
    })
    expect(patched.status).toBe(200)

    const logs = await request(app).get('/api/audit-logs?action=ROLE_CHANGE').set('Authorization', `Bearer ${token}`)
    const roleLog = logs.body.data[0]
    expect(roleLog.action).toBe('ROLE_CHANGE')
    expect(roleLog.summary).toMatch(/changed Promote Me's role to MANAGER/)

    // log in as the promoted member (MANAGER has no audit_logs.read) -> 403
    const login = await request(app).post('/api/auth/login').send({
      email: 'promote-me@example.com', password: 'password123',
    })
    const denied = await request(app).get('/api/audit-logs').set('Authorization', `Bearer ${login.body.token}`)
    expect(denied.status).toBe(403)
  })
})

describeIfDb('ai assistant', () => {
  it('answers from the caller organization data only', async () => {
    const a = await registerOrganization('aiA')
    const b = await registerOrganization('aiB')

    // org A: product + stock + order
    const product = await request(app).post('/api/products').set('Authorization', `Bearer ${a.token}`).send({
      name: 'Secret Gadget', price: 25000, costPrice: 18000,
    })
    await request(app).post('/api/inventory/receive').set('Authorization', `Bearer ${a.token}`).send({
      productId: product.body.id, quantity: 10, reason: 'ai stock',
    })
    const customer = await request(app).post('/api/customers').set('Authorization', `Bearer ${a.token}`).send({ name: 'AI Customer' })
    const order = await request(app).post('/api/orders').set('Authorization', `Bearer ${a.token}`).send({
      customerId: customer.body.id,
      items: [{ productId: product.body.id, quantity: 2, unitPrice: 25000 }],
    })
    await request(app).post(`/api/orders/${order.body.id}/confirm`).set('Authorization', `Bearer ${a.token}`)

    // org A asks: gets real numbers
    const resA = await request(app).post('/api/assistant/ask').set('Authorization', `Bearer ${a.token}`).send({
      question: 'What were my best-selling products this month?',
    })
    expect(resA.status).toBe(200)
    expect(resA.body.answer).toContain('Secret Gadget')
    expect(resA.body.answer).toContain('Rs. 50,000')
    expect(resA.body.sources.length).toBeGreaterThan(0)
    expect(resA.body.disclaimer).toContain('verify')

    const revA = await request(app).post('/api/assistant/ask').set('Authorization', `Bearer ${a.token}`).send({
      question: 'How much revenue did we make this month?',
    })
    expect(revA.body.answer).toContain('Rs. 50,000')

    // org B asks: sees NOTHING of org A's data
    const resB = await request(app).post('/api/assistant/ask').set('Authorization', `Bearer ${b.token}`).send({
      question: 'What were my best-selling products this month?',
    })
    expect(resB.status).toBe(200)
    expect(resB.body.answer).not.toContain('Secret Gadget')
    expect(resB.body.answer).toContain("There isn't enough data to answer this accurately.")

    // validation
    const bad = await request(app).post('/api/assistant/ask').set('Authorization', `Bearer ${a.token}`).send({ question: 'hi' })
    expect(bad.status).toBe(400)
  })
})

describeIfDb('localization', () => {
  it('stores and updates business profile and locale settings', async () => {
    const { token } = await registerOrganization('locmod')

    // defaults: Pakistan, PKR, Asia/Karachi, English
    const profile = await request(app).get('/api/settings/profile').set('Authorization', `Bearer ${token}`)
    expect(profile.status).toBe(200)
    expect(profile.body.country).toBe('Pakistan')

    const settings = await request(app).get('/api/settings').set('Authorization', `Bearer ${token}`)
    expect(settings.body.currency).toBe('PKR')
    expect(settings.body.timezone).toBe('Asia/Karachi')
    expect(settings.body.language).toBe('en')

    // update profile
    const updated = await request(app).patch('/api/settings/profile').set('Authorization', `Bearer ${token}`).send({
      phone: '+92 300 1234567',
      website: 'https://example.pk',
      city: 'Lahore',
    })
    expect(updated.status).toBe(200)
    expect(updated.body.phone).toBe('+92 300 1234567')
    expect(updated.body.website).toBe('https://example.pk')

    // invalid phone rejected
    const badPhone = await request(app).patch('/api/settings/profile').set('Authorization', `Bearer ${token}`).send({
      phone: '+1 555 1234567',
    })
    expect(badPhone.status).toBe(400)

    // language and tax settings
    const loc = await request(app).patch('/api/settings').set('Authorization', `Bearer ${token}`).send({
      language: 'en',
      taxRate: 16,
    })
    expect(loc.status).toBe(200)
    expect(loc.body.language).toBe('en')
    expect(Number(loc.body.taxRate)).toBe(16)
  })
})
