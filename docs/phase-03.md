# Phase 3: authentication, refresh rotation and session management

Historical phase guide. [Phase 4](phase-04.md) now implements password recovery/change, self-service lifecycle and mail delivery. Use the root README for current startup and worker instructions.

Phase 3 adds working authentication on the Phase 2 database. Password recovery/change, account lifecycle administration and mail delivery remain Phase 4. Dynamic role/permission enforcement remains Phase 5. No schema migration was needed: Phase 2 already contains the required tables, constraints and indexes.

## Architecture and decisions

`AppModule` imports `AuthModule` after core infrastructure. Core owns throttling/configuration/database/logging; AuthModule owns authentication use cases, strategies, guards, DTOs and transport. Services call a transaction-scoped authentication repository. The repository contains database operations and never creates HTTP cookies or signs tokens. The cookie adapter never changes database state. Password hashing and verification-message preparation use explicit injectable ports.

The global guard chain is throttling, then JWT authentication. `@Public()` bypasses only JWT checking: route origin/CSRF/local guards and throttling still execute. Health is explicitly public; future routes require bearer authentication by default. The local guard validates its DTO itself because Nest runs guards before route pipes. The route uses the same validation policy again, preventing unknown fields or invalid types from reaching authentication logic. These are Nest guards/strategies using the project's own interfaces, not Passport adapters.

JWT authentication verifies fixed HS256 algorithm, signature, issuer, audience, expiry and required access-token claims. It then checks the current user/session in one joined query. Inactive, unverified, currently locked, expired or revoked identities are denied immediately on subsequent requests; no permission list is trusted from the JWT. An already executing request may have passed authentication before a concurrent revocation. Mutating session operations recheck actor state under the user lock.

Password policy is 15–128 characters, permitting passphrases and preserving whitespace. Argon2id uses 19 MiB, two iterations and one lane, with independent salts. Unknown users perform dummy hash verification. Native hashing is bounded to four active tasks and 32 queued tasks; overload returns a safe 503. Benchmark work factors and capacity on deployment hardware. See [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) and [node-argon2](https://github.com/ranisalt/node-argon2).

Registration returns the same 202 message for new/existing emails and hashes before attempting the insert. Only new users receive a verification record and encrypted outbox entry, atomically. Public input cannot assign user type, roles, verified state or account status. Verification consumes a purpose-specific, expiring, random token once under a user row lock. Resend is generic, IP-throttled, and enforces a persistent 60-second per-recipient cooldown. Comparable processing reduces obvious timing differences but is not a constant-time database/API guarantee.

## Responsibilities

| File/group                                       | Responsibility                                                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `core/config/auth-config.service.ts`             | Typed key material, JWT identity/lifetimes, verification lifetime, lock policy and cookie security.                  |
| `core/config/environment.ts`                     | Startup validation; requires three distinct canonical base64 32-byte keys and bounded TTL/lock settings.             |
| `auth/auth.module.ts`                            | Binds crypto/message ports, use cases and strategies; registers the global JWT guard.                                |
| `auth/controllers/auth.controller.ts`            | Validated HTTP contracts and transport orchestration; never performs database operations.                            |
| `auth/dto/auth.dto.ts`                           | Request and response DTOs, identity normalization, password/token limits and Swagger models.                         |
| `auth/interfaces/auth.types.ts`                  | Minimal principal, internal login proof, device/issued-credential types and injectable ports.                        |
| `auth/repositories/authentication.repository.ts` | Scoped lookups/row locks, atomic writes, token lineage, outbox insertion, principal joins and owned session listing. |
| `auth/services/registration.service.ts`          | Registration, verification and resend use cases.                                                                     |
| `auth/services/session-auth.service.ts`          | Session issuance, refresh rotation/replay handling, cookie logout and owned/all-session revocation.                  |
| `auth/strategies/local.strategy.ts`              | Password verification, durable failed attempts/lockout and an internal credential stamp.                             |
| `auth/strategies/jwt.strategy.ts`                | Token verification plus current database principal lookup.                                                           |
| `auth/guards/*.ts`                               | JWT default denial, explicit local login, origin checks and cookie-CSRF checks.                                      |
| `auth/decorators/auth.decorators.ts`             | `Public` metadata and fail-closed `CurrentUser` principal access.                                                    |
| `auth/crypto/argon-password-hasher.ts`           | Salted Argon2id and bounded native-work queue.                                                                       |
| `auth/crypto/access-token.service.ts`            | Fixed-algorithm signing/verification and mandatory claims.                                                           |
| `auth/crypto/opaque-token.ts`                    | CSPRNG 256-bit tokens and SHA-256 digests.                                                                           |
| `auth/transport/session-cookies.ts`              | Refresh-cookie parsing/writing/clearing and session-bound HMAC CSRF tokens.                                          |
| `notifications/verification-message.factory.ts`  | AES-256-GCM verification payload encryption with recipient/template/key-ID binding.                                  |
| `common/http/validation.pipe.ts`                 | One validation policy shared by bootstrap and the local guard.                                                       |
| `common/http/api-success.decorator.ts`           | Swagger schemas matching actual `{ success, data }` responses.                                                       |
| `scripts/auth-keys.ts`                           | Generates missing local keys without printing or replacing existing keys.                                            |
| `scripts/verification-preview.ts`                | Development-only decryption into a private ignored request file, never an HTTP endpoint or token log.                |
| `test/database/authentication.db-spec.ts`        | Real PostgreSQL HTTP/use-case tests with the actual guard chain and crypto.                                          |
| `auth/crypto/auth-crypto.spec.ts`                | Password, JWT, opaque-token, cookie/CSRF and authenticated-encryption tests.                                         |
| `test/support/auth-settings.ts`                  | Public deterministic test-only keys; CI uses equivalent disposable test configuration.                               |

The complete current source/configuration layout appears at the end of this guide. Every implementation is in the named TypeScript file; no pseudo-implementation is required to run the examples.

## Rotation, locking and revocation

All authentication mutations lock user first, then session, with token re-reads after those locks. Password verification runs outside locks to avoid holding a database connection/row lock during Argon work. Successful local authentication carries an internal credential stamp; session creation rechecks that stamp and account state under the lock, closing the password-change gap.

Refresh tokens are opaque random secrets. Only SHA-256 digests are stored in token tables. Each session is a family with a fixed absolute expiry; rotation does not extend that lifetime. A refresh transaction consumes the old record, inserts one successor with `parent_id`, updates last-seen and signs a short-lived access token. The database additionally enforces one successor per parent and same-session lineage.

Reusing a consumed token revokes the session and all its refresh records. The transaction returns a failure sentinel, **commits revocation**, and only then throws 401. Throwing inside the transaction callback would incorrectly roll back the security action. Failed-login counters follow the same commit-before-401 rule.

Concurrent refreshes intentionally use a strict policy: one request rotates; reuse of the previous token revokes the family, including the winner's access token on its next check. Clients must serialize refresh across requests/tabs. There is no grace window or idempotent refresh retry; a lost rotation response can require login again. Do not purge consumed records while their family is active, because those records detect replay.

Logout also takes user/session locks and can revoke through a consumed refresh token. Therefore refresh/logout races cannot leave a live successor. Logout is idempotent for a well-formed cookie with valid CSRF even after revocation. Owned/all-session revocation uses the same ordering. Access JWTs contain only subject/session identity, token purpose and standard claims; revocation is checked against the database on every authenticated request.

## Cookie and CSRF contract

The refresh token is returned only through a host-only HttpOnly cookie. In production it is `__Host-foundation_refresh`, Secure, SameSite=Strict and Path=/, with no Domain attribute. Development HTTP uses `foundation_refresh`, with Secure disabled. Access/CSRF tokens are returned in JSON. Keep access/CSRF tokens in application memory; refresh credentials remain HttpOnly.

Every unsafe auth request requires an exact permitted `Origin`; missing, `null`, unknown and explicitly cross-site fetches are rejected. CLI clients must send the configured Origin too. Bearer-authenticated GETs do not require Origin. These choices support same-site frontends, including different local ports; cross-site cookie deployments require a separate reviewed policy.

Refresh/logout additionally require `X-CSRF-Token`: an HMAC over the presented refresh token, using a separate CSRF key. It changes on rotation and is checked in constant time. `POST /auth/csrf` recovers it after a page reload using the HttpOnly cookie and permitted Origin; it does not mutate session state or authenticate a nonexistent cookie. Origin/CORS and SameSite prevent an untrusted browser page from reading the bootstrap result. Non-browser callers can forge Origin, but still need the refresh credential. See [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

Cookie credentials never authenticate ordinary protected routes. Those require an explicit bearer token. Logout-all and device revocation use bearer authentication plus permitted Origin rather than cookie authentication. Auth responses/errors are `Cache-Control: no-store`. Request logs omit bodies, cookies, authorization, arbitrary headers, URLs and query strings.

## Installation and configuration

The added packages are `@nestjs/jwt@11`, `argon2@0.45.2` and `cookie@1`. JWT 11 matches the existing CommonJS/Nest 11 toolchain. Use the lockfile:

```powershell
cd E:\nestjs-auth-foundation
npm ci --ignore-scripts
npm run auth:keys
npm run db:local
npm run db:migrate
npm run start:dev
```

The current workspace already has keys, a running isolated PostgreSQL cluster and current migrations. The key command writes `.env`, generates missing keys and preserves existing ones. Never regenerate deployed outbox keys without retaining the keys needed for queued messages. The current message reader supports the configured key ID only; managed key-ring rotation is future operational work.

For Docker, run `auth:keys` first, then `docker compose up -d --wait`, migrate and start. Do not run Docker and the Windows cluster on the same port. For production supply keys from managed secrets, not the development key-generation command. Test/CI keys are intentionally public and must never be deployed.

| Variable                        | Default/rule                                                    |
| ------------------------------- | --------------------------------------------------------------- |
| `AUTH_JWT_KEY`                  | Required distinct canonical base64-encoded 32-byte signing key. |
| `AUTH_CSRF_KEY`                 | Required independent 32-byte CSRF key.                          |
| `AUTH_OUTBOX_KEY`               | Required independent 32-byte AES key.                           |
| `AUTH_OUTBOX_KEY_ID`            | `local-v1`; bounded key identifier.                             |
| `AUTH_JWT_ISSUER`               | `auth-foundation`.                                              |
| `AUTH_JWT_AUDIENCE`             | `foundation-api`.                                               |
| `AUTH_ACCESS_TTL_SECONDS`       | 900; bounded 60–900.                                            |
| `AUTH_REFRESH_TTL_SECONDS`      | 604800; absolute session lifetime, bounded 3600–2592000.        |
| `AUTH_VERIFICATION_TTL_SECONDS` | 3600; bounded 300–86400.                                        |
| `AUTH_LOGIN_MAX_ATTEMPTS`       | 5; bounded 3–20.                                                |
| `AUTH_LOCK_SECONDS`             | 900; bounded 60–3600.                                           |

Account lockout is persisted and bounded. Active locks are not extended on each attempt; after expiry, a new attempt begins a fresh counter window. Successful login clears counters. Locking also denies current bearer/refresh access. Account lockout can itself be abused for denial of service; Phase 4 will extend policy/recovery, and deployment needs shared ingress/rate controls. The current IP throttler remains process-local, while account counters and verification cooldowns are database-backed.

## Implemented API

All paths below start with `/api/v1/auth`.

| Method/path                  | Authentication                                          | Result                                            |
| ---------------------------- | ------------------------------------------------------- | ------------------------------------------------- |
| `POST /register`             | Public + Origin; 5/min/IP                               | 202 generic registration message.                 |
| `POST /verification/request` | Public + Origin; 3/min/IP + recipient cooldown          | 202 generic message.                              |
| `POST /verify-email`         | Public + Origin + token body; 10/min/IP                 | 204, single-use verification.                     |
| `POST /login`                | Local credentials + Origin; 10/min/IP + account lockout | 200 credentials envelope and refresh cookie.      |
| `POST /csrf`                 | Refresh cookie + Origin                                 | 200 CSRF token envelope.                          |
| `POST /refresh`              | Cookie + Origin + CSRF; 20/min/IP                       | 200 new credentials/cookie, or 401.               |
| `POST /logout`               | Cookie + Origin + CSRF                                  | 204 and cleared cookie.                           |
| `POST /logout-all`           | Bearer + Origin                                         | 204, all sessions revoked.                        |
| `GET /me`                    | Bearer                                                  | Minimal current principal.                        |
| `GET /sessions`              | Bearer                                                  | Owned `{ data, meta }` page; safe device summary. |
| `DELETE /sessions/:id`       | Bearer + Origin                                         | 204 for owned session; 404 otherwise.             |

Session listing supports bounded page/limit and `createdAt`/`lastSeenAt` sorting. Search is explicitly unsupported. No IP address, raw user agent, password hash or token digest is returned. All JSON success responses use the existing envelope except the page contract; 204 responses have no body. Swagger documents envelope schemas, bearer/cookie schemes and CSRF headers.

## Practical local walkthrough

Start the app, then in another PowerShell terminal:

```powershell
$base = 'http://localhost:3000/api/v1/auth'
$headers = @{ Origin = 'http://localhost:5173' }
$email = 'ada@example.com'
$password = 'A long development passphrase!'
$body = @{ email = $email; password = $password } | ConvertTo-Json
Invoke-RestMethod "$base/register" -Method Post -Headers $headers -ContentType application/json -Body $body
```

There is no mail sender yet. Registration durably queues an encrypted message; it does not claim that an email was delivered. For development only, create a private verification request file:

```powershell
npm run auth:preview -- ada@example.com
$preview = Get-Content .local/verification-preview.json -Raw | ConvertFrom-Json
$verifyBody = @{ token = $preview.token } | ConvertTo-Json
Invoke-RestMethod "$base/verify-email" -Method Post -Headers $headers -ContentType application/json -Body $verifyBody
Remove-Item -LiteralPath .local/verification-preview.json
```

The preview refuses production mode, never prints a token, and does not mark mail delivered. It overwrites its private preview file with the newest queued message for the specified address; treat that file as a credential and delete it after use. Applications must never expose this operation as an HTTP endpoint. A resend can be requested after the cooldown if the verification token expires.

Login and refresh while retaining cookies:

```powershell
$login = Invoke-RestMethod "$base/login" -Method Post -Headers $headers -ContentType application/json -Body $body -SessionVariable browserSession
$bearer = @{ Authorization = "Bearer $($login.data.accessToken)" }
Invoke-RestMethod "$base/me" -Headers $bearer
$headers['X-CSRF-Token'] = $login.data.csrfToken
$rotation = Invoke-RestMethod "$base/refresh" -Method Post -Headers $headers -WebSession $browserSession
$headers['X-CSRF-Token'] = $rotation.data.csrfToken
Invoke-RestMethod "$base/logout" -Method Post -Headers $headers -WebSession $browserSession
```

For browser fetch use `credentials: 'include'` on login/CSRF/refresh/logout and set `X-CSRF-Token` from the latest response. After reload obtain it with POST `/csrf`. Serialize refresh across tabs/requests; do not retry a consumed refresh token. Swagger UI has a different origin from the sample frontend, so its mutation requests also require a deliberately permitted origin. Do not weaken the origin policy just to bypass a tooling error.

## Verification, limits and mistakes

```powershell
npm run check:all
npm run db:status
npm run db:schema-check
npm audit
```

The full suite includes infrastructure/crypto unit tests and real PostgreSQL tests. Auth HTTP tests use the actual guards, hashing, signatures, transaction locks and encrypted outbox; fresh application instances isolate rate counters. The database harness creates/drops only owned test databases, and application pools close during teardown. Coverage includes generic registration/races, queue rollback, verification expiry/replay/races, refresh lineage/replay/concurrency, CSRF/origin/cookie contracts, logout races, device ownership, logout-all, account-state denial, persisted lockout, credential-change proof rejection, expiry, input/privilege rejection and public-route throttling. CI includes explicit disposable authentication keys; remote CI is configured but has not been executed here.

No new database tables or automatic migration behavior were introduced. Existing migrations remain current and ORM metadata still matches the schema. SQL access is confined to the repository; crypto work happens outside database locks. Authentication queries use existing identity/digest/owner indexes and one joined principal lookup instead of N+1 relations. User-level write serialization favors correctness; measure contention before introducing narrower locks and preserve a consistent ordering across password reset/revocation workflows.

Common mistakes: throwing a 401 before committing replay revocation or failed attempts; allowing two refresh successors; caching session validity without invalidation; returning refresh tokens in JSON; trusting `Public` to skip all guards; running login strategy before DTO validation; logging request/driver payloads; silently normalizing passwords; returning entities as response DTOs; or enabling a development verification preview in production.

Phase 4 still needs password reset/change, lifecycle administration, broader lock/recovery policy and delivery/outbox worker operations. Phase 5 adds dynamic role/permission guards and management. Phase 6 covers distributed limits, operational tracing, managed key rotation, cleanup/retention jobs and deployment/load checks. This phase is a working authentication foundation, not a claim that the full multi-phase system is finished.

## Complete current layout

```text
nestjs-auth-foundation/
├── .github
│   └── workflows
│       └── ci.yml
├── docs
│   ├── phase-01.md
│   ├── phase-02.md
│   ├── phase-03.md
│   └── roadmap.md
├── scripts
│   ├── auth-keys.ts
│   ├── database.ts
│   ├── local-postgres.ps1
│   └── verification-preview.ts
├── src
│   ├── common
│   │   ├── errors
│   │   │   ├── api-exception.filter.ts
│   │   │   ├── application.exception.ts
│   │   │   ├── database-error.spec.ts
│   │   │   └── database-error.ts
│   │   ├── http
│   │   │   ├── api-success.decorator.ts
│   │   │   ├── response.decorator.ts
│   │   │   ├── response.interceptor.ts
│   │   │   └── validation.pipe.ts
│   │   ├── pagination
│   │   │   ├── page-query.dto.ts
│   │   │   ├── page.spec.ts
│   │   │   └── page.ts
│   │   └── persistence
│   │       ├── base.entity.ts
│   │       └── base.repository.ts
│   ├── core
│   │   ├── config
│   │   │   ├── auth-config.service.ts
│   │   │   ├── database-config.service.ts
│   │   │   ├── environment.spec.ts
│   │   │   ├── environment.ts
│   │   │   ├── load-cli-config.ts
│   │   │   ├── runtime-config.module.ts
│   │   │   └── runtime-config.service.ts
│   │   ├── database
│   │   │   ├── migrations
│   │   │   │   ├── 1795146450469-InitialIdentitySchema.ts
│   │   │   │   └── 1795146450470-RoleHierarchyIntegrity.ts
│   │   │   ├── data-source.ts
│   │   │   ├── database.module.ts
│   │   │   ├── database.options.ts
│   │   │   ├── entities.ts
│   │   │   └── unit-of-work.ts
│   │   ├── logging
│   │   │   ├── app-logger.service.ts
│   │   │   ├── logging.module.ts
│   │   │   ├── logging.options.ts
│   │   │   └── logging.spec.ts
│   │   └── core.module.ts
│   ├── features
│   │   ├── auth
│   │   │   ├── controllers
│   │   │   │   └── auth.controller.ts
│   │   │   ├── crypto
│   │   │   │   ├── access-token.service.ts
│   │   │   │   ├── argon-password-hasher.ts
│   │   │   │   ├── auth-crypto.spec.ts
│   │   │   │   └── opaque-token.ts
│   │   │   ├── decorators
│   │   │   │   └── auth.decorators.ts
│   │   │   ├── dto
│   │   │   │   └── auth.dto.ts
│   │   │   ├── entities
│   │   │   │   ├── email-verification-token.entity.ts
│   │   │   │   └── password-reset-token.entity.ts
│   │   │   ├── guards
│   │   │   │   ├── csrf.guard.ts
│   │   │   │   ├── jwt-authentication.guard.ts
│   │   │   │   ├── local-authentication.guard.ts
│   │   │   │   └── origin.guard.ts
│   │   │   ├── interfaces
│   │   │   │   └── auth.types.ts
│   │   │   ├── repositories
│   │   │   │   └── authentication.repository.ts
│   │   │   ├── services
│   │   │   │   ├── registration.service.ts
│   │   │   │   └── session-auth.service.ts
│   │   │   ├── strategies
│   │   │   │   ├── jwt.strategy.ts
│   │   │   │   └── local.strategy.ts
│   │   │   ├── transport
│   │   │   │   └── session-cookies.ts
│   │   │   └── auth.module.ts
│   │   ├── authorization
│   │   │   ├── entities
│   │   │   │   ├── permission.entity.ts
│   │   │   │   ├── role-inheritance.entity.ts
│   │   │   │   ├── role-permission.entity.ts
│   │   │   │   ├── role.entity.ts
│   │   │   │   ├── user-permission.entity.ts
│   │   │   │   └── user-role.entity.ts
│   │   │   ├── repositories
│   │   │   │   ├── permissions.repository.ts
│   │   │   │   └── roles.repository.ts
│   │   │   └── authorization.module.ts
│   │   ├── health
│   │   │   ├── database-health.indicator.ts
│   │   │   ├── health.controller.ts
│   │   │   ├── health.module.ts
│   │   │   └── lifecycle.service.ts
│   │   ├── notifications
│   │   │   ├── entities
│   │   │   │   └── mail-outbox.entity.ts
│   │   │   └── verification-message.factory.ts
│   │   ├── sessions
│   │   │   ├── entities
│   │   │   │   ├── refresh-token.entity.ts
│   │   │   │   └── session.entity.ts
│   │   │   ├── repositories
│   │   │   │   └── sessions.repository.ts
│   │   │   └── sessions.module.ts
│   │   └── users
│   │       ├── entities
│   │       │   └── user.entity.ts
│   │       ├── interfaces
│   │       │   └── users-repository.interface.ts
│   │       ├── repositories
│   │       │   └── typeorm-users.repository.ts
│   │       └── users.module.ts
│   ├── app.module.ts
│   ├── main.ts
│   └── setup-app.ts
├── test
│   ├── database
│   │   ├── authentication.db-spec.ts
│   │   ├── database-harness.ts
│   │   └── persistence.db-spec.ts
│   ├── support
│   │   ├── auth-settings.ts
│   │   └── test-application.ts
│   └── foundation.e2e-spec.ts
├── .env.example
├── .gitignore
├── .prettierignore
├── .prettierrc.json
├── compose.yaml
├── eslint.config.mjs
├── jest.config.cjs
├── jest.database.config.cjs
├── package-lock.json
├── package.json
├── README.md
├── tsconfig.build.json
└── tsconfig.json
```
