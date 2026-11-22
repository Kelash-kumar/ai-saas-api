# Phase 4: recovery, account lifecycle and durable mail

Historical phase guide. [Phase 5](phase-05.md) now provides dynamic authorization and permission-protected administrative management; use the root working guide for current counts and bootstrap instructions.

Phase 4 implements forgot/reset/change password, self-deactivation/reactivation, shared lockout policy, and a separate durable mail worker. Administrative account management remains behind the permission controls introduced in Phase 5; there is no unprotected endpoint for changing another user's status.

## Architectural decisions

`AuthModule` imports `NotificationsModule`, which exports encrypted message factories through explicit ports. Recovery and lifecycle services call a transaction-scoped `RecoveryRepository`. Controllers validate DTOs and manage cookie clearing; they do not query the database. `PasswordConfirmation` performs native hashing outside database locks and rechecks credentials, account state and the acting session under locks. The pure account-lock policy is shared with the local-login strategy.

`MailWorkerModule` is a separate application context with configuration, logging, database infrastructure, message codec, renderer, repository and an injected transport. The HTTP app never runs a delivery loop. Registration/recovery commits encrypted messages with token/account changes and returns without waiting for SMTP. Provider outages therefore do not roll back a valid registration or reset request.

The development transport writes private `.eml` captures under `.local/mail`. The SMTP adapter uses Nodemailer 10 with verified TLS, bounded connection/socket/deadline handling, AbortSignal cancellation and disabled protocol/body logging. It has been tested against a local SMTP capture server, not an external provider account. See [Nodemailer SMTP documentation](https://nodemailer.com/smtp) and [OWASP password recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

## Responsibilities

| File/group                                                   | Responsibility                                                                                                                                                    |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth/controllers/recovery.controller.ts`                    | Recovery/lifecycle HTTP contracts, throttles, origin guard, current-user access and cookie clearing.                                                              |
| `auth/dto/recovery.dto.ts`                                   | Bounded current/new password and opaque-token input. New password policy remains 15–128 characters with whitespace preserved.                                     |
| `auth/services/password-recovery.service.ts`                 | Generic forgot requests, atomic single-use reset and authenticated password change.                                                                               |
| `auth/services/account-lifecycle.service.ts`                 | Password-confirmed self-deactivation and email-token self-reactivation.                                                                                           |
| `auth/services/password-confirmation.service.ts`             | Reauthentication proof preparation, stale-proof/session rejection and committed failed attempts.                                                                  |
| `auth/policies/account-lock.policy.ts`                       | Shared bounded failed-attempt/lock-duration calculation. Active locks are checked before this policy is called.                                                   |
| `auth/repositories/recovery.repository.ts`                   | Purpose-selected token persistence, cooldowns, supersession, invalidation, credential/status changes and outbox insertion. Reuses existing auth locks/revocation. |
| `auth/entities/account-activation-token.entity.ts`           | Separate activation-token purpose, digest/expiry/consumption constraints and user FK.                                                                             |
| `users/entities/user.entity.ts`                              | Adds nullable `deactivationSource`: self, administrative or legacy/unspecified.                                                                                   |
| `notifications/interfaces/mail.types.ts`                     | Message/transport ports, template union and safe failure codes.                                                                                                   |
| `notifications/encrypted-messages.ts`                        | Authenticated encryption bound to template, recipient and key ID; remains compatible with Phase 3 verification ciphertext.                                        |
| `notifications/verification-message.factory.ts`              | Compatibility adapter for the existing verification-message port.                                                                                                 |
| `notifications/notifications.module.ts`                      | Binds codec/message providers without starting delivery.                                                                                                          |
| `notifications/mail.renderer.ts`                             | Fixed text templates and trusted frontend links using URL fragments rather than token queries.                                                                    |
| `notifications/repositories/outbox.repository.ts`            | Short claim transactions, SKIP LOCKED, leases, fenced acknowledgements, backoff/dead state and obsolete-token checks.                                             |
| `notifications/outbox.worker.ts`                             | Decrypt → validate → render → deliver → acknowledge orchestration, with safe retry classification.                                                                |
| `notifications/transports/*.ts`                              | Private atomic file capture and real SMTP adapter behind the same transport port.                                                                                 |
| `notifications/entities/mail-outbox.entity.ts`               | Adds lease UUID/expiry and dead-letter timestamp, with paired lease-state check.                                                                                  |
| `notifications/mail-worker.module.ts`, `main-mail-worker.ts` | Separate worker composition/entry, bounded polling, one-shot mode and graceful stop.                                                                              |
| `core/config/mail-config.service.ts`, `environment.ts`       | Typed mail settings, production transport/TLS/URL requirements and bounded retry/lease/timeouts.                                                                  |
| Phase 4 migrations                                           | Add activation table/status provenance/lease fields and rebuild the pending partial index.                                                                        |
| `scripts/recovery-preview.ts`                                | Private development-only reset/activation request preview, without printing tokens.                                                                               |
| `scripts/outbox.ts`                                          | Aggregate status and explicit dead-letter retry; no message bodies/recipients printed.                                                                            |
| Recovery/outbox database specs                               | Real PostgreSQL use-case/HTTP, race, lease/retry and local SMTP tests.                                                                                            |

Module dependencies are one-way: Auth → Notifications ports, scoped repositories → entity mappings, Worker → Notifications + Core infrastructure. No worker depends on HTTP controllers, and no use case depends on SMTP. A failed message preparation/insert rolls back its associated token/password/account changes.

## Credential and token behavior

Forgot-password always returns the same 202 message for eligible, unknown, unverified and inactive identities, with dummy Argon verification on every request. Only verified active accounts receive a reset message. Locked active accounts are eligible: email recovery is the path out of lockout. Requests alone never change passwords, unlock accounts or revoke sessions.

Reset tokens are cryptographically random, stored as SHA-256 digests in their own table, and expire after the configured lifetime. A persistent per-user 60-second issuance cooldown applies under a user row lock. A new request consumes outstanding older reset tokens. Reset re-reads the token after taking that same lock, rejects consumed/expired/wrong-purpose tokens, changes the Argon2id hash, clears lock state, consumes all recovery/activation tokens, revokes all sessions/refresh credentials and queues a security notice in one transaction. It never logs the user in automatically. Invalid reset attempts do not lock an account.

Password change requires bearer authentication, permitted Origin and the current password. Hash verification and the replacement hash computation occur outside database locks. The transaction checks the prepared hash against the current record and checks the actor's session before changing anything. Incorrect confirmations increment the shared persistent lockout counter; their 401 is thrown after commit. A stale proof following a credential change is rejected without penalizing the replacement credential. Successful change revokes all sessions, including the caller, and invalidates pending recovery tokens. The client must log in again.

Recovery/reset races, refresh/reset races and notification failures are tested. All mutators follow user → session locking order, so a refresh that races a reset cannot leave a live successor. Request-time JWT checks still apply; in-flight mutations recheck state in their transaction.

## Account lifecycle boundaries

Self-deactivation requires a current valid bearer session and password confirmation. It sets inactive/self status, invalidates recovery tokens, revokes every session, and queues a notification. Public reactivation requests return a generic response, with the same dummy verification and persistent cooldown pattern as password recovery.

Only verified users with `status=inactive` and `deactivationSource=self` can receive/use an activation token. Activation tokens have a separate table/purpose and are consumed once. Activation clears locks and sets the account active, but does not resurrect prior sessions or automatically issue credentials. The user must log in again.

Administrative or legacy/unspecified inactive records cannot be reactivated by this flow. Even an already issued self-reactivation token is rejected if an administrator has changed the deactivation source. Future administrative services must set source to `administrative`, invalidate outstanding tokens and revoke sessions under the same user lock; Phase 5 will provide the permission-protected management boundary. Do not use a raw status-only database update as an administrative workflow.

## Durable delivery semantics

A worker claims **one** eligible row in a short transaction using `FOR UPDATE SKIP LOCKED`, increments its durable attempt count, assigns a fresh lease UUID and computes expiry from database time. SMTP/file work happens after that transaction commits. Other workers can claim different jobs without waiting on delivery. Claims and acknowledgements never hold user locks.

Every completion/failure update includes both job ID and lease UUID. An old worker cannot acknowledge or overwrite a row reclaimed after expiry. Ownership is checked again immediately before sending. Expired leases are recoverable; a crash during the final permitted attempt is moved to dead state when another worker polls. The partial pending index excludes processed and dead rows. A hand-written migration updates its predicate because TypeORM's schema differ does not detect an existing index-predicate change.

Transient failures use bounded exponential backoff plus jitter; permanent SMTP 5xx rejection, invalid payload/key/template, or exhausted attempts become dead letters. Only safe fixed codes are stored, never SMTP responses, raw exception messages, passwords or bodies. Workers skip expired/consumed/ineligible token messages as `OBSOLETE`. A race after that check can still deliver an obsolete link; the API remains authoritative and rejects it.

Delivery is **at least once**. If the provider accepts mail and the worker crashes before acknowledgement, retry can deliver a duplicate. SMTP uses a stable Message-ID per outbox UUID, but provider deduplication is not guaranteed. File capture uses a stable filename and atomic replacement. `processedAt` means provider/capture acceptance or an obsolete skip; it does not guarantee inbox delivery. Bounce/complaint handling and retention/monitoring are later operational work.

## Database changes and installation

Two forward migrations are included:

- `1795149291751-AccountRecoveryAndOutboxLeases.ts`: activation tokens, user deactivation provenance and outbox lease/dead fields with constraints.
- `1795149291752-OutboxPendingIndex.ts`: live pending-job partial index, with a matching down migration.

The local development database has been migrated forward. Complete rollback/reapply is tested only in owned disposable databases, including schema matching and the actual partial-index predicate. Existing verification messages remain readable with the existing configured key.

```powershell
cd E:\ai-saas-api
npm ci --ignore-scripts
npm run auth:keys
npm run db:local
npm run db:migrate
npm run start:dev
```

In another terminal, start the separate delivery worker:

```powershell
cd E:\ai-saas-api
npm run mail:worker
# Or process at most one eligible message:
npm run mail:once
```

The worker defaults to private file capture. It is not started automatically with the HTTP app. `npm run build` produces both server entries; compiled commands are `npm start` and `npm run mail:worker:prod`. Despite its script name, the compiled worker still selects the configured transport; production configuration requires SMTP.

Nodemailer is a runtime dependency; smtp-server is test-only for local SMTP acceptance/rejection/timeout testing. No external messages or credentials are needed for tests. Existing PostgreSQL 17 binaries or the previous Docker configuration remain supported.

## Configuration

| Setting                                | Default/rule                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_RESET_TTL_SECONDS`               | 1800; 300–3600.                                                                                                                                      |
| `AUTH_ACTIVATION_TTL_SECONDS`          | 3600; 300–86400.                                                                                                                                     |
| `MAIL_TRANSPORT`                       | `file` in development/test; must explicitly be `smtp` in production.                                                                                 |
| `MAIL_FROM`                            | Development `no-reply@example.test`; required mailbox in production.                                                                                 |
| `MAIL_PUBLIC_URL`                      | Development `http://localhost:5173`; required trusted HTTPS base in production, without credentials/query/fragment. Never derived from request Host. |
| `MAIL_SMTP_HOST`                       | Required for SMTP; development file mode has a loopback fallback.                                                                                    |
| `MAIL_SMTP_PORT`                       | 587, valid TCP port.                                                                                                                                 |
| `MAIL_SMTP_SECURE`                     | false; true for implicit TLS, usually port 465.                                                                                                      |
| `MAIL_SMTP_REQUIRE_TLS`                | true for required STARTTLS. Production requires implicit TLS or required STARTTLS; certificate verification is always enabled.                       |
| `MAIL_SMTP_USER`, `MAIL_SMTP_PASSWORD` | Empty for a trusted relay, otherwise both must be supplied together.                                                                                 |
| `MAIL_TIMEOUT_MS`                      | 5000; 500–10000 for connection/greeting/socket stages; overall delivery deadline is three times this value with cancellation.                        |
| `MAIL_LEASE_MS`                        | 60000; 15000–300000 and at least four timeout units plus 1000 ms.                                                                                    |
| `MAIL_MAX_ATTEMPTS`                    | 5; 1–10, including crashed claims.                                                                                                                   |
| `MAIL_POLL_MS`                         | 1000; 100–60000 between iterations.                                                                                                                  |

All values pass through the same startup validator and injectable typed providers. Production startup fails closed for file transport, untrusted reset URLs, plaintext SMTP policy or incomplete credentials. The SMTP transport never disables certificate verification. Keep the encryption key for outstanding outbox records; this version supports the configured key ID, not a managed multi-key rotation ring.

## API and practical examples

All new endpoints use `/api/v1/auth`. Every unsafe request still requires an exact permitted Origin.

| Method/path                | Required capability                                     | Result                                              |
| -------------------------- | ------------------------------------------------------- | --------------------------------------------------- |
| `POST /forgot-password`    | Email body, public + Origin, 3/min/IP                   | Generic 202 message; persistent recipient cooldown. |
| `POST /reset-password`     | Reset token + `newPassword`, public + Origin, 10/min/IP | 204; all sessions revoked, cookie cleared.          |
| `POST /change-password`    | Bearer + current/new password + Origin, 5/min/IP        | 204; all sessions revoked, cookie cleared.          |
| `POST /deactivate`         | Bearer + current password + Origin, 5/min/IP            | 204; self-deactivated, cookie cleared.              |
| `POST /activation/request` | Email body, public + Origin, 3/min/IP                   | Generic 202 message.                                |
| `POST /activate`           | Activation token + Origin, 10/min/IP                    | 204; requires fresh login afterward.                |

Forgot-password and development preview:

```powershell
$base = 'http://localhost:3000/api/v1/auth'
$headers = @{ Origin = 'http://localhost:5173' }
Invoke-RestMethod "$base/forgot-password" -Method Post -Headers $headers -ContentType application/json -Body '{"email":"ada@example.com"}'
npm run auth:recovery-preview -- ada@example.com password_reset
$request = Get-Content .local/recovery-preview.json -Raw | ConvertFrom-Json
$body = @{ token = $request.token; newPassword = 'A replacement local passphrase!' } | ConvertTo-Json
Invoke-RestMethod "$base/reset-password" -Method Post -Headers $headers -ContentType application/json -Body $body
Remove-Item -LiteralPath .local/recovery-preview.json
```

For a captured message instead, run `mail:worker`/`mail:once` and open the appropriate private `.local/mail/<job-id>.eml`. The link uses `#token=...`; the consumer frontend must extract it and POST JSON to the matching API. This backend does not provide those frontend pages. Do not put tokens into server query strings, logs or analytics.

Authenticated password change, using the Phase 3 login response held in `$login`:

```powershell
$authorized = @{ Origin = 'http://localhost:5173'; Authorization = "Bearer $($login.data.accessToken)" }
$body = @{ currentPassword = 'The current local passphrase!'; newPassword = 'A replacement local passphrase!' } | ConvertTo-Json
Invoke-RestMethod "$base/change-password" -Method Post -Headers $authorized -ContentType application/json -Body $body
# The old access/refresh credentials are now invalid. Login again.
```

Self-deactivation uses `{ "currentPassword": "..." }` with the same bearer/Origin headers. Reactivation begins with POST `activation/request` and an email body. Development preview supports `npm run auth:recovery-preview -- ada@example.com account_activation`, followed by POST `activate` with `{ token }`. The preview refuses production and never prints a token; its ignored output file is a credential and must be deleted after use.

All new paths appear in Swagger. Generic JSON responses use `{ success, data }`; 204 responses remain empty. Existing cookie/CSRF requirements remain unchanged for refresh/logout. New authenticated mutations use bearer plus password confirmation, and public reset/activation uses the mailed purpose-bound capability, not cookie authentication.

## Worker operations and tests

```powershell
npm run mail:status
# After fixing the cause, explicitly requeue one dead-letter UUID:
npm run mail:retry -- <outbox-uuid>
npm run check:all
npm run db:status
npm run db:schema-check
npm audit
```

Status prints aggregate pending/dead/processed/leased counts only. To identify a dead job without exposing content, an operator can query `SELECT id, attempts, last_error_code, dead_at FROM mail_outbox WHERE dead_at IS NOT NULL`. Retry only targets unprocessed dead rows, resets attempts and leaves the encrypted content unchanged. Do not requeue a permanent content/configuration error blindly. These are trusted database-operator commands, not public APIs.

The suite contains 59 unit/infrastructure tests and 61 real PostgreSQL tests. Coverage includes generic cooldown behavior, reset replay/expiry/supersession/purpose isolation, concurrent resets, reset/refresh races, password-confirmation lockout, recovery from lockout, transaction rollback, lifecycle ownership/admin boundaries, no session resurrection, worker concurrency/SKIP LOCKED, lease recovery/fencing, retries/dead letters/crashed final attempts, obsolete tokens, purpose-bound encryption, real local SMTP success/550/stall behavior and private file capture. Existing phases' tests remain enabled. CI runs the full suite with disposable PostgreSQL and keys; remote CI has not been executed from this workspace.

The worker finishes its current bounded operation on SIGINT/SIGTERM and then closes the pool. Give deployment shutdown grace enough time for the maximum SMTP deadline plus database acknowledgement/cleanup; forceful termination is recovered through lease expiry. Throughput is one job per worker iteration by design; scale separate workers after measuring provider limits and database capacity. Network calls never hold row locks. No permission cache, N+1 loading or schema synchronization was added.

Common mistakes: returning account existence in recovery responses; unlocking on a reset request; accepting another token purpose; consuming tokens outside the credential transaction; throwing before committed failed-attempt state; retaining sessions after credential changes; treating self-reactivation as authority to override an administrative block; holding database locks during SMTP; acknowledging without a lease fence; claiming exactly-once SMTP delivery; or printing mail/token/provider payloads in logs.

## Complete current layout

```text
ai-saas-api/
├── .github
│   └── workflows
│       └── ci.yml
├── docs
│   ├── phase-01.md
│   ├── phase-02.md
│   ├── phase-03.md
│   ├── phase-04.md
│   └── roadmap.md
├── scripts
│   ├── auth-keys.ts
│   ├── database.ts
│   ├── local-postgres.ps1
│   ├── outbox.ts
│   ├── recovery-preview.ts
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
│   │   │   ├── mail-config.service.ts
│   │   │   ├── runtime-config.module.ts
│   │   │   └── runtime-config.service.ts
│   │   ├── database
│   │   │   ├── migrations
│   │   │   │   ├── 1795146450469-InitialIdentitySchema.ts
│   │   │   │   ├── 1795146450470-RoleHierarchyIntegrity.ts
│   │   │   │   ├── 1795149291751-AccountRecoveryAndOutboxLeases.ts
│   │   │   │   └── 1795149291752-OutboxPendingIndex.ts
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
│   │   │   │   ├── auth.controller.ts
│   │   │   │   └── recovery.controller.ts
│   │   │   ├── crypto
│   │   │   │   ├── access-token.service.ts
│   │   │   │   ├── argon-password-hasher.ts
│   │   │   │   ├── auth-crypto.spec.ts
│   │   │   │   └── opaque-token.ts
│   │   │   ├── decorators
│   │   │   │   └── auth.decorators.ts
│   │   │   ├── dto
│   │   │   │   ├── auth.dto.ts
│   │   │   │   └── recovery.dto.ts
│   │   │   ├── entities
│   │   │   │   ├── account-activation-token.entity.ts
│   │   │   │   ├── email-verification-token.entity.ts
│   │   │   │   └── password-reset-token.entity.ts
│   │   │   ├── guards
│   │   │   │   ├── csrf.guard.ts
│   │   │   │   ├── jwt-authentication.guard.ts
│   │   │   │   ├── local-authentication.guard.ts
│   │   │   │   └── origin.guard.ts
│   │   │   ├── interfaces
│   │   │   │   └── auth.types.ts
│   │   │   ├── policies
│   │   │   │   ├── account-lock.policy.spec.ts
│   │   │   │   └── account-lock.policy.ts
│   │   │   ├── repositories
│   │   │   │   ├── authentication.repository.ts
│   │   │   │   └── recovery.repository.ts
│   │   │   ├── services
│   │   │   │   ├── account-lifecycle.service.ts
│   │   │   │   ├── password-confirmation.service.ts
│   │   │   │   ├── password-recovery.service.ts
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
│   │   │   ├── interfaces
│   │   │   │   └── mail.types.ts
│   │   │   ├── repositories
│   │   │   │   └── outbox.repository.ts
│   │   │   ├── transports
│   │   │   │   ├── file-mail.transport.ts
│   │   │   │   └── smtp-mail.transport.ts
│   │   │   ├── encrypted-messages.ts
│   │   │   ├── mail-worker.module.ts
│   │   │   ├── mail.renderer.ts
│   │   │   ├── mail.spec.ts
│   │   │   ├── notifications.module.ts
│   │   │   ├── outbox.worker.ts
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
│   ├── main-mail-worker.ts
│   ├── main.ts
│   └── setup-app.ts
├── test
│   ├── database
│   │   ├── authentication.db-spec.ts
│   │   ├── database-harness.ts
│   │   ├── outbox.db-spec.ts
│   │   ├── persistence.db-spec.ts
│   │   └── recovery.db-spec.ts
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
