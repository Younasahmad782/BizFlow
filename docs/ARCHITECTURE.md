# BIZFLOW — Architecture

> "Simple business management for growing Pakistani businesses."

BIZFLOW is a multi-tenant business management platform. One deployment serves
many businesses; every business sees and manages only its own data.

## Tech stack

| Layer    | Choice                                                      |
|----------|-------------------------------------------------------------|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS v4 + TanStack Query + React Router |
| Backend  | Node.js + Express 5 + TypeScript + Prisma 6 (pinned, not v8 RC) |
| Database | PostgreSQL 16 — UUID primary keys, soft deletion on master data |
| Auth     | bcryptjs password hashing + JWT (Bearer, 7-day, embeds permission keys) |
| Identity  | Global `User` → `OrganizationMember` → `Organization` (one person, many orgs); short-lived select tokens for org picking at login |
| RBAC     | Organization → OrganizationMember → Role → RolePermission → Permission (28 keys); `requirePermission()` middleware; OWNER `*` wildcard |
| Validate | Zod schemas on every write endpoint                          |
| Test     | Vitest + Supertest (backend)                                 |
| Deploy   | Docker + docker-compose (db, api, web)                       |

## Monorepo layout

```
bizflow/
  docs/                    # architecture, database, api docs
  docker-compose.yml       # db + api + web services
  frontend/
    Dockerfile / nginx.conf
    src/
      lib/                 # api client, query client, formatting, constants
      auth/                # AuthContext, ProtectedRoute
      components/          # reusable UI (layout, tables, forms, empty states)
      pages/               # one folder per area (Dashboard, Customers, ...)
      App.tsx / main.tsx
  backend/
    Dockerfile
    prisma/
      schema.prisma
      seed.ts              # fictional Pakistani demo data
    src/
      index.ts             # app wiring only
      lib/prisma.ts
      middleware/          # authenticate, requirePermission, errorHandler
      routes/              # auth, members, roles, crud factory, departments,
                           # orders, invoices, inventory, notifications,
                           # settings, audit-logs, files, reports, assistant
      schemas/             # zod validation schemas
      services/            # audit, inventory movements, invoice numbering
      auth/                # permission catalog + role templates
      utils/              # errors, formatting
    tests/                 # vitest suites
```

## Backend layering

`routes/` (HTTP) → `services/` (business logic) → `prisma` (data).
Routes never touch Prisma directly for anything beyond simple CRUD;
non-trivial logic (stock movements, invoice numbering, notifications)
lives in services so it is testable without HTTP.

## Authentication & RBAC

- `POST /api/auth/register` — creates an **Organization**, 4 system roles
  (OWNER/ADMIN/MANAGER/EMPLOYEE/VIEWER) with permission grants, default
  `BusinessSetting`, default expense categories, and the first **OWNER**
  member.
- `POST /api/auth/login` — email + password → JWT embedding
  `memberId`, `organizationId`, `roleName`, `permissions[]` (7-day expiry).
- `GET /api/auth/me` — current member + organization + permissions.
- Passwords hashed with bcrypt (12 rounds). JWT secret from env.

## Authorization (permissions, not just roles)

27 permission keys (`<resource>.<action>`) form a global catalog:
`customers/products/orders/invoices/expenses/employees` ×
`read/create/update/delete`, plus `reports.read`, `settings.manage`,
`audit_logs.read`. Five system roles are created per organization:

| Role | Permissions |
|---|---|
| OWNER | all (`*` wildcard) |
| ADMIN | all except `settings.manage` |
| MANAGER | customers, products, orders, invoices (full CRUD) + `reports.read` |
| EMPLOYEE | `customers.read`, `orders.read`, `orders.create` |
| VIEWER | read-only (`*.read` + `reports.read` + `audit_logs.read`) |

Related resources map onto the catalog (suppliers/product-categories/inventory
→ `products.*`; departments/members/roles → `employees.*`; expense-categories
→ `expenses.*`; payments → `invoices.*`). Custom roles can be created by owners.
`requirePermission(...)` middleware enforces everything server-side:
401 = missing/invalid/expired token, 403 = authenticated but lacking the
permission, 404 = cross-tenant (to avoid leaking existence). The frontend
hides nav items without the permission, but the backend is the enforcer.

## Multi-tenancy

- Every business-data table carries `organizationId` (UUID FK).
- `authenticate` middleware loads `req.member`
  (memberId, organizationId, roleName, permissions).
- All queries are scoped: `where: { organizationId: req.member.organizationId }`.
  The generic CRUD factory enforces this — callers cannot override it via
  query params. Cross-tenant access returns 404 (never 403, to avoid
  leaking existence).

## Validation & errors

- Zod schemas in `src/schemas/` validate every POST/PATCH body.
  Failures → `400 { error: { code: "VALIDATION_ERROR", details: [...] } }`.
- `AppError(status, code, message)` + central `errorHandler` middleware
  produce a consistent shape: `{ error: { code, message, details? } }`.
- Frontend shows these via a shared error component — no raw stack
  traces, no silent failures.

## Audit logs & notifications

- Mutating service calls write an `AuditLog` row
  (who, what action, which entity, when).
- Domain events create `Notification` rows: low stock (Inventory service),
  overdue invoices (scheduled check / on read), etc.
- Real-time delivery: Socket.IO server attached to the Express HTTP server.
  The handshake verifies JWT signature, member/user/org IDs, active
  membership, and token version; each socket joins room `org:<organizationId>`.
  Events are emitted to the org room only after the DB transaction commits,
  so a rolled-back transaction never notifies. The browser keeps a live
  unread badge and a full notification history page (`/notifications`).

## Pakistan localization

- Currency: PKR, formatted `Rs. 125,500` (`formatPKR` in `lib/format.ts`).
- Phone: accepts `0300-1234567`, `03001234567`, `+923001234567`
  (`isValidPakistaniPhone`).
- Cities & provinces as constants for dropdowns
  (`lib/pakistan.ts`): 15 cities, 7 provinces/territories.
- Timezone `Asia/Karachi`; dates displayed `DD-MMM-YYYY`
  (`formatPKDate`).
- All demo/seed data is **fictional**: invented names, `example.com`
  emails, obviously fake phone numbers (`0300-0000001` style).

## Key domain decisions

- **Orders**: an *Order* is a customer purchase request with a status
  workflow (PENDING → CONFIRMED → DELIVERED); delivering decrements stock.
- **Products vs Inventory**: *Product* is the catalog entry (no stock
  field). *Inventory* holds quantity/reorderLevel per product;
  *InventoryTransaction* is the ledger (IN / OUT / ADJUSTMENT).
- **Invoices** can optionally link to an Order; **Payments** can link to
  Orders and/or Invoices; **Reports** are read-only aggregations.

## Testing strategy

- Backend: Vitest + Supertest against the Express app with a test
  database. Suites: auth (register/login/role), validation (zod
  rejections), tenant isolation (business A cannot read business B).
- Frontend: utility tests for formatting/validation helpers.

## Deployment

- `docker-compose.yml` runs `db` (postgres:16 + volume), `api`
  (backend Dockerfile, runs migrations on start), `web` (frontend
  build served by nginx, proxies `/api` to `api:4000`).
- 12-factor config: everything via environment variables.

## Security audit (2026-10-07)

Automated suite: `backend/tests/security.test.ts` (19 tests) + `e2e/security.spec.ts` (Playwright).

**Findings fixed:**
1. **Cross-tenant payment** (critical): org A could create a payment against org B's invoice — the generic CRUD create did not validate foreign-key references against the tenant. Fixed with a `validateCreate` hook on `crudRouter`; payments now verify invoice/order/customer belong to the caller's org (404 otherwise).
2. **Malformed JSON** returned 500 via body-parser SyntaxError. Now returns 400.
3. **Invalid UUID** in path params returned 500 (Prisma P2023). Now returns 400 via error handler + explicit validation in CRUD routes.
4. **No rate limiting.** Added `express-rate-limit`: 20 logins / 15 min, 100 auth attempts / 15 min.
5. **File metadata endpoint** accepted unvalidated entity/entityId/path. Now zod-validated: path traversal rejected, entity whitelisted, referenced records verified against the org, 50 MB size cap.

**Verified clean:**
- JWT with token-version session invalidation; expired/wrong-secret/malformed tokens rejected; logout invalidates.
- Every route enforces `organizationId` from the session; cross-tenant reads return 404 (no existence leak).
- RBAC: viewers blocked from settings/deletes/member management; only owners can create Owner accounts or assign the Owner role; members cannot change their own role.
- Raw SQL uses parameterized Prisma template literals (no SQLi). No `dangerouslySetInnerHTML` (XSS stored as inert text).
- Zod strips unknown fields (no mass assignment); `organizationId` always comes from the session.
- Password reset tokens are SHA-256 hashed, single-use, 1-hour expiry; forgot-password avoids enumeration.
