# BIZFLOW — Database design (v3)

PostgreSQL via Prisma 6. Money = `DECIMAL(12,2)`.
IDs are **UUIDs** (`@default(uuid()) @db.Uuid`).
Multi-tenant: every business-data table carries `organizationId`.

## Entity-relationship overview

```
Organization 1───* OrganizationMember *───1 Role 1───* RolePermission *───1 Permission (global)
Organization 1───1 BusinessSetting
Organization 1───* Department 1───* Employee
Organization 1───* Customer
Organization 1───* Supplier
Organization 1───* ProductCategory 1───* Product 1───1 Inventory 1───* InventoryTransaction
Organization 1───* Order 1───* OrderItem *───1 Product
Organization 1───* Invoice 1───* InvoiceItem (*───0..1 Product)
Order 0..1───1 Invoice
Customer 1───* Order / Invoice / Payment
Payment *───0..1 Order, *───0..1 Invoice
Organization 1───* ExpenseCategory 1───* Expense
Organization 1───* Notification / AuditLog / File
```

## Tables (28 models)

| Table | Purpose | Key fields |
|---|---|---|
| Organization | Tenant root | name, email, phone, address, city, province, category |
| User | A person (global identity) | email (globally unique), name, passwordHash, tokenVersion |
| OrganizationMember | User↔org link | userId → User, organizationId, roleId, isActive; unique(userId, organizationId) |
| PasswordResetToken | Single-use reset tokens | userId → User, tokenHash (SHA-256 only), expiresAt, usedAt |
| Role | Per-org roles | organizationId, name (unique/org), isSystem |
| Permission | Global catalog | key (unique, e.g. `products.create`) |
| RolePermission | Role↔permission | @@id([roleId, permissionId]) |
| BusinessSetting | Per-org config | organizationId (unique), currency `PKR`, timezone `Asia/Karachi`, taxRate, invoicePrefix, lowStockThreshold |
| Department | Org departments | organizationId, name (unique/org), soft-delete |
| Employee | Staff | organizationId, departmentId?, name, salary (PKR), soft-delete |
| Customer | Buyers | organizationId, contact + city/province, creditLimit, soft-delete |
| Supplier | Vendors | organizationId, contactPerson, paymentTerms, soft-delete |
| ProductCategory | Catalog groups | organizationId, name (unique/org), soft-delete |
| Product | Catalog | organizationId, categoryId?, sku (unique/org, nullable), price, costPrice, soft-delete |
| Inventory | Stock per product | organizationId, productId (unique), quantity, reorderLevel, location |
| InventoryTransaction | Stock ledger | organizationId, inventoryId, type (IN/OUT/ADJUSTMENT), quantity, reason, reference, createdBy |
| Order | Purchase workflow | organizationId, customerId?, status, totalAmount |
| OrderItem | Order lines | orderId, productId (Restrict), quantity, unitPrice |
| Invoice | Billing | organizationId, orderId? (unique), customerId, invoiceNumber (unique), status, totals |
| InvoiceItem | Invoice lines | invoiceId, productId? (SetNull), description, quantity, unitPrice |
| ExpenseCategory | Cost groups | organizationId, name (unique/org), soft-delete |
| Expense | Costs | organizationId, categoryId?, amount, expenseDate, soft-delete |
| Payment | Money in | organizationId, orderId?, invoiceId?, customerId?, amount, method |
| Notification | Alerts | organizationId, memberId?, type, title, message, isRead |
| AuditLog | Who did what | organizationId, memberId?, action, entity, entityId, details (JSON) |
| File | Attachments | organizationId, uploadedById?, filename, mimeType, size, path, entity/entityId |

## Conventions

- **Primary keys**: UUIDs everywhere.
- **Foreign keys**: `onDelete: Cascade` for tenant-owned rows;
  `Restrict` on line items → products (never silently lose history);
  `SetNull` for optional references (customer on old orders).
- **Indexes**: `@@index([organizationId])` on all tenant tables;
  plus `[organizationId, createdAt]`, `[organizationId, status]`,
  `[organizationId, name]` where queried.
- **Unique**: `Role[organizationId, name]`, `Department[organizationId, name]`,
  `Product[organizationId, sku]` (nullable → multiple NULLs allowed),
  `ProductCategory` / `ExpenseCategory` names per org, `Invoice.invoiceNumber`,
  `OrganizationMember.email` (global), `Permission.key` (global),
  `Inventory.productId`, `BusinessSetting.organizationId`.
- **Timestamps**: `createdAt`/`updatedAt` on all mutable tables;
  `createdAt` only on ledger/audit/notification rows.
- **Soft deletion** (`deletedAt`): Customer, Employee, Department, Supplier,
  Product, ProductCategory, Expense, ExpenseCategory. Deletes set
  `deletedAt`; all reads filter `deletedAt: null`. Transactional tables
  (orders, invoices, payments, inventory ledger, audit) are **never**
  soft-deleted — financial history is immutable.
- **Multi-tenancy**: enforced in the API layer — see "Tenant isolation" below.

## Tenant isolation

Every business is an `Organization`. People belong to organizations through
`OrganizationMember`, each member holding one `Role`; roles grant `Permission`
keys via `RolePermission`.

- **Org resolution**: `authenticate` middleware verifies the JWT signature, then
  loads the member from the database and takes `organizationId` **only from the
  server-side record** — never from URL params, query strings, or request bodies.
  Stale/invalid sessions are rejected with 401.
- **Query scoping**: every protected route forces
  `where: { organizationId: <from JWT> }`. The generic `crudRouter` factory
  (`src/routes/crud.ts`) builds this into list/get/create/update/delete;
  specialized routes (orders, invoices, inventory, reports, members, roles,
  notifications, settings, audit, files) scope the same way, including nested
  lookups (e.g. an order's customer/product must belong to the same org).
- **404, not 403**: cross-tenant access returns `404 NOT_FOUND`, so an attacker
  probing IDs learns nothing about whether another org's record exists.
- **Frontend filtering is cosmetic only** — the backend re-checks everything.
- **Proven by tests** (`tests/tenant.test.ts`, "tenant isolation attack
  scenarios"): Org A cannot read / modify / delete Org B's customers, products,
  orders by ID-guessing (all 404); list endpoints never leak foreign rows;
  cross-org order creation and stock adjustments are rejected; reports never
  aggregate foreign data; members/roles of another org are unreachable.

## Stock rule

`Inventory.quantity` changes **only** through `InventoryTransaction`
rows via the inventory service. Receiving, order delivery, and manual
adjustments all go through it; low-stock notifications fire automatically.

## Seed (`prisma/seed.ts`)

Six fictional organizations — Al-Noor General Store (Lahore),
Raza Mobile & Electronics (Multan), Green Valley Pharmacy (Faisalabad),
Punjab Home Appliances (Rawalpindi), Royal Bakers & Sweets (Bahawalpur),
Sialkot Sports Traders (Sialkot). Each gets: system roles + owner/manager
members, departments, employees, customers, suppliers, categories,
products with realistic non-round PKR prices, opening stock, order
history (PENDING/CONFIRMED/DELIVERED), invoices, payments, expenses
(including city-correct utility bills: LESCO/MEPCO/FESCO/IESCO/GEPCO),
and a welcome notification. All PII is invented (`@example.com`,
`0300-00000xx`).


## Products & Inventory (2026-10-07)

- `Product` now has `brand`, `unit`, `wholesalePrice`, `taxPercentage`, `status` (ACTIVE/INACTIVE/DISCONTINUED) and optional `supplierId`.
- `InventoryTransactionType` = IN, OUT, RETURN, DAMAGED, ADJUSTMENT.
- Every stock change goes through `recordMovement()` — IN/RETURN add, OUT/DAMAGED subtract, ADJUSTMENT is signed — and always writes an `InventoryTransaction` row (who/when/why). Direct quantity edits are not allowed.
- Endpoints: `POST /api/inventory/receive|issue|return|damaged|adjust`, `GET /api/inventory/movements` (tenant-scoped, optional `productId`/`type`).


## Suppliers & Purchases (2026-10-07)

- `Supplier` now has `company`, `taxNumber` (NTN/STRN), `openingBalance`, `notes`.
- New `Purchase` model (supplier, purchaseNumber, total/paid amounts, status PENDING→PARTIAL→PAID) and `SupplierPayment` (linked to purchase and supplier).
- Supplier outstanding = openingBalance + purchases − payments. Overpayment is rejected.


## Orders workflow (2026-10-07)

- `OrderStatus`: DRAFT, CONFIRMED, PROCESSING, COMPLETED, CANCELLED, RETURNED. `PaymentStatus`: UNPAID, PARTIALLY_PAID, PAID, REFUNDED.
- `PaymentMethod`: CASH, BANK_TRANSFER, JAZZCASH, EASYPAISA, CARD, OTHER — demo only, no real accounts connected.
- `Order` has `orderNumber` (ORD-2026-0001, sequential per org), subtotal/discount/tax/total, paidAmount.
- `Invoice.invoiceNumber` is now unique per org (was global).
- `BusinessSetting.allowNegativeStock` (default false) gates whether confirming an order may drive stock negative.
- Confirm is one DB transaction: stock OUT movements + invoice creation + status flip. Any failure rolls everything back.


## Invoices (2026-10-07)

- `Invoice` has `subtotal`, `discountAmount`, `taxAmount`, `notes`.
- Invoice status is **derived from actual payments** (PAID / PARTIALLY_PAID / OVERDUE / SENT / DRAFT / CANCELLED), never trusted from storage alone.
- PDFs are generated server-side with pdfkit from live database data — no fake files.


## Expenses & P&L (2026-10-07)

- Expense categories: Rent, Electricity, Internet, Transport, Salaries, Office Supplies, Maintenance, Marketing, Utilities, Purchases, Other.
- `GET /reports/profit-loss` computes from real records: Revenue = completed order totals; COGS = order items at product cost price; Gross = Revenue − COGS; Net = Gross − Expenses. No hard-coded statistics.


## Employees (2026-10-07)

- `Employee.employeeId` is unique per organization (EMP-1042 style, auto-generated).
- Optional `roleId` links an employee to a system Role for role assignment.
- New `employees.salary` permission: salary is stripped from all API responses (and ignored on write) without it. OWNER/ADMIN hold it; MANAGER and VIEWER do not.


## Dashboard (2026-10-07)

- `GET /reports/dashboard?from=&to=` returns every dashboard number from live records: today's sales, month revenue (payments), outstanding invoice balances, expenses, net/gross profit, low stock, pending orders, revenue/expense time series, sales by category, top products, payment methods, outstanding invoices and merged recent transactions. Empty states when there is no data.


## Pakistan localization (2026-10-07)

- Defaults: country `Pakistan`, currency `PKR`, timezone `Asia/Karachi`, language `en` (Urdu planned).
- `Organization` carries business profile fields: name, address, city, province, country, phone, email, website.
- `BusinessSetting` carries currency, timezone, language, taxRate, invoice/order prefixes.
- Currency displays as `Rs. 1,250` / `Rs. 45,800` / `Rs. 1,250,000` via `frontend/src/lib/locale.ts`; phones format as `+92 3XX XXXXXXX`.
- The `LOCALES` map is structured per-country so other countries can be added later without schema changes.
- Seed data uses fictional Pakistani businesses, people, cities (Lahore, Karachi, Islamabad, Rawalpindi, Faisalabad, Multan, Gujranwala, Sialkot, Peshawar, Quetta, Bahawalpur, Muzaffargarh, Sargodha, Hyderabad) and areas (Gulberg, Johar Town, Saddar, Anarkali). No real personal data.
