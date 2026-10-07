import { z } from 'zod'
import { email, optionalPkrAmount, pakistaniPhone, pkrAmount } from './common'

// ─── Departments ───
export const createDepartmentSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(255).optional(),
})

// ─── Employees ───
export const createEmployeeSchema = z.object({
  name: z.string().min(2).max(120),
  email,
  phone: pakistaniPhone,
  departmentId: z.string().optional(),
  roleId: z.string().optional(),
  title: z.string().max(80).optional(),
  salary: optionalPkrAmount,
  hireDate: z.coerce.date().optional(),
  isActive: z.boolean().optional(),
})

// ─── Customers ───
export const customerTypeSchema = z.enum(['RETAIL', 'WHOLESALE', 'CORPORATE'])

export const createCustomerSchema = z.object({
  name: z.string().min(2).max(120),
  email,
  phone: pakistaniPhone,
  address: z.string().max(255).optional(),
  area: z.string().max(120).optional(),
  city: z.string().max(60).optional(),
  province: z.string().max(60).optional(),
  customerType: customerTypeSchema.optional(),
  creditLimit: optionalPkrAmount,
  openingBalance: optionalPkrAmount,
  notes: z.string().max(2000).optional(),
})

// Demo payment methods (Pakistan) — no real payment accounts connected.
export const paymentMethodSchema = z.enum([
  'CASH',
  'BANK_TRANSFER',
  'JAZZCASH',
  'EASYPAISA',
  'CARD',
  'OTHER',
])

// ─── Suppliers ───
export const createSupplierSchema = z.object({
  name: z.string().min(2).max(120),
  company: z.string().max(160).optional(),
  contactPerson: z.string().max(120).optional(),
  email,
  phone: pakistaniPhone,
  address: z.string().max(255).optional(),
  city: z.string().max(60).optional(),
  province: z.string().max(60).optional(),
  taxNumber: z.string().max(40).optional(),
  paymentTerms: z.string().max(120).optional(),
  openingBalance: optionalPkrAmount,
  notes: z.string().max(1000).optional(),
  isActive: z.boolean().optional(),
})

export const createPurchaseSchema = z.object({
  supplierId: z.string().optional(),
  purchaseDate: z.coerce.date().optional(),
  totalAmount: pkrAmount,
  notes: z.string().max(500).optional(),
})

export const createSupplierPaymentSchema = z.object({
  supplierId: z.string().min(1, 'Supplier is required'),
  purchaseId: z.string().optional(),
  amount: pkrAmount,
  method: paymentMethodSchema.default('CASH'),
  paymentDate: z.coerce.date().optional(),
  notes: z.string().max(500).optional(),
})

// ─── Product categories ───
export const createProductCategorySchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(255).optional(),
})

// ─── Products (catalog only — stock lives in Inventory) ───
export const productStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'DISCONTINUED'])

export const createProductSchema = z.object({
  name: z.string().min(2).max(160),
  sku: z.string().max(60).optional(),
  brand: z.string().max(80).optional(),
  description: z.string().max(1000).optional(),
  categoryId: z.string().optional(),
  supplierId: z.string().optional(),
  unit: z.string().max(20).optional(),
  price: pkrAmount,
  costPrice: optionalPkrAmount,
  wholesalePrice: optionalPkrAmount,
  taxPercentage: z.number().min(0).max(100).optional(),
  status: productStatusSchema.optional(),
  reorderLevel: z.number().int().min(0).max(1000000).optional(),
  location: z.string().max(120).optional(),
})

// ─── Orders ───
const orderItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive('Quantity must be at least 1'),
  unitPrice: pkrAmount,
})

export const createOrderSchema = z.object({
  customerId: z.string().optional(),
  items: z.array(orderItemSchema).min(1, 'An order needs at least one item'),
  discountAmount: optionalPkrAmount,
  taxAmount: optionalPkrAmount,
})

export const updateOrderSchema = z.object({
  status: z.enum(['DRAFT', 'CONFIRMED', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'RETURNED']),
})

export const createOrderPaymentSchema = z.object({
  orderId: z.string().optional(),
  invoiceId: z.string().optional(),
  customerId: z.string().optional(),
  amount: pkrAmount,
  method: paymentMethodSchema.default('CASH'),
  paymentDate: z.coerce.date().optional(),
  notes: z.string().max(500).optional(),
})

// ─── Invoices ───
export const createInvoiceSchema = z.object({
  orderId: z.string().optional(),
  customerId: z.string().min(1, 'Customer is required'),
  dueDate: z.coerce.date().optional(),
  discountAmount: optionalPkrAmount,
  taxAmount: optionalPkrAmount,
  notes: z.string().max(1000).optional(),
  items: z.array(orderItemSchema).min(1, 'An invoice needs at least one item'),
})

export const updateInvoiceSchema = z.object({
  status: z.enum(['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED']),
  dueDate: z.coerce.date().optional(),
})

// ─── Expense categories / expenses ───
export const createExpenseCategorySchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(255).optional(),
})

export const createExpenseSchema = z.object({
  categoryId: z.string().optional(),
  description: z.string().max(500).optional(),
  amount: pkrAmount,
  expenseDate: z.coerce.date().optional(),
})

// ─── Payments ───
export const createPaymentSchema = z.object({
  orderId: z.string().optional(),
  invoiceId: z.string().optional(),
  customerId: z.string().optional(),
  amount: pkrAmount,
  method: paymentMethodSchema.default('CASH'),
  paymentDate: z.coerce.date().optional(),
  notes: z.string().max(500).optional(),
})

// ─── Inventory ───
export const adjustStockSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().refine((n) => n !== 0, 'Quantity cannot be zero'),
  reason: z.string().min(2).max(255),
  location: z.string().max(80).optional(),
})

export const updateInventorySchema = z.object({
  reorderLevel: z.number().int().min(0).optional(),
  location: z.string().max(80).optional(),
})

// ─── Settings ───
export const updateSettingsSchema = z.object({
  currency: z.string().length(3).optional(),
  timezone: z.string().max(60).optional(),
  language: z.enum(['en', 'ur']).optional(),
  taxRate: z.number().min(0).max(100).optional(),
  invoicePrefix: z.string().min(1).max(10).optional(),
  orderPrefix: z.string().min(1).max(10).optional(),
  lowStockThreshold: z.number().int().min(0).optional(),
  allowNegativeStock: z.boolean().optional(),
})

// ─── Business profile (Organization) ───
export const updateOrganizationSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  address: z.string().max(300).optional(),
  city: z.string().max(100).optional(),
  province: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  phone: pakistaniPhone,
  email,
  website: z.string().url('Enter a valid website URL').max(200).optional().or(z.literal('')),
})
