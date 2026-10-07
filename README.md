# BIZFLOW — Business Management Platform

> Simple business management for growing Pakistani businesses.

BIZFLOW is a multi-tenant business management application for Pakistani
SMEs: customers, products, inventory, suppliers, orders, invoices,
payments, expenses, employees, notifications, audit logs, and an AI
business assistant — all scoped per organization with role-based access.

**A note on how this was built:** This application was developed with
AI-assisted coding (Muse). The AI generated much of the initial code, but
every module was reviewed, tested, debugged, and hardened by the developer:
109 automated backend tests, 4 Playwright E2E tests, a full security audit
with 5 real vulnerabilities found and fixed, and manual verification of
every feature against a live PostgreSQL database. The developer understands
the architecture, can explain every design decision below, and maintains
the codebase.

---

## Features

- **Dashboard** — real KPIs (today's sales, monthly revenue, outstanding,
  expenses, profit), charts, date filters, recent transactions
- **Customers** — profiles, transaction history, search/filter, soft delete
- **Products & Inventory** — every stock change via audited movements
  (IN/OUT/ADJUSTMENT/RETURN/DAMAGED); low-stock alerts
- **Suppliers** — purchases, supplier payments, outstanding balances
- **Orders** — draft → confirmed → completed workflow; confirmation is
  transactional (stock deduction + invoice creation, full rollback on failure)
- **Invoices** — real PDF generation, payment-derived status, WhatsApp/share
- **Expenses** — categories, monthly summary, database-backed P&L report
- **Employees** — profiles, departments, salary protection (separate permission)
- **Notifications** — real-time via Socket.IO, organization-isolated
- **Audit logs** — human-readable activity history (who did what, when)
- **AI Business Assistant** — answers questions from the org's own data only;
  grounded numbers, source context, verification disclaimer
- **Pakistan localization** — PKR (`Rs. 1,250`), Asia/Karachi, `+92 3XX XXXXXXX`,
  Pakistani cities/terminology, configurable business profile

## Screenshots

All screenshots use the fictional seeded demo data (Al-Noor General Store, Lahore).

| Login | Dashboard |
|---|---|
| ![Login](docs/screenshots/login.png) | ![Dashboard](docs/screenshots/dashboard.png) |

| Customers | Orders |
|---|---|
| ![Customers](docs/screenshots/customers.png) | ![Orders](docs/screenshots/orders.png) |

| Inventory | AI Business Assistant |
|---|---|
| ![Inventory](docs/screenshots/inventory.png) | ![AI Assistant](docs/screenshots/assistant.png) |

More in [docs/screenshots/](docs/screenshots/): products, invoices, expenses,
employees, reports, notifications.

## Demo credentials

Seed the demo database, then sign in:

```bash
cd backend
SEED_DEMO_DATA=true npm run prisma:seed
```

| Organization | Email | Password |
|---|---|---|
| Al-Noor General Store (Lahore) | owner.1@example.com | password123 |
| Raza Mobile & Electronics (Multan) | owner.2@example.com | password123 |
| Green Valley Pharmacy (Faisalabad) | owner.3@example.com | password123 |
| Punjab Home Appliances (Rawalpindi) | owner.4@example.com | password123 |
| Royal Bakers & Sweets (Bahawalpur) | owner.5@example.com | password123 |
| Sialkot Sports Traders (Sialkot) | owner.6@example.com | password123 |

All seed data is fictional (invented names, `@example.com` emails,
`0300-00000xx` phones). Never use real personal data.

---

## Architecture

```
┌──────────┐      ┌──────────┐      ┌──────────┐      ┌────────────┐
│  Browser │─HTTPS─▶│  nginx   │─/──▶│   web    │      │    api     │──▶│ postgres:16│
│  (SPA)   │      │ (TLS/LB) │─/api▶│  (SPA)   │─REST─▶│ (Express)  │  └────────────┘
└──────────┘      └──────────┘      └──────────┘      └────────────┘
                                                          │ Socket.IO
                                                          ▼ (real-time)
```

- **Frontend**: React SPA, TanStack Query for server state, React Router.
  All API calls go through `/api` (Vite proxy in dev, nginx in Docker).
- **Backend**: Express + TypeScript REST API. Stateless JWT auth; every
  request resolves `organizationId` from the authenticated member.
- **Real-time**: Socket.IO rooms per organization (`org:<id>`), JWT handshake.
- **Database**: PostgreSQL via Prisma ORM. Migrations are real SQL.

## Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, TanStack Query, React Router, Socket.IO client |
| Backend | Node 22, Express, TypeScript, Prisma, Socket.IO, Zod, bcryptjs, jsonwebtoken, PDFKit |
| Database | PostgreSQL 16 |
| Testing | Vitest, Supertest, Playwright |
| DevOps | Docker, Docker Compose, GitHub Actions, nginx |

## Database design

28 models. Key entities:

- **Identity & tenancy**: global `User` → `OrganizationMember` → `Organization`;
  one user can belong to many organizations (unique on `(userId, organizationId)`).
  `Role` → `RolePermission` → `Permission` for RBAC.
- **Business**: `Customer`, `Product`, `ProductCategory`, `Inventory`,
  `InventoryMovement`, `Supplier`, `Purchase`, `SupplierPayment`
- **Sales**: `Order`, `OrderItem`, `Invoice`, `Payment`, `Expense`
- **People**: `Employee`, `Department`
- **System**: `Notification`, `AuditLog`, `BusinessSetting`, `File`

Every tenant-owned table carries `organizationId`. Invoices are numbered
per organization (`INV-2026-00087`); orders likewise (`ORD-2026-00124`).
Stock changes only happen through `recordMovement()`, which writes an
audit trail. Soft deletes via `deletedAt`.

## Authentication

- Registration creates an organization + OWNER member + system roles.
- Login returns a JWT (7-day expiry) embedding `memberId`,
  `organizationId`, role, permissions, and a **token version**.
- `authenticate` middleware verifies the signature, checks the token
  version against the member's current `tokenVersion` (bumped on logout
  and password change → instant session invalidation), and requires an
  active member.
- Passwords: bcrypt cost 12. Reset tokens are SHA-256 hashed, single-use,
  1-hour expiry. Forgot-password always returns 200 (no email enumeration).
- Rate limiting: 20 logins / 15 min, 100 auth attempts / 15 min.

## Multi-tenancy

The organization always comes from the authenticated session — never from
client input. Every query is scoped with `organizationId`; cross-tenant
reads return **404** (not 403) to avoid leaking record existence.
Foreign-key references (e.g. a payment's `invoiceId`) are validated against
the caller's organization. Zod strips unknown fields, so clients cannot
mass-assign `organizationId`.

## RBAC

Five roles: **OWNER** (wildcard `*`), **ADMIN** (everything except
`settings.manage`), **MANAGER**, **EMPLOYEE**, **VIEWER** (read-only).
~28 granular permissions (`customers.read`, `invoices.create`,
`employees.salary`, `audit_logs.read`, …) enforced by backend middleware —
never frontend-only. Salary fields are omitted without `employees.salary`;
members cannot change their own role; only owners can create/assign owners.

## AI assistant

`POST /api/assistant/ask` resolves the org from the session, builds
**pre-computed aggregates** via a controlled data-access layer
(`buildAssistantContext`), and passes only those to the LLM — the AI never
gets database access and can never see another org's data. Provider is
configurable via `AI_PROVIDER` / `AI_API_URL` / `AI_API_KEY` / `AI_MODEL`
(OpenAI-compatible); keys are never hard-coded. Without a provider, a
built-in rule engine answers from the same aggregates. Responses include
source context, say "There isn't enough data to answer this accurately"
when data is missing, and carry a verification disclaimer.

---

## Testing

```bash
cd backend && npm test
# 109 tests: validation, auth (incl. multi-org select-token flow), RBAC,
# tenant isolation, security attacks, inventory, orders, invoices,
# notifications (incl. real socket delivery), audit, AI assistant, localization
# DB integration tests need TEST_DATABASE_URL
```

```bash
# Terminal 1 — API (uses backend/.env)
cd backend && npx tsx src/index.ts
# Terminal 2 — web
cd frontend && npm run dev -- --port 5173
# Terminal 3 — tests
npx playwright test
# 4 E2E browser tests: auth gates, login flow, tenant isolation
```

## Local development

```bash
# prerequisites: Node 22, PostgreSQL 16
cd backend
cp ../.env.example .env   # or backend/.env.example; set DATABASE_URL + JWT_SECRET
npm install
npx prisma migrate dev
npm run dev               # → http://localhost:4000

cd frontend
npm install
npm run dev               # → http://localhost:5173 (proxies /api + /socket.io)
```

## Environment variables

See [`.env.example`](.env.example) — every variable is documented there.
The important ones:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection (backend direct / local dev) |
| `JWT_SECRET` | Signs session tokens — **required in production**, app refuses to start without it |
| `CORS_ORIGIN` | Comma-separated allowed browser origins (production) |
| `FRONTEND_URL` | Builds password-reset links |
| `EMAIL_PROVIDER` | `console` (dev) / `none` (production default, fail-safe) |
| `ALLOW_DEV_RESET_TOKENS` | Test-only: expose raw reset tokens in API responses. **Never true in production** |
| `UPLOAD_DIR` / `UPLOAD_MAX_MB` | File storage location and per-file size cap |
| `AI_PROVIDER` / `AI_API_URL` / `AI_API_KEY` / `AI_MODEL` | Optional AI assistant provider (OpenAI-compatible). Unset → built-in rule engine |
| `SEED_DEMO_DATA` | Intentional demo seeding only (`true` + `npm run prisma:seed`). Never in production |

## Project structure

```
bizflow/
├── frontend/               # React 18 + TS + Vite + Tailwind SPA
│   ├── src/pages/          # Dashboard, Customers, Orders, Invoices, …
│   ├── src/auth/           # Auth context, login, org switcher
│   ├── src/components/     # Layout, shared UI
│   ├── nginx.conf          # SPA + /api + /socket.io proxy
│   └── Dockerfile
├── backend/                # Express + TS + Prisma API
│   ├── src/routes/         # auth, customers, products, orders, … (REST)
│   ├── src/services/       # inventory, notifications, storage, email, assistant
│   ├── src/middleware/     # authenticate, requirePermission, rate limits
│   ├── prisma/             # schema.prisma, migrations/, seed.ts
│   ├── tests/              # vitest suites (auth, tenant, security, …)
│   └── Dockerfile
├── e2e/                    # Playwright browser tests
├── docs/                   # API.md, ARCHITECTURE.md, DATABASE.md, DEPLOYMENT.md
│   └── screenshots/        # UI screenshots (fictional demo data)
├── .github/workflows/      # CI: lint, typecheck, tests, build, Docker
├── docker-compose.yml      # db + api + web, persistent volumes
└── .env.example
```

## API documentation

Full endpoint reference: [docs/API.md](docs/API.md) — authentication flows,
multi-org select-token flow, notifications (REST + Socket.IO), file uploads,
error format, and every module's endpoints.

## Docker

```bash
cp .env.example .env            # fill in POSTGRES_PASSWORD, JWT_SECRET
docker compose up --build
# web → :8080, api → :4000, db → :5432
```

Images: `backend/Dockerfile` (multi-stage, migrates on startup),
`frontend/Dockerfile` (nginx serving SPA). Compose uses env vars only —
no hardcoded secrets.

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): TLS reverse proxy, managed
PostgreSQL, backups, secrets, security checklist, health monitoring.

---

## Known limitations

- **Password-reset email needs a real provider** — the abstraction exists
  (`src/services/email.ts`); development uses a console mode that never logs
  tokens, production defaults to disabled (fail-safe). Wire an SMTP/Resend/
  SendGrid provider before launch.
- **Real-time notifications** are fully wired (Socket.IO org rooms, event
  hooks, browser badge + page). They need a sticky-session or Redis adapter
  when scaling the API past one instance.
- **File uploads** use local disk storage (`UPLOAD_DIR`, persistent volume in
  compose). For multi-instance or cloud deploys, swap `src/services/storage.ts`
  for object storage (S3/R2).
- **Urdu language support** is planned (`language` field exists, UI is English-only).
- Single-region deployment; no read replicas or multi-region failover.

## Future improvements

- Real email provider adapter (SMTP / Resend / SendGrid) for password resets
- Redis Socket.IO adapter + object storage (S3/R2) for horizontal scaling
- Urdu language UI (the `language` field already exists on BusinessSetting)
- Recurring invoices/expenses, barcode scanning, WhatsApp order notifications
- Mobile app (the API is already a clean REST + Socket.IO backend)

## License

MIT — see [LICENSE](LICENSE).

---

**Status:** feature-complete and tested locally (109/109 backend tests,
4/4 Playwright). Not yet publicly deployed — see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the production checklist.
