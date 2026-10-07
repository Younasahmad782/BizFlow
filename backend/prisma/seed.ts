/**
 * BIZFLOW seed — 100% FICTIONAL Pakistani demo data.
 * All names are invented, emails use @example.com, phones use the
 * obviously-fake 0300-00000xx range. Never real PII.
 *
 * Run: npm run prisma:seed
 */
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import {
  createSystemRoles,
  ensureGlobalPermissions,
} from '../src/auth/permissions'

const prisma = new PrismaClient()

let phoneIdx = 0
const phone = () => `0300-00000${String(21 + (phoneIdx++ % 60)).padStart(2, '0')}`
const emailOf = (name: string) =>
  `${name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@example.com`

interface ProductDef {
  name: string
  sku: string
  category: string
  brand?: string
  unit?: string
  price: number
  costPrice: number
  wholesalePrice?: number
  taxPercentage?: number
  stock: number
  reorderLevel: number
}

interface SupplierDef {
  name: string
  company?: string
  contactPerson?: string
  paymentTerms?: string
  openingBalance?: number
  notes?: string
}

interface OrgDef {
  name: string
  city: string
  suppliers: SupplierDef[]
  province: string
  category: string
  ownerName: string
  customers: string[]
  products: ProductDef[]
}

const ORGS: OrgDef[] = [
  {
    name: 'Al-Noor General Store',
    city: 'Lahore',
    province: 'Punjab',
    suppliers: [
      { name: 'Pak Traders', company: 'Pak Traders (Pvt.) Ltd.', contactPerson: 'Imran Sheikh', paymentTerms: 'Net 30', openingBalance: 45000, notes: 'Main grocery wholesaler — reliable on rice and oil.' },
      { name: 'Ravi Wholesale Mart', company: 'Ravi Wholesale Mart', contactPerson: 'Nadeem Akhtar', paymentTerms: 'Net 15', notes: 'Backup supplier for personal care items.' },
    ],
    category: 'Grocery Retail',
    ownerName: 'Muhammad Hamza',
    customers: ['Ayesha Malik', 'Usman Raza', 'Hassan Ali', 'Fatima Noor', 'Bilal Ahmed'],
    products: [
      { name: 'Basmati Rice 5kg', sku: 'AN-RICE-5KG', category: 'Grocery', brand: 'Falak', unit: 'pack', price: 1795, costPrice: 1620, wholesalePrice: 1705, stock: 120, reorderLevel: 20 },
      { name: 'Cooking Oil 5L', sku: 'AN-OIL-5L', category: 'Grocery', brand: 'Dalda', unit: 'bottle', price: 4249, costPrice: 3985, wholesalePrice: 4110, stock: 90, reorderLevel: 15 },
      { name: 'Detergent Powder 1kg', sku: 'AN-DET-1KG', category: 'Personal Care', brand: 'Surf Excel', unit: 'pack', price: 1745, costPrice: 1590, wholesalePrice: 1665, stock: 150, reorderLevel: 25 },
      { name: 'Tea 950g', sku: 'AN-TEA-950', category: 'Grocery', brand: 'Lipton', unit: 'pack', price: 2879, costPrice: 2650, wholesalePrice: 2760, stock: 110, reorderLevel: 20 },
      { name: 'Sugar 1kg', sku: 'AN-SUG-1KG', category: 'Grocery', unit: 'kg', price: 685, costPrice: 622, wholesalePrice: 655, stock: 200, reorderLevel: 30 },
      { name: 'LED Bulb 12W', sku: 'AN-LED-12W', category: 'Electronics', brand: 'Philips', unit: 'pcs', price: 399, costPrice: 285, wholesalePrice: 340, stock: 180, reorderLevel: 30 },
    ]
  },
  {
    name: 'Raza Mobile & Electronics',
    city: 'Multan',
    province: 'Punjab',
    suppliers: [
      { name: 'Saeed Wholesale Mart', company: 'Saeed Wholesale Mart', contactPerson: 'Saeed Ahmed', paymentTerms: 'Net 30', openingBalance: 120000, notes: 'Primary mobile accessories distributor.' },
      { name: 'Chenab Electronics Supply', company: 'Chenab Electronics Supply Co.', contactPerson: 'Faisal Raza', paymentTerms: 'Advance', notes: 'Electronics — advance payment only.' },
    ],
    category: 'Electronics Retail',
    ownerName: 'Usman Raza',
    customers: ['Zainab Tariq', 'Abdullah Khan', 'Muhammad Hamza', 'Fatima Noor'],
    products: [
      { name: 'Mobile Charger', sku: 'RM-CHG-01', category: 'Accessories', price: 1299, costPrice: 940, stock: 85, reorderLevel: 15 },
      { name: 'USB-C Fast Charging Cable', sku: 'RM-USBC-01', category: 'Mobile Accessories', brand: 'Anker', unit: 'pcs', price: 699, costPrice: 420, wholesalePrice: 560, stock: 120, reorderLevel: 20 },
      { name: 'Bluetooth Speaker', sku: 'RM-SPK-01', category: 'Electronics', brand: 'Audionic', unit: 'pcs', price: 3299, costPrice: 2480, wholesalePrice: 2890, stock: 40, reorderLevel: 8 },
      { name: 'LED Bulb 12W', sku: 'RM-LED-12W', category: 'Electrical', price: 640, costPrice: 470, stock: 200, reorderLevel: 30 },
      { name: 'Ceiling Fan', sku: 'RM-FAN-01', category: 'Electrical', price: 12499, costPrice: 10800, stock: 25, reorderLevel: 5 },
    ],
  },
  {
    name: 'Green Valley Pharmacy',
    city: 'Faisalabad',
    province: 'Punjab',
    suppliers: [
      { name: 'Punjab Stationers', company: 'Punjab Stationers & General Store', contactPerson: 'Tariq Mahmood', paymentTerms: 'Net 30', notes: 'Stationery and general supplies.' },
      { name: 'Lyallpur Pharma Supply', company: 'Lyallpur Pharma Supply (Pvt.) Ltd.', contactPerson: 'Dr. Sana Iqbal', paymentTerms: 'Net 45', openingBalance: 80000, notes: 'Licensed pharma distributor.' },
    ],
    category: 'Pharmacy',
    ownerName: 'Ayesha Malik',
    customers: ['Hassan Ali', 'Bilal Ahmed', 'Zainab Tariq', 'Usman Raza'],
    products: [
      { name: 'Digital Thermometer', sku: 'GV-THM-01', category: 'Medical Devices', price: 1150, costPrice: 820, stock: 60, reorderLevel: 10 },
      { name: 'Dettol Antiseptic 1L', sku: 'GV-DTL-1L', category: 'Healthcare', price: 1280, costPrice: 1040, stock: 90, reorderLevel: 15 },
      { name: 'Surgical Gloves (Box of 100)', sku: 'GV-GLV-100', category: 'Healthcare', price: 1450, costPrice: 1180, stock: 70, reorderLevel: 12 },
      { name: 'Bandage Roll Pack', sku: 'GV-BND-01', category: 'Healthcare', price: 380, costPrice: 290, stock: 150, reorderLevel: 25 },
      { name: 'Mineral Water 1.5L', sku: 'GV-WTR-15L', category: 'Beverages', price: 175, costPrice: 140, stock: 120, reorderLevel: 20 },
    ],
  },
  {
    name: 'Punjab Home Appliances',
    city: 'Rawalpindi',
    province: 'Punjab',
    suppliers: [
      { name: 'City Electronics Supply', company: 'City Electronics Supply', contactPerson: 'Khalid Mehmood', paymentTerms: 'Net 30', openingBalance: 200000, notes: 'Main appliances supplier.' },
      { name: 'Margalla Appliances Co.', company: 'Margalla Appliances Co.', contactPerson: 'Asad Khan', paymentTerms: 'Net 30', notes: 'Fans and small appliances.' },
    ],
    category: 'Appliances Retail',
    ownerName: 'Hassan Ali',
    customers: ['Abdullah Khan', 'Fatima Noor', 'Bilal Ahmed', 'Muhammad Hamza'],
    products: [
      { name: 'Ceiling Fan', sku: 'PH-FAN-01', category: 'Appliances', price: 12499, costPrice: 10800, stock: 35, reorderLevel: 6 },
      { name: 'LED Bulb 12W (Pack of 4)', sku: 'PH-LED-4PK', category: 'Electrical', price: 2399, costPrice: 1890, stock: 90, reorderLevel: 15 },
      { name: 'Electric Iron', sku: 'PH-IRN-01', category: 'Appliances', price: 3850, costPrice: 3120, stock: 45, reorderLevel: 8 },
      { name: 'Room Cooler', sku: 'PH-CLR-01', category: 'Appliances', price: 24500, costPrice: 21400, stock: 12, reorderLevel: 3 },
    ],
  },
  {
    name: 'Royal Bakers & Sweets',
    city: 'Bahawalpur',
    province: 'Punjab',
    suppliers: [
      { name: 'Bahawalpur Dairy Supply', company: 'Bahawalpur Dairy Supply', contactPerson: 'Rashid Ali', paymentTerms: 'Weekly', openingBalance: 30000, notes: 'Daily milk and dairy delivery.' },
      { name: 'Desert Sweets Traders', company: 'Desert Sweets Traders', contactPerson: 'Haji Yousuf', paymentTerms: 'Net 15', notes: 'Ghee, sugar and dry goods.' },
    ],
    category: 'Bakery',
    ownerName: 'Fatima Noor',
    customers: ['Usman Raza', 'Zainab Tariq', 'Hassan Ali', 'Ayesha Malik'],
    products: [
      { name: 'Desi Ghee 1kg', sku: 'RB-GHE-1KG', category: 'Dairy', price: 2950, costPrice: 2640, stock: 60, reorderLevel: 10 },
      { name: 'Fresh Milk 1L', sku: 'RB-MLK-1L', category: 'Dairy', price: 340, costPrice: 290, stock: 200, reorderLevel: 40 },
      { name: 'Cake Rusk Pack', sku: 'RB-RSK-01', category: 'Bakery', price: 780, costPrice: 610, stock: 150, reorderLevel: 25 },
      { name: 'Sugar 1kg', sku: 'RB-SUG-1KG', category: 'Grocery', price: 685, costPrice: 620, stock: 180, reorderLevel: 30 },
      { name: 'Plain Cake 1lb', sku: 'RB-CK-1LB', category: 'Bakery', price: 1250, costPrice: 940, stock: 50, reorderLevel: 10 },
    ],
  },
  {
    name: 'Sialkot Sports Traders',
    city: 'Sialkot',
    province: 'Punjab',
    suppliers: [
      { name: 'Sialkot Sports Supply', company: 'Sialkot Sports Supply Co.', contactPerson: 'Javed Iqbal', paymentTerms: 'Net 30', openingBalance: 150000, notes: 'Main sports goods supplier.' },
      { name: 'Chenab Sports Goods', company: 'Chenab Sports Goods', contactPerson: 'Arif Hussain', paymentTerms: 'Net 30', notes: 'Cricket equipment specialist.' },
    ],
    category: 'Sports Wholesale',
    ownerName: 'Bilal Ahmed',
    customers: ['Abdullah Khan', 'Muhammad Hamza', 'Usman Raza', 'Zainab Tariq'],
    products: [
      { name: 'Cricket Bat', sku: 'SS-BAT-01', category: 'Sports', brand: 'CA Sports', unit: 'pcs', price: 4650, costPrice: 3750, wholesalePrice: 4200, stock: 55, reorderLevel: 10 },
      { name: 'Football', sku: 'SS-FBL-01', category: 'Football', price: 2350, costPrice: 1790, stock: 70, reorderLevel: 12 },
      { name: 'Cricket Ball (Pack of 6)', sku: 'SS-BAL-6PK', category: 'Cricket', price: 1120, costPrice: 840, stock: 110, reorderLevel: 20 },
      { name: 'Badminton Racket', sku: 'SS-BDM-01', category: 'Badminton', price: 2899, costPrice: 2240, stock: 45, reorderLevel: 8 },
      { name: 'Sports Kit Bag', sku: 'SS-BAG-01', category: 'Accessories', price: 1999, costPrice: 1520, stock: 65, reorderLevel: 10 },
    ],
  },
]

const UTILITY_BILL: Record<string, string> = {
  Lahore: 'LESCO electricity bill',
  Multan: 'MEPCO electricity bill',
  Faisalabad: 'FESCO electricity bill',
  Rawalpindi: 'IESCO electricity bill',
  Bahawalpur: 'MEPCO electricity bill',
  Sialkot: 'GEPCO electricity bill',
}

async function seedOrg(def: OrgDef, idx: number) {
  const passwordHash = await bcrypt.hash('password123', 12)

  const organization = await prisma.organization.create({
    data: {
      name: def.name,
      email: emailOf(def.name),
      phone: phone(),
      address: `Main Bazaar Road, ${def.city}`,
      city: def.city,
      province: def.province,
      country: 'Pakistan',
      category: def.category,
    },
  })
  await prisma.businessSetting.create({ data: { organizationId: organization.id } })

  await ensureGlobalPermissions(prisma)
  const roleIds = await createSystemRoles(prisma, organization.id)

  // Default expense categories (same as self-registration)
  for (const name of [
    'Rent', 'Electricity', 'Internet', 'Transport', 'Salaries',
    'Office Supplies', 'Maintenance', 'Marketing', 'Utilities',
    'Purchases', 'Other',
  ]) {
    await prisma.expenseCategory.create({
      data: { organizationId: organization.id, name },
    })
  }

  const ownerUser = await prisma.user.create({
    data: {
      name: def.ownerName,
      email: `owner.${idx}@example.com`,
      passwordHash,
    },
  })
  const owner = await prisma.organizationMember.create({
    data: {
      userId: ownerUser.id,
      organizationId: organization.id,
      roleId: roleIds.get('OWNER')!,
    },
  })
  const managerUser = await prisma.user.create({
    data: {
      name: `Manager ${def.ownerName.split(' ')[0]}`,
      email: `manager.${idx}@example.com`,
      passwordHash,
    },
  })
  await prisma.organizationMember.create({
    data: {
      userId: managerUser.id,
      organizationId: organization.id,
      roleId: roleIds.get('MANAGER')!,
    },
  })

  // Departments
  const deptNames = ['Sales', 'Accounts', 'Inventory', 'Operations', 'Administration', 'Management']
  const deptIds: Record<string, string> = {}
  for (const name of deptNames) {
    const d = await prisma.department.create({
      data: { organizationId: organization.id, name },
    })
    deptIds[name] = d.id
  }

  // Employees — fictional Pakistani staff (EMP-1042+)
  const staff: [string, string, string, string, number, number, string?][] = [
    // [name, employeeId, department, title, salary, daysAgoJoined, roleName]
    ['Muhammad Saad', 'EMP-1042', 'Sales', 'Sales Executive', 62450, 410, 'EMPLOYEE'],
    ['Hira Ahmed', 'EMP-1043', 'Accounts', 'Accountant', 78300, 520, 'MANAGER'],
    ['Usman Tariq', 'EMP-1044', 'Inventory', 'Warehouse Incharge', 55750, 300],
    ['Bilal Raza', 'EMP-1045', 'Operations', 'Delivery Coordinator', 48900, 210],
    ['Ayesha Khan', 'EMP-1046', 'Sales', 'Senior Sales Executive', 71200, 640, 'EMPLOYEE'],
    ['Faisal Mehmood', 'EMP-1047', 'Administration', 'Office Assistant', 42350, 150],
  ]
  for (const [name, empId, dept, title, salary, ago, roleName] of staff) {
    const role = roleName
      ? await prisma.role.findFirst({ where: { organizationId: organization.id, name: roleName } })
      : null
    await prisma.employee.create({
      data: {
        organizationId: organization.id,
        employeeId: empId,
        departmentId: deptIds[dept],
        roleId: role?.id,
        name,
        email: emailOf(name),
        phone: phone(),
        title,
        salary,
        hireDate: new Date(Date.now() - ago * 86400000),
        isActive: true,
      },
    })
  }

  // Customers — realistic fictional Pakistani customer profiles
  const customerAreas = [
    'Johar Town', 'Gulberg III', 'Saddar', 'Cantt', 'Satellite Town',
    'Shah Alam Market', 'University Road', 'Model Town', 'DHA Phase 4', 'Anarkali',
  ]
  const customerTypes = ['RETAIL', 'WHOLESALE', 'CORPORATE', 'RETAIL', 'RETAIL'] as const
  const customerNotes = [
    'Prefers delivery after 6pm. Pays on time.',
    'Monthly bulk buyer — offer 2% volume discount.',
    'New customer. Verify CNIC before credit.',
    'Long-standing customer. Priority support.',
    'Seasonal buyer — stock up before Eid.',
  ]
  const customerIds: string[] = []
  for (let ci = 0; ci < def.customers.length; ci++) {
    const name = def.customers[ci]
    const type = customerTypes[ci % customerTypes.length]
    const c = await prisma.customer.create({
      data: {
        organizationId: organization.id,
        name,
        email: emailOf(`${name} ${idx}`),
        phone: phone(),
        address: `${10 + ci * 7}-${['A', 'B', 'C'][ci % 3]} Main Boulevard`,
        area: customerAreas[(ci + idx) % customerAreas.length],
        city: def.city,
        province: def.province,
        customerType: type,
        creditLimit: type === 'WHOLESALE' ? 500000 : type === 'CORPORATE' ? 1000000 : 50000,
        openingBalance: ci === 0 ? 15000 : 0,
        notes: customerNotes[ci % customerNotes.length],
      },
    })
    customerIds[ci] = c.id
  }

  // Suppliers (fictional — demo data only)
  const supplierRecs: { id: string; name: string }[] = []
  for (const sd of def.suppliers) {
    const sup = await prisma.supplier.create({
      data: {
        organizationId: organization.id,
        name: sd.name,
        company: sd.company,
        contactPerson: sd.contactPerson,
        email: emailOf(sd.name),
        phone: phone(),
        address: `${10 + supplierRecs.length * 7}-B Main Road`,
        city: def.city,
        province: def.province,
        taxNumber: `NTN-${1000000 + supplierRecs.length * 111111}`,
        paymentTerms: sd.paymentTerms ?? 'Net 30',
        openingBalance: sd.openingBalance ?? 0,
        notes: sd.notes,
      },
    })
    supplierRecs.push({ id: sup.id, name: sup.name })
  }

  // Product categories + products + inventory
  const categoryIds = new Map<string, string>()
  const productRecs: { id: string; price: number; name: string }[] = []
  for (const p of def.products) {
    let categoryId = categoryIds.get(p.category)
    if (!categoryId) {
      const cat = await prisma.productCategory.create({
        data: { organizationId: organization.id, name: p.category },
      })
      categoryId = cat.id
      categoryIds.set(p.category, categoryId)
    }
    const product = await prisma.product.create({
      data: {
        organizationId: organization.id,
        categoryId,
        supplierId: supplierRecs[productRecs.length % supplierRecs.length].id,
        name: p.name,
        sku: p.sku,
        brand: p.brand,
        unit: p.unit ?? 'pcs',
        price: p.price,
        costPrice: p.costPrice,
        wholesalePrice: p.wholesalePrice,
        taxPercentage: p.taxPercentage,
      },
    })
    const inventory = await prisma.inventory.create({
      data: {
        organizationId: organization.id,
        productId: product.id,
        quantity: 0,
        reorderLevel: p.reorderLevel,
        location: 'Main Warehouse',
      },
    })
    await prisma.inventoryTransaction.create({
      data: {
        organizationId: organization.id,
        inventoryId: inventory.id,
        type: 'IN',
        quantity: p.stock,
        reason: 'Opening stock',
        createdById: owner.id,
      },
    })
    await prisma.inventory.update({
      where: { id: inventory.id },
      data: { quantity: p.stock },
    })
    productRecs.push({ id: product.id, price: p.price, name: p.name })
  }

  // Supplier purchases + payments (profile data)
  const purchaseAmounts = [185000, 95000, 240000, 60000]
  for (let si = 0; si < supplierRecs.length; si++) {
    const sup = supplierRecs[si]
    const total = purchaseAmounts[(si + supplierRecs.length) % purchaseAmounts.length]
    const purchase = await prisma.purchase.create({
      data: {
        organizationId: organization.id,
        supplierId: sup.id,
        purchaseNumber: `PUR-${new Date().getFullYear()}-${String(si + 1).padStart(4, '0')}`,
        purchaseDate: new Date(Date.now() - (12 - si * 3) * 86400000),
        totalAmount: total,
        paidAmount: si === 0 ? total : Math.floor(total * 0.6),
        status: si === 0 ? 'PAID' : 'PARTIAL',
        notes: `Stock replenishment from ${sup.name}`,
      },
    })
    if (si !== 0) {
      await prisma.supplierPayment.create({
        data: {
          organizationId: organization.id,
          supplierId: sup.id,
          purchaseId: purchase.id,
          amount: Math.floor(total * 0.6),
          method: 'BANK_TRANSFER',
          paymentDate: new Date(Date.now() - 5 * 86400000),
          notes: `Part payment to ${sup.name}`,
          createdById: owner.id,
        },
      })
    } else {
      await prisma.supplierPayment.create({
        data: {
          organizationId: organization.id,
          supplierId: sup.id,
          purchaseId: purchase.id,
          amount: total,
          method: 'BANK_TRANSFER',
          paymentDate: new Date(Date.now() - 10 * 86400000),
          notes: `Full payment to ${sup.name}`,
          createdById: owner.id,
        },
      })
    }
  }

  // Orders with history: DELIVERED (stock out), CONFIRMED, PENDING
  const statuses = ['COMPLETED', 'CONFIRMED', 'DRAFT'] as const
  for (let o = 0; o < 3; o++) {
    const prod = productRecs[o % productRecs.length]
    const qty = 1 + (o % 3)
    const total = qty * prod.price
    const order = await prisma.order.create({
      data: {
        organizationId: organization.id,
        orderNumber: `ORD-2026-${String(idx * 10 + o + 1).padStart(4, '0')}`,
        customerId: customerIds[o % customerIds.length],
        status: statuses[o],
        subtotal: total,
        totalAmount: total,
        orderDate: new Date(Date.now() - [2, 6, 11][o] * 86400000 - (idx * 7 + o * 3) * 3600000),
        items: {
          create: [{ productId: prod.id, quantity: qty, unitPrice: prod.price }],
        },
      },
    })
    if (statuses[o] === 'COMPLETED') {
      const inv = await prisma.inventory.findUnique({ where: { productId: prod.id } })
      if (inv) {
        await prisma.inventoryTransaction.create({
          data: {
            organizationId: organization.id,
            inventoryId: inv.id,
            type: 'OUT',
            quantity: qty,
            reason: `Order ${order.id} delivered`,
            reference: order.id,
            createdById: owner.id,
          },
        })
        await prisma.inventory.update({
          where: { id: inv.id },
          data: { quantity: { decrement: qty } },
        })
      }
    }

    // Invoice for first two orders
    if (o < 2) {
      const invoice = await prisma.invoice.create({
        data: {
          organizationId: organization.id,
          orderId: o === 0 ? order.id : undefined,
          customerId: customerIds[o % customerIds.length],
          invoiceNumber: `INV-2026-${String(idx * 10 + o + 1).padStart(4, '0')}`,
          status: o === 0 ? 'PAID' : 'SENT',
          dueDate: new Date(Date.now() + 14 * 86400000),
          subtotal: total,
          totalAmount: total,
          items: {
            create: [{ productId: prod.id, description: prod.name, quantity: qty, unitPrice: prod.price }],
          },
        },
      })
      if (o === 0) {
        await prisma.payment.create({
          data: {
            organizationId: organization.id,
            invoiceId: invoice.id,
            customerId: customerIds[0],
            amount: total,
            method: ['JAZZCASH', 'EASYPAISA', 'CASH', 'BANK_TRANSFER'][idx % 4] as 'JAZZCASH',
            notes: 'Full payment received',
          },
        })
      }
    }
  }

  // Expenses — realistic Pakistani business costs
  const expenseCats = await prisma.expenseCategory.findMany({
    where: { organizationId: organization.id },
  })
  const catId = (name: string) => expenseCats.find((c) => c.name === name)?.id
  const expenseRows: [string, string, number, number][] = [
    // [category, description, amount, daysAgo]
    ['Rent', 'Monthly shop rent', 85000 + idx * 2500, 6],
    ['Electricity', UTILITY_BILL[def.city] ?? 'Electricity bill', 31450 - idx * 830, 4],
    ['Internet', 'PTCL broadband — monthly', 4200 + idx * 150, 4],
    ['Transport', 'Goods transport & rickshaw fares', 8750 - idx * 320, 3],
    ['Salaries', 'Staff salaries — current month', 185000 + idx * 5000, 8],
    ['Office Supplies', 'Registers, pens & printer paper', 3685 + idx * 120, 2],
    ['Maintenance', 'Shop repairs & electrician', 12480 - idx * 400, 9],
    ['Marketing', 'Facebook ads & flex printing', 15650 + idx * 700, 5],
  ]
  for (const [cat, desc, amount, ago] of expenseRows) {
    await prisma.expense.create({
      data: {
        organizationId: organization.id,
        categoryId: catId(cat),
        description: desc,
        amount,
        expenseDate: new Date(Date.now() - ago * 86400000 - (idx * 5 + ago) * 3600000),
      },
    })
  }

  await prisma.notification.create({
    data: {
      organizationId: organization.id,
      type: 'SYSTEM',
      title: 'Welcome to BIZFLOW',
      message: `${def.name} workspace is ready. Demo login: owner.${idx}@example.com / password123`,
    },
  })

  console.log(`Seeded ${def.name}: ${customerIds.length} customers, ${productRecs.length} products`)
}

async function main() {
  // SAFETY: demo seed data must NEVER land in production by accident.
  // It runs only when SEED_DEMO_DATA=true is set explicitly, and refuses
  // to run when NODE_ENV=production unless SEED_DEMO_DATA is also set.
  const enabled = process.env.SEED_DEMO_DATA === 'true'
  const isProd = process.env.NODE_ENV === 'production'
  if (!enabled) {
    console.error('Refusing to seed: set SEED_DEMO_DATA=true to seed demo data intentionally.')
    process.exit(1)
  }
  if (isProd) {
    console.error(
      'Refusing to seed demo data in production. ' +
        'If you really mean it, run against a non-production database instead.',
    )
    process.exit(1)
  }
  for (let i = 0; i < ORGS.length; i++) {
    await seedOrg(ORGS[i], i + 1)
  }
  console.log('Seed complete: 6 fictional organizations')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
