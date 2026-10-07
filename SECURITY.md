# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in BizFlow, please report it
privately instead of opening a public issue.

- Email: use the contact listed on the maintainer's GitHub profile
- Include: a description of the issue, steps to reproduce, and the version/commit affected

You can expect an initial response within 72 hours. Please do not disclose the
issue publicly until it has been addressed.

## Security design

BizFlow is built with server-side enforcement as a baseline:

- **Authentication** — bcrypt (cost 12) password hashing, stateless JWT
  sessions with a per-user token version for instant invalidation on
  logout/password change.
- **Multi-tenancy** — every request resolves the organization from the
  authenticated membership; cross-tenant reads return 404 to avoid leaking
  record existence.
- **Authorization** — 28 granular RBAC permissions enforced by backend
  middleware, never frontend-only.
- **Input validation** — Zod schemas on all write routes; unknown fields stripped.
- **File uploads** — extension + MIME allowlist, size cap, UUID filenames,
  per-organization directories, traversal-proof path resolution.
- **Secrets** — never committed; see `.env.example`. Production refuses to
  start without `JWT_SECRET`.

## Supported versions

Only the `main` branch receives security fixes.
