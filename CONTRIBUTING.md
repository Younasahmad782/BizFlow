# Contributing to BizFlow

## Getting started

```bash
cp .env.example .env        # fill in POSTGRES_PASSWORD and JWT_SECRET
docker compose up --build
# web → http://localhost:8080, api → http://localhost:4000
```

For local development without Docker:

```bash
# Terminal 1 — backend
cd backend
npm install
npx prisma migrate dev
npm run dev

# Terminal 2 — frontend
cd frontend
npm install
npm run dev
```

Seed fictional demo data (development only, never production):

```bash
cd backend
SEED_DEMO_DATA=true npm run prisma:seed
# demo logins: owner.1@example.com … owner.6@example.com / password123
```

## Before opening a PR

```bash
cd backend && npx oxlint && npx tsc --noEmit && npm test
cd frontend && npm run lint && npx tsc --noEmit && npm run build
```

## Conventions

- **Real backend enforcement** — no frontend-only security, no fake data.
  Permissions, tenancy, and validation are enforced server-side.
- **Tenant scoping** — every new tenant-owned table gets `organizationId`,
  and every query is scoped to the authenticated member's organization.
- **Migrations** — use `prisma migrate dev`; never edit a migration that has
  already been applied to a shared database.
- **Demo data** — fictional Pakistani businesses only, `@example.com` emails,
  `0300-00000xx` phones. Never real personal data.
- **Secrets** — never commit `.env` or credentials; use `.env.example` placeholders.
