import { describe, expect, it } from 'vitest'
import { loginSchema, registerSchema } from '../src/schemas/auth'
import { createOrderSchema, createProductSchema } from '../src/schemas/entities'
import { pakistaniPhone } from '../src/schemas/common'

// Pure validation tests — no database needed.

describe('pakistaniPhone', () => {
  it.each(['+92 300 1234567', '0300-1234567', '03001234567', '+923001234567', '0300 1234567'])(
    'accepts %s',
    (n) => {
      expect(pakistaniPhone.parse(n)).toBe(n)
    },
  )
  it.each(['12345', '0300-12345', '9999999999', ''])('rejects %s', (n) => {
    expect(() => pakistaniPhone.parse(n)).toThrow()
  })
})

describe('registerSchema', () => {
  const valid = {
    organization: { name: 'Test Traders', city: 'Lahore', province: 'Punjab' },
    user: { name: 'Ali Raza', email: 'ali@example.com', password: 'password123' },
  }
  it('accepts a valid payload', () => {
    expect(registerSchema.parse(valid)).toBeTruthy()
  })
  it('rejects short passwords', () => {
    expect(() =>
      registerSchema.parse({ ...valid, user: { ...valid.user, password: 'short' } }),
    ).toThrow()
  })
  it('rejects bad emails', () => {
    expect(() =>
      registerSchema.parse({ ...valid, user: { ...valid.user, email: 'not-an-email' } }),
    ).toThrow()
  })
})

describe('loginSchema', () => {
  it('requires both fields', () => {
    expect(() => loginSchema.parse({ email: 'a@b.com' })).toThrow()
    expect(() => loginSchema.parse({ password: 'x' })).toThrow()
  })
})

describe('createProductSchema', () => {
  const valid = { name: 'Test Fan', price: 5000 }
  it('accepts a valid product', () => {
    expect(createProductSchema.parse(valid).name).toBe('Test Fan')
  })
  it('rejects negative prices', () => {
    expect(() => createProductSchema.parse({ ...valid, price: -100 })).toThrow()
  })
  it('rejects a missing name', () => {
    expect(() => createProductSchema.parse({ price: 5000 })).toThrow()
  })
})

describe('createOrderSchema', () => {
  it('requires at least one item', () => {
    expect(() => createOrderSchema.parse({ items: [] })).toThrow()
  })
  it('rejects zero quantities', () => {
    expect(() =>
      createOrderSchema.parse({
        items: [{ productId: 'x', quantity: 0, unitPrice: 100 }],
      }),
    ).toThrow()
  })
})
