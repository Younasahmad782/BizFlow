# BIZFLOW — API structure (v3)

Base URL: `/api`. JSON everywhere.
Auth: `Authorization: Bearer <JWT>` (except `/auth/*`, `/health`).
The session JWT carries `memberId`, `userId`, `organizationId`, `roleName`,
`permissions[]` and a token version `tv` (bumped on logout / password change).

## Identity model

- **User** — a person: `email` (globally unique), `name`, `passwordHash`,
  `tokenVersion`. One user can belong to many organizations.
- **OrganizationMember** — links a user to one organization with a `roleId`
  and `isActive`. Unique on `(userId, organizationId)`.
- **Organization** — the tenant. Every business-data row carries
  `organizationId`, always taken from the JWT.

## Conventions

- **Tenancy**: `organizationId` always comes from the JWT — never from
  query params or bodies. Cross-tenant reads return **404** (never 403, to
  avoid leaking existence).
- **Authorization**: `requirePermission('<resource>.<action>')` middleware.
  `*` (OWNER) bypasses all checks.
- **Soft delete**: DELETE on master data sets `deletedAt`; lists/detail
  exclude soft-deleted rows.
- **List**: `?take=` (default 20–50, max 100–200), `?skip=`, field filters.
- **Errors**: `{ error: { code, message, details? } }`
  (`VALIDATION_ERROR` → 400, `UNAUTHORIZED` → 401, `FORBIDDEN` → 403,
  `NOT_FOUND` → 404, `CONFLICT` → 409, `INSUFFICIENT_STOCK` → 400,
  `RATE_LIMITED` → 429).
- **Validation**: every write body is Zod-validated; failures return 400
  with per-field details.

## Auth & RBAC

| Method | Endpoint | Body / Notes |
|---|---|---|
| POST | /auth/register | `{ organization: { name, city?, province?, category?, phone?, address? }, user: { name, email, password } }` → creates org + system roles + settings + expense categories + OWNER membership → `{ token, member, organization, permissions }` |
| POST | /auth/login | `{ email, password }` → single membership: `{ token, member, organization, permissions }`. **Multiple memberships:** `{ requiresOrgSelection: true, selectToken, memberships[] }` — no session token yet (20 logins / 15 min rate limit) |
| POST | /auth/switch-organization | `{ organizationId }` with the short-lived `selectToken` (10 min, grants no org access by itself) **or** a live session token → `{ token, member, organization, permissions }`. Rejects orgs the user isn't a member of (403) |
| POST | /auth/logout | bumps the user's token version → all sessions, all orgs, invalidated → `{ ok: true }` |
| POST | /auth/change-password | `{ currentPassword, newPassword }` → 200; wrong current → 401; all sessions logged out |
| POST | /auth/forgot-password | `{ email }` → always 200 (no enumeration); stores only the SHA-256 of a single-use 1h token; delivery via the email provider abstraction (dev: console mode logs a notice **without** the token) |
| POST | /auth/reset-password | `{ token, password }` → 200; invalid/expired/used → 400; invalidates all sessions |
| GET | /auth/me | → `{ member, organization, permissions, memberships[] }` (memberships feed the org switcher) |
| GET | /members | list org members, flattened `{ id, name, email, userId, role }` (`employees.read`) |
| POST | /members | `{ name, email, password, roleId }` — links an **existing user** to this org if the email is known (one person, many orgs) (`employees.create`) |
| PATCH | /members/:id | `{ roleId?, isActive? }` — zod-validated (`employees.update`; not self, not owners) |
| GET | /roles | roles + permission keys (`employees.read`) |
| GET | /roles/permissions/catalog | all permission keys (`employees.read`) |
| POST | /roles | custom role (OWNER only) |

Password-reset email is provider-agnostic (`src/services/email.ts`):
`EMAIL_PROVIDER=console` (dev default — never logs tokens) or `none`
(production default — fail-safe). `FRONTEND_URL` builds the reset link.
`ALLOW_DEV_RESET_TOKENS=true` exposes `devToken` in the response for tests
only — never enable in production.

## Generic CRUD (tenant-scoped, soft-deleting)

| Prefix | Model | Read / Create / Update / Delete perms |
|---|---|---|
| /departments | Department | employees.read/create/update/delete |
| /employees | Employee | dedicated router: search/filter/paginate, EMP-#### IDs, salary gated by `employees.salary` |
| /customers | Customer | dedicated router: search/filter/sort/paginate + `GET /:id/profile` (stats, history, notes) |
| /suppliers | Supplier | dedicated router: search/filter/paginate + `GET /:id/profile`; purchases (`POST /purchases`, `POST /purchases/:id/pay`) |
| /product-categories | ProductCategory | products.read/create/update/delete |
| /expense-categories | ExpenseCategory | expenses.read/create/update/delete |
| /products | Product | dedicated router: search/filter/sort/paginate, low-stock filter |
| /expenses | Expense | dedicated router: search, filter by category/date, monthly totals; create/patch/soft-delete |
| /payments | Payment | invoices.read/create/update/delete (hard delete); cross-tenant invoice/order/customer refs → 404; fires `PAYMENT_RECEIVED` |

`GET /`, `GET /:id`, `POST /` (zod-validated), `PATCH /:id` (zod-validated),
`DELETE /:id` (soft delete → 204).

## Orders

| Method | Endpoint | Notes |
|---|---|---|
| GET | /orders | search/filter/paginate (`orders.read`) |
| GET | /orders/:id | with items, customer, invoice, payments |
| POST | /orders | create DRAFT: `{ customerId?, items, discountAmount?, taxAmount? }` — totals computed server-side, sequential `ORD-2026-0001` per org (`orders.create`) → fires `ORDER_CREATED` |
| POST | /orders/:id/confirm | DRAFT → CONFIRMED: deducts stock + creates invoice in ONE transaction (rolls back on failure) (`orders.update`) → fires `ORDER_CONFIRMED` (+ deduped `LOW_STOCK`) |
| POST | /orders/:id/pay | recorded payment `{ amount, method: CASH\|BANK_TRANSFER\|JAZZCASH\|EASYPAISA\|CARD\|OTHER }` (`orders.update`) → fires `PAYMENT_RECEIVED` |
| PATCH | /orders/:id | status transitions; CANCELLED/RETURNED restock (`orders.update`) |

## Invoices

| Method | Endpoint | Notes |
|---|---|---|
| GET | /invoices?status= | (`invoices.read`) |
| GET | /invoices/:id | with items, customer, payments (payment-derived status) |
| GET | /invoices/:id/pdf | download the real PDF invoice (`invoices.read`) |
| GET | /invoices/:id/share | share-ready message + PDF link; no email is sent (`invoices.read`) |
| POST | /invoices | `{ orderId?, customerId, dueDate?, taxAmount?, items: [...] }` — auto-generates `INV-2026-0001` style numbers (`invoices.create`) |
| PATCH | /invoices/:id | `{ status?, dueDate? }` (`invoices.update`) |

## Inventory

| Method | Endpoint | Notes |
|---|---|---|
| GET | /inventory?lowStock=true | levels + `lowStock` flags (`products.read`) |
| GET | /inventory/movements?productId=&type= | ledger (`products.read`) |
| PATCH | /inventory/:id | `{ reorderLevel?, location? }` (`inventory.update`) |
| POST | /inventory/receive | `{ productId, quantity>0, reason }` — stock IN (`inventory.create`) |
| POST | /inventory/issue | `{ productId, quantity>0, reason }` — stock OUT (`inventory.update`) |
| POST | /inventory/return | `{ productId, quantity>0, reason }` — customer return (`inventory.update`) |
| POST | /inventory/damaged | `{ productId, quantity>0, reason }` — write-off (`inventory.update`) |
| POST | /inventory/adjust | `{ productId, quantity≠0 (signed), reason }` — correction (`inventory.update`) |

Every movement goes through `recordMovement()` inside the caller's
transaction; low-stock alerts fire **after commit** (deduped while unread).

## Notifications (REST + real-time)

| Method | Endpoint | Notes |
|---|---|---|
| GET | /notifications?unread=true | paginated history + `unreadCount`; also runs the opportunistic overdue-invoice sweep |
| PATCH | /notifications/:id/read | mark one read (404 for other orgs' IDs) |
| PATCH | /notifications/read-all | mark all read → `{ ok: true, markedRead }` |

Real-time: Socket.IO on the same origin (`/socket.io`). Clients connect with
`auth: { token }`; the server verifies the JWT + token version and joins the
client to exactly one room (`org:<organizationId>`). Events (`notification`
payload `{ id, type, title, message, isRead, createdAt }`) are emitted only
after their DB transactions commit. Event sources: order created/confirmed,
payment received, low stock (deduped), employee added, invoice overdue.

## Files (real storage)

| Method | Endpoint | Notes |
|---|---|---|
| GET | /files?entity=&entityId= | metadata list; uploader flattened to `{ id, name }` — storage internals never exposed |
| POST | /files | multipart upload (field `file`): validates extension+MIME allowlist + 10 MB cap (configurable via `UPLOAD_MAX_MB`); stores as `<UPLOAD_DIR>/<orgId>/<uuid>.<ext>`; original filename never touches disk → 201 metadata |
| GET | /files/:id/download | tenant-scoped streaming download with correct `Content-Type`; cross-org IDs → 404 |

`UPLOAD_DIR` defaults to `./uploads` (git- and docker-ignored).

## Reports / System

| Method | Endpoint |
|---|---|
| GET | /reports/dashboard — KPIs, chart datasets, outstanding invoices, recent transactions (`reports.read`) |
| GET | /reports/profit-loss — revenue, COGS, gross profit, expenses, net profit from real records (`reports.read`) |
| GET | /reports/summary — revenue, expenses, profit, counts, low-stock |
| GET | /reports/sales-by-product |
| GET | /reports/expenses-by-category |
| GET | /reports/revenue-by-month (Asia/Karachi) |
| GET/PATCH | /settings — BusinessSetting (`settings.update` on write) |
| GET/PATCH | /settings/profile — business profile (`settings.manage` on write) |
| GET | /audit-logs — filterable, human-readable summaries; secrets scrubbed at write time (`audit_logs.read`) |
| POST | /assistant/ask `{ question }` — AI assistant over org-scoped aggregates (configurable provider; grounded fallback) |
| GET | /health |

## Example — receive stock

```http
POST /api/inventory/receive
Authorization: Bearer <JWT>

{ "productId": "…", "quantity": 50, "reason": "Purchase from Lahore Wholesale Traders" }
→ 200 { "ok": true }   (writes IN transaction, bumps quantity,
                         LOW_STOCK alert fires after commit if below reorder)
```

## Example — validation failure

```http
400 { "error": { "code": "VALIDATION_ERROR", "message": "Invalid request body",
  "details": [{ "field": "price", "message": "Amount must be greater than zero" }] } }
```

## Example — multi-org login

```http
POST /api/auth/login { "email": "…", "password": "…" }
→ 200 { "requiresOrgSelection": true, "selectToken": "…",
        "memberships": [{ "organizationId": "…", "organizationName": "…", "roleName": "…" }] }

POST /api/auth/switch-organization { "organizationId": "…" }
Authorization: Bearer <selectToken>
→ 200 { "token": "<session JWT>", "member": { … }, "organization": { … }, "permissions": […] }
```
