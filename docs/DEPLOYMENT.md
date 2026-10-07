# BIZFLOW — Production Deployment Guide

## Architecture

```
                ┌─────────┐
  users ──HTTPS─▶│  nginx  │──/api/──▶┌─────────┐──▶┌────────────┐
  (TLS)          │ (or LB) │──/──────▶│   web   │  │    api     │  │ postgres:16  │
                └─────────┘          │ (nginx) │  │ (node:22)  │  │ (managed)   │
                                     └─────────┘  └────────────┘  └────────────┘
```

- `web` serves the SPA and proxies `/api/` to the backend.
- `api` runs migrations on startup (`prisma migrate deploy`) then starts Node.
- Use a managed PostgreSQL (RDS, Cloud SQL, Supabase, Neon) in production
  rather than the compose `db` service for backups and failover.

## Prerequisites

- Docker + Docker Compose (or a container platform)
- A PostgreSQL 16 database with a strong password
- A domain with DNS pointing at the host
- TLS certificates (Let's Encrypt via the reverse proxy)

## Deployment steps

### 1. Prepare secrets

```bash
cp .env.example .env
```

Set real values — **never commit `.env`**:

- `POSTGRES_PASSWORD` — strong random password
- `JWT_SECRET` — `openssl rand -hex 32` (the API **refuses to start** in
  production without it)
- `DATABASE_URL` — point at your managed database, or keep the compose `db`
- `AI_API_KEY` — only if using the AI assistant with a real provider
- `CORS_ORIGIN` — your app's public origin(s), comma-separated
  (e.g. `https://app.example.com`); required for browser clients
- `EMAIL_PROVIDER` — `none` (default, fail-safe) or a wired provider;
  `FRONTEND_URL` must be your public app URL for reset links
- `UPLOAD_MAX_MB` — per-file upload cap (default 10); uploads persist in the
  `bizflow-uploads` Docker volume mounted at `/app/uploads`

### 2. Build and start

```bash
docker compose up -d --build
```

The `api` container applies pending migrations automatically, then serves
on `${API_PORT:-4000}`; the `web` container serves the SPA on
`${WEB_PORT:-8080}`.

### 3. Verify

```bash
curl http://localhost:4000/api/health        # {"status":"ok"}
curl http://localhost:8080/                  # SPA html
docker compose logs -f api                   # watch startup / migrations
```

Register the first organization in the UI — its creator becomes OWNER.

### 4. Put it behind TLS

Terminate HTTPS at a reverse proxy (nginx, Caddy, Traefik, or your cloud
load balancer) and forward to `web:80`. Example Caddy:

```
bizflow.example.com {
    reverse_proxy web:80
}
```

## Database

- **Migrations** run automatically on container start via
  `prisma migrate deploy`. To apply manually:
  `docker compose exec api npx prisma migrate deploy`.
- **Backups**: schedule `pg_dump` (or your provider's automated backups)
  daily and test restores. Example:
  `docker compose exec db pg_dump -U bizflow bizflow > backup.sql`
- **Never run the demo seed in production.** The seed script requires
  `SEED_DEMO_DATA=true` and refuses when `NODE_ENV=production`.

## Security checklist

- [ ] `.env` has strong, unique `POSTGRES_PASSWORD` and `JWT_SECRET`
- [ ] `.env` is not committed (it's in `.gitignore`)
- [ ] HTTPS enforced at the edge; HTTP redirects to HTTPS
- [ ] `CORS_ORIGIN` lists only your real app origin(s)
- [ ] `ALLOW_DEV_RESET_TOKENS` is unset / `false`
- [ ] `EMAIL_PROVIDER` is wired (or knowingly `none` — users can't reset
      passwords until it is)
- [ ] Database is not exposed publicly (remove the `db` port mapping or
      bind to localhost)
- [ ] Backups are scheduled and restore-tested (database **and** the
      `bizflow-uploads` volume)
- [ ] `NODE_ENV=production`
- [ ] AI provider keys (if any) are stored as secrets, not in the image

## Scaling notes

- **Real-time notifications** use in-memory Socket.IO rooms: fine for one
  API instance. Past one instance, add the Redis adapter
  (`@socket.io/redis-adapter`) and sticky sessions at the load balancer.
- **Uploads** live on local disk (`UPLOAD_DIR`). For multi-instance or
  cloud deploys, replace `src/services/storage.ts` with S3/R2-compatible
  object storage (the DB metadata schema already fits).

## Health & monitoring

- `GET /api/health` → `{"status":"ok"}` (add to your uptime monitor)
- `docker compose ps` / `docker compose logs -f` for container status
- Audit logs (`/audit-logs` in the UI, `audit_logs.read` permission) record
  logins, CRUD, role changes and password changes per organization

## Updating

```bash
git pull
docker compose up -d --build     # migrations apply automatically
```

For zero-downtime on a single host, build the new images first
(`docker compose build`), then recreate.
