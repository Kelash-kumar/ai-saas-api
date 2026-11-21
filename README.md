User and company CRUD is also implemented in NestJS. See the [management guide](docs/USER-COMPANY-MANAGEMENT.md) for the ten endpoints, shared repository/provisioning design, fifth migration and Postman walkthrough.

# NestJS authentication foundation

A reusable backend built incrementally. **Phases 1–5 are implemented:** infrastructure, PostgreSQL persistence, authentication/recovery, lifecycle/mail delivery, dynamic RBAC and scoped administrative management. Phase 6 operational hardening remains.

Start with the [complete working guide](docs/WORKING-GUIDE.md). Import the [Postman collection](postman/NestJS-Auth-Foundation.postman_collection.json) and optional [Local environment](postman/Local.postman_environment.json) for the full API walkthrough.

## Run locally

Use Node.js 22.13+ on the 22.x line or 24.11+, NestJS 11, TypeORM 1.1.3 and PostgreSQL 17.

```powershell
cd E:\nestjs-auth-foundation
npm ci --ignore-scripts
npm run auth:keys
npm run db:local
npm run db:migrate
npm run start:dev
```

The current workspace already has private keys, a separate running development PostgreSQL cluster on `127.0.0.1:55432` and all five migrations applied. The helper uses installed PostgreSQL 17 binaries and leaves existing services untouched. Keys are generated only when missing in the ignored `.env`.

Start delivery in another terminal:

```powershell
cd E:\nestjs-auth-foundation
npm run mail:worker
# Or process at most one eligible message:
npm run mail:once
```

Development defaults to private `.local/mail/<outbox-id>.eml` captures. These are email artifacts containing credentials, never application logs; keep them private. SMTP is implemented and tested locally; external delivery requires your SMTP settings. Production requires explicit SMTP configuration and verified TLS. The HTTP app never starts the worker automatically.

Docker alternative: configure `.env`, run `auth:keys`, then `docker compose up -d --wait`, migrate and start. Use one database option at a time because both default to port 55432. For compiled processes: `npm run build`, then `npm start` and `npm run mail:worker:prod` separately.

Health: [liveness](http://localhost:3000/api/v1/health/live), [readiness](http://localhost:3000/api/v1/health/ready). Documentation: [Swagger](http://localhost:3000/docs), [OpenAPI JSON](http://localhost:3000/docs/openapi.json).

## Authentication and recovery

- Registration, expiring single-use email verification/resend and salted Argon2id login.
- Short-lived JWT bearer access, rotating HttpOnly refresh cookies, CSRF/origin checks and replay revocation.
- Persistent bounded lockout, owned device sessions, logout and logout-all.
- Generic forgot-password, single-use reset, password-confirmed change and automatic revocation of all sessions.
- Password-confirmed self-deactivation and emailed self-reactivation that cannot override an administrative block.
- Encrypted transactional outbox, fenced worker leases, retries, dead letters, private file capture and real SMTP transport.
- Dynamic roles, inheritance and direct permissions, explicit access guards, grant ceilings and protected administration.

Unsafe auth requests require an exact configured Origin. Refresh/logout additionally require cookie-bound `X-CSRF-Token`. Ordinary protected routes require bearer authentication; cookies alone do not authenticate them. Use matching frontend/API hostnames for same-site cookies: with frontend `http://localhost:3001`, call API `http://localhost:3000`.

Development-only token previews remain available without printing credentials:

```powershell
npm run auth:preview -- ada@example.com
npm run auth:recovery-preview -- ada@example.com password_reset
npm run auth:recovery-preview -- ada@example.com account_activation
```

They write ignored private JSON request files; delete them after use. Alternatively use the captured `.eml` messages. The backend renders trusted frontend links with token fragments; the consumer frontend must POST the token to the relevant API. No frontend pages are included.

Read [Phase 5](docs/phase-05.md) for authorization, operator bootstrap and scoped management. The [Phase 4 guide](docs/phase-04.md) covers recovery/mail, [Phase 3](docs/phase-03.md) authentication, [Phase 2](docs/phase-02.md) persistence, and [Phase 1](docs/phase-01.md) infrastructure.

There is no default administrator. Register and verify the intended account first, then explicitly run `npm run authorization:bootstrap -- admin@example.com` with trusted operator database access. This grants the finite system catalog directly to that account without changing its user type. New business permission definitions grant nothing automatically; authorize a first grant with `npm run authorization:grant -- admin@example.com reports.view`. See the guide before delegating authority.

## Validation and operations

```powershell
npm run check:all
npm run db:status
npm run db:schema-check
npm run mail:status
npm audit
```

There are **156 tests**: 63 unit/infrastructure and 93 real PostgreSQL tests, including dynamic authorization, escalation/race protection, administrative boundaries and all earlier auth/recovery/outbox/migration checks. CI provisions disposable PostgreSQL and test keys on Node 22/24; remote CI has not been executed here.

`npm run check` needs configuration but no database connection for its infrastructure tests. `test:database` needs a disposable PostgreSQL server and CREATEDB-capable test role; it creates/drops only owned `foundation_test_<uuid>` databases and never resets the configured application database. Never point tests at production infrastructure.

Delivery is at least once: a crash after SMTP acceptance but before acknowledgement can duplicate a message. Stable Message-ID helps correlation but does not guarantee provider deduplication or inbox arrival. Inspect safe aggregate status and explicitly retry a corrected dead letter with `npm run mail:retry -- <outbox-uuid>`.

Remaining work includes shared throttling, tracing, managed encryption-key rotation/retention, provider bounce handling and deployment/load checks. Current IP throttling is process-local. Production needs separate migration/runtime roles, managed secrets, trusted proxy/ingress setup and backups. Schema changes are never automatic.

The [roadmap](docs/roadmap.md) defines the remaining phases. Manage the isolated Windows database with `npm run db:local -- -Action stop` or `-Action start`. `.env` and `.local` contain private data and are ignored by Git.

## Unified Next.js admin integration

Frontend: E:\nestjs-auth-admin, http://localhost:3001/login. Run npm run dev in that repository after starting this API. One login offers Admin/User options and one shared dashboard uses actual roles/permissions. No public registration UI is provided.

Run npm run db:seed after migrations. Development defaults are admin@example.com / Admin@123456789!. Existing passwords are preserved; existing regular identities are never promoted by the seed. Production requires explicit SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD and rejects default credentials. POST /api/v1/auth/admin/login shares the normal credential/session flow and additionally requires live admin.access. POST /api/v1/auth/login remains the regular-user entry point. Login choice never substitutes for permission checks.

Allow the frontend origin in CORS_ORIGINS and configure MAIL_PUBLIC_URL for verification links. Production HTTPS uses __Host-foundation_refresh; set the same API_REFRESH_COOKIE_NAME in the frontend. Tokens are held by same-origin HttpOnly cookies. The Next.js proxy checks permissions and Nest independently enforces scoped RBAC.
