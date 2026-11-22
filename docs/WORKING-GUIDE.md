# Complete setup, run and API working guide

This guide covers the application as implemented through Phase 5. It is a backend, not a frontend application. It includes authentication, recovery, self-service lifecycle, sessions, delivery, dynamic role/permission guards and scoped administrative management, plus [user/company CRUD](USER-COMPANY-MANAGEMENT.md). See [Phase 5](phase-05.md) for policy semantics and the complete management endpoint reference.

## 1. What you need

| Requirement     | Supported baseline                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| Node.js         | 22.13+ on the 22.x line, or 24.11+; use a supported LTS release.                                          |
| npm             | Included with your Node installation. Use the committed lockfile.                                         |
| PostgreSQL      | Version 17 is used locally and in CI.                                                                     |
| Database option | Installed PostgreSQL binaries, Docker Compose, or a separately provisioned PostgreSQL server. Choose one. |
| API client      | Postman desktop, or Postman web with its Desktop Agent for local requests.                                |
| SMTP account    | Optional for development; required to deliver external mail instead of private file capture.              |

On the current machine the project is at `E:\ai-saas-api`, PostgreSQL 17 binaries are installed, and a separate project-owned cluster runs on `127.0.0.1:55432`. Local `.env` keys and seven database migrations are already configured. The following instructions also explain a fresh checkout.

## 2. Quick start on this Windows workspace

Open PowerShell in the project root:

```powershell
Set-Location E:\ai-saas-api
node --version
npm --version
npm ci --ignore-scripts
npm run auth:keys
npm run db:local
npm run db:migrate
npm run db:seed
npm run db:status
npm run db:schema-check
npm run start:dev
```

Leave the API terminal running. Open a second PowerShell terminal:

```powershell
Set-Location E:\ai-saas-api
npm run mail:worker
```

The API and worker are separate processes. Starting the API does not deliver queued mail. The development worker captures messages in `.local/mail/<outbox-uuid>.eml`; no external mail is sent in file mode.

Open/check:

- [Liveness](http://localhost:3000/api/v1/health/live): HTTP 200 and `status: ok`.
- [Readiness](http://localhost:3000/api/v1/health/ready): HTTP 200 with database/application `up`.
- [Swagger UI](http://localhost:3000/docs).
- [OpenAPI JSON](http://localhost:3000/docs/openapi.json).

The `/` root is not a homepage. A 404 there is expected. All application APIs use `/api/v1`.

## 3. Fresh checkout and database choices

### Option A: installed PostgreSQL on Windows

Run the quick-start commands above. `auth:keys` creates `.env` from `.env.example` when needed, fills missing authentication/encryption keys and preserves existing ones. Run it before database commands, since those commands share configuration validation.

The database helper initializes its own marked data directory under `.local/postgres`, chooses a random database password when the example placeholder is present, and creates `auth_foundation`. It does not install a Windows service, modify the existing PostgreSQL service, or delete data.

For another binary installation:

```powershell
npm run db:local -- -PgBinPath 'C:\Program Files\PostgreSQL\17\bin'
```

The helper expects `DATABASE_HOST=127.0.0.1`, port `55432`, database `auth_foundation`, user `foundation` and SSL false. If your configuration points elsewhere, use Option C rather than changing the helper to administer that server.

### Option B: Docker Compose on Windows/macOS/Linux

From the checkout root:

```text
npm ci --ignore-scripts
npm run auth:keys
```

Edit `.env`: replace `DATABASE_PASSWORD` with a private local password of at least 12 characters. Leave the example host, port, database, user and SSL settings for a host-running API. Then:

```text
docker compose up -d --wait
npm run db:migrate
npm run db:status
npm run start:dev
```

Start `npm run mail:worker` in another terminal. Compose runs PostgreSQL only; it does not containerize the API or mail worker. Do not run the Windows cluster and Compose on the same port. If you change `DATABASE_PORT`, update the API configuration accordingly; Compose reads that port from `.env`.

The volume preserves database data. Editing `POSTGRES_PASSWORD` after the database has initialized does not change the stored PostgreSQL role password; change it through PostgreSQL administration and update `.env` consistently. Use `docker compose stop` and `docker compose start --wait` to stop/start the existing container. Avoid deleting the volume when you intend to keep accounts and data.

### Option C: an existing PostgreSQL server

Run `npm ci --ignore-scripts` and `npm run auth:keys`, then configure `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD` and `DATABASE_SSL` in `.env`.

Have a database administrator provision the database and migration role, or use `npm run db:create` for a development server where the configured role has CREATEDB permission. Skip `db:local` and Compose. Run `db:migrate`, `db:status`, `db:schema-check`, then start the API and worker.

Production should have a DDL-capable migration owner and a separate restricted runtime role. The local/test owner role is not a production runtime account. Tests additionally need a dedicated disposable server and CREATEDB permission.

## 4. Configuration reference

Edit `.env` from the project root, never a generated `dist` file. Restart API/worker processes after changing configuration. Operating-system environment variables override `.env`. Configuration is validated at startup; raw values are not printed in startup errors.

| Variables                                               | Purpose/default                                                                                                                                 |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                              | `development`, `test` or `production`.                                                                                                          |
| `HOST`, `PORT`                                          | API binding, default `127.0.0.1:3000`. Use `0.0.0.0` deliberately for container/network ingress.                                                |
| `APP_NAME`, `LOG_LEVEL`                                 | Service label and structured log verbosity.                                                                                                     |
| `SWAGGER_ENABLED`                                       | Example enables docs; absent/false disables them.                                                                                               |
| `CORS_ORIGINS`                                          | Comma-separated exact frontend origins; example `http://localhost:3001`. No wildcard, path or trailing slash. Production origins require HTTPS. |
| `RATE_LIMIT_TTL_MS`, `RATE_LIMIT_MAX`                   | Global per-route/IP throttle window and limit; auth endpoints have stricter overrides.                                                          |
| `SHUTDOWN_TIMEOUT_MS`                                   | Terminus graceful shutdown delay; not an overall process kill deadline.                                                                         |
| `DATABASE_HOST`, `DATABASE_PORT`                        | PostgreSQL host/port, default loopback/55432.                                                                                                   |
| `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`   | Database identity/credentials; password required, at least 12 characters.                                                                       |
| `DATABASE_SSL`                                          | False locally; must be true with verified certificates in production.                                                                           |
| `DATABASE_POOL_MAX`, `DATABASE_TIMEOUT_MS`              | Bounded pool size and connection/query/statement timeouts; defaults 10 and 3000 ms.                                                             |
| `AUTH_JWT_KEY`, `AUTH_CSRF_KEY`, `AUTH_OUTBOX_KEY`      | Three distinct canonical base64-encoded 32-byte keys. Generated locally by `auth:keys`; supply managed secrets in production.                   |
| `AUTH_OUTBOX_KEY_ID`                                    | Encryption key identifier, default `local-v1`. Keep keys required by queued ciphertext.                                                         |
| `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE`                  | Verified JWT identity; defaults `auth-foundation` and `foundation-api`.                                                                         |
| `AUTH_ACCESS_TTL_SECONDS`                               | Access lifetime, default 900, maximum 900.                                                                                                      |
| `AUTH_REFRESH_TTL_SECONDS`                              | Absolute session lifetime, default 604800; rotation does not extend it.                                                                         |
| `AUTH_VERIFICATION_TTL_SECONDS`                         | Verification token lifetime, default 3600.                                                                                                      |
| `AUTH_RESET_TTL_SECONDS`, `AUTH_ACTIVATION_TTL_SECONDS` | Recovery lifetimes, defaults 1800 and 3600.                                                                                                     |
| `AUTH_LOGIN_MAX_ATTEMPTS`, `AUTH_LOCK_SECONDS`          | Persistent lock policy, defaults 5 failures and 900 seconds.                                                                                    |
| `MAIL_TRANSPORT`                                        | Development `file`, production explicitly `smtp`.                                                                                               |
| `MAIL_FROM`, `MAIL_PUBLIC_URL`                          | Sender and trusted frontend base URL. Production requires an explicit sender and HTTPS base. Never derived from request Host.                   |
| `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT`                      | SMTP connection; host required in SMTP mode, port defaults 587.                                                                                 |
| `MAIL_SMTP_SECURE`, `MAIL_SMTP_REQUIRE_TLS`             | Implicit TLS vs required STARTTLS. Production requires one; certificate validation remains enabled.                                             |
| `MAIL_SMTP_USER`, `MAIL_SMTP_PASSWORD`                  | Both supplied together, or both empty for a permitted trusted relay.                                                                            |
| `MAIL_TIMEOUT_MS`, `MAIL_LEASE_MS`                      | SMTP stage timeout and worker lease; defaults 5000 and 60000 ms. Lease must exceed the validated delivery budget.                               |
| `MAIL_MAX_ATTEMPTS`, `MAIL_POLL_MS`                     | Durable attempt limit and worker polling; defaults 5 and 1000 ms.                                                                               |

`MAIL_PUBLIC_URL` points to the frontend that will consume emailed token fragments and POST JSON to this API. The sibling Next.js application at E:\ai-saas-dashboard implements email verification and the shared dashboard. Use MAIL_PUBLIC_URL=http://localhost:3001 locally. Recovery endpoints remain available through Postman.

## 5. Import Postman

Import these files through Postman's **Import** action:

1. [NestJS-Auth-Foundation.postman_collection.json](../postman/NestJS-Auth-Foundation.postman_collection.json) — the complete collection, including 93 requests and scripted checks. If you previously imported Phase 4, import this updated JSON explicitly; an existing Postman workspace does not update automatically.
2. [Local.postman_environment.json](../postman/Local.postman_environment.json) — optional local input environment.

Select **NestJS Foundation - Local** if using the supplied environment. The collection also works without an environment: set its variables directly. Configure these input values locally:

| Variable                                             | What to enter                                                                                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`                                            | `http://localhost:3000`, without trailing slash or `/api/v1`.                                                                             |
| `origin`                                             | An exact value from `CORS_ORIGINS`, normally `http://localhost:3001`. This is the simulated frontend origin, not necessarily the API URL. |
| `email`                                              | An address for a disposable local test account, e.g. `ada@example.com`. Use your own address when actually sending SMTP mail.             |
| `password`                                           | Initial/current 15–128 character password. No password is shipped.                                                                        |
| `resetPassword`                                      | A different password to use in the reset walkthrough.                                                                                     |
| `newPassword`                                        | Another different password for the authenticated-change walkthrough.                                                                      |
| `deviceName`                                         | Friendly session label, default `Postman desktop`.                                                                                        |
| `verificationToken`, `resetToken`, `activationToken` | Paste the corresponding 43-character mail/preview token only when that step is reached.                                                   |

The optional environment marks credential/token inputs as sensitive. Keep their values local. Runtime `accessToken`, `csrfToken`, `sessionId`, `sessionIds`, `targetSessionId`, `userId`, `roleId`, `permissionId` and `managedUserIds` are saved automatically at **collection scope**. Do not define those same names in an environment, where they would shadow the collection's current state. Management inputs such as `targetUserId` and `inheritedRoleId` are deliberately blank; select them explicitly as described below.

Keep Postman's cookie jar enabled. Login stores the HttpOnly refresh cookie there; refresh replaces it; logout clears it. Do not create a manual Cookie header or copy the refresh token into an environment variable. Scripts inspect only whether an HttpOnly cookie was issued and never print its value. No extra cookie-domain script allowlist is needed, because the collection does not call the cookie-jar scripting API. See [Postman's cookie documentation](https://learning.postman.com/docs/use/send-requests/response-data/cookies/).

The collection builds JSON bodies in pre-request scripts, so quotes, backslashes and whitespace in your passwords are preserved. Tests check expected status/body contracts, update bearer/CSRF state after login/rotation, and update `password` after successful reset/change. Authentication/CSRF tokens and session selections are cleared after sign-out or credential/lifecycle mutations that invalidate them.

Use Postman desktop or its Desktop Agent to reach localhost; a cloud agent cannot reach a service on your machine. Browser-only clients also cannot freely set Origin. Postman is an API client: it does not prove browser SameSite/CORS behavior. For real frontend testing keep frontend/API hostnames consistent, e.g. localhost for both, and use `credentials: 'include'` for cookie flows.

## 6. Complete Postman walkthrough

Send requests individually in the following order. **Do not run the entire collection blindly:** mail-token steps need a manual checkpoint and some requests invalidate credentials. The `01 - Health and documentation` folder is directly runnable in Collection Runner.

### A. Check the service and create an account

1. In `01 - Health and documentation`, send **Liveness**, **Readiness**, and **OpenAPI document**. All expect 200.
2. In `02 - Registration and verification`, send **Register**. Expect generic 202. This does not return a token or guarantee an address was newly created.
3. Obtain the verification token using mail capture or the private preview below.
4. Set `verificationToken` locally and send **Verify email**. Expect empty 204. Its input token is cleared after success.
5. **Request verification email** is an optional resend. A persistent 60-second recipient cooldown applies, even when the response is 202.

Private verification preview, in the project terminal:

```powershell
npm run auth:preview -- ada@example.com
```

Open `.local/verification-preview.json` privately, copy only its `token` into Postman, then delete the file after use. It is disabled in production and does not log the token. Alternatively run the mail worker and open the relevant `.local/mail/<uuid>.eml`. Copy only the token after `#token=` in the link, not the entire link.

Login requires an active, verified, unlocked account. If registration returned 202 for an existing verified account, do not try to verify it again; log in with its current password or use recovery.

### B. Login, access identity and rotate

1. In `03 - Login and refresh`, send **Login**. Expect 200; the script stores access token, CSRF token and session ID.
2. Send **Current user**. Expect the same owned identity and current session ID.
3. Send **Recover CSRF token**. Expect 200 using the refresh cookie and Origin, even without needing an access JWT. This is useful after a client reload.
4. Send **Refresh tokens** once. Expect 200; new access/CSRF values are stored automatically and the cookie jar receives the replacement cookie.

Access tokens are sent using inherited collection bearer auth only on protected requests. Refresh/logout use the cookie plus current CSRF header. Old refresh tokens must not be retried: replay revokes the entire session. Parallel refresh across tabs/requests also triggers that strict policy; serialize refresh in clients.

### C. Device-session management

1. Send **Login** a second time, optionally changing `deviceName`, so the account has another active session.
2. In `04 - Device sessions`, send **List sessions**. It saves session IDs and selects another active session as `targetSessionId`, excluding the currently logged-in session.
3. Send **Revoke selected session**. Expect 204. If there is no second active session, the collection stops with a missing-variable message; create another login and list again.

Listing includes owned revoked/expired history. Deleting a session revokes it; it does not remove the history row. You can manually select your current owned session only if you intend to invalidate its bearer access. Other users' session IDs return 404.

### D. Logout tests

1. In `07 - Sign out`, send **Logout current cookie session**. Expect 204 and cleared client token state.
2. Send **Login** again before protected operations.
3. Send **Logout all sessions** to revoke every account session. It requires bearer auth plus Origin, not the refresh CSRF header. Login again before the next scenario.

### E. Forgot/reset password

1. In `05 - Password recovery and change`, send **Forgot password**. Expect generic 202. Only eligible active verified accounts receive mail; a locked account may use reset to recover.
2. Obtain the reset token:

```powershell
npm run auth:recovery-preview -- ada@example.com password_reset
```

3. Copy the private `.local/recovery-preview.json` token into `resetToken`; ensure `resetPassword` contains your desired replacement.
4. Send **Reset password**. Expect empty 204. The script updates `password` to `resetPassword` and clears bearer/CSRF/session state.
5. Delete the private preview file. Send **Login** with the automatically updated current password.

Reset revokes every session and consumes outstanding recovery tokens. It does not automatically log you in. Unknown, expired, consumed and wrong-purpose tokens fail. Repeated requests within the recipient cooldown return 202 without issuing another token. A later new reset request supersedes older reset tokens.

### F. Authenticated password change

1. Make sure **Login** has succeeded with the current password.
2. Set `newPassword` different from `password`.
3. Send **Change password**. It supplies the current password and bearer token. Expect 204; every session is revoked.
4. The script updates `password` to `newPassword` and clears auth state. Send **Login** again.

Wrong current-password confirmations increment persistent lockout counters. Do not repeatedly rerun them with the wrong value. The collection's safe negative checks do not intentionally lock your account.

### G. Self-deactivation/reactivation

1. In `06 - Account lifecycle`, send **Deactivate my account** with a valid current session/password. Expect 204 and cleared auth state.
2. Send **Request account activation**. Expect generic 202.
3. Obtain an activation token:

```powershell
npm run auth:recovery-preview -- ada@example.com account_activation
```

4. Copy its token into `activationToken`, send **Activate account**, and expect empty 204. Delete the private preview file.
5. Send **Login** again. Old sessions remain revoked; activation never resurrects them.

Only self-deactivated verified accounts are eligible. Administrative or legacy/unspecified inactive records cannot be reactivated by this public flow. Use the original current password; reactivation does not change it.

### H. Safe negative checks

Folder `08 - Safe negative checks` contains expected failures: missing bearer → 401, untrusted origin → 403, invalid login types → 400, and attempted administrator assignment during registration → 400. Passing tests are green even though these responses are intentional 4xx errors. They do not run token-replay attacks or an account-lockout loop.

### I. Bootstrap an operator and use management APIs

First register and verify the intended operator account using section A. Bootstrap requires an existing active, verified, unlocked account. In a trusted terminal connected to the same database as the API:

```powershell
npm run authorization:bootstrap -- ada@example.com
```

This idempotently creates the finite system permission catalog and grants those permissions directly to that account. It does not create an account or change passwords, verification or `userType`. There is no public bootstrap endpoint or magic administrator role. Restrict access to this command and its database credentials.

1. Send **Login** if needed, then **My effective authority** in `09 - Authorization and administration`. Grants and revocations take effect on the next request without refreshing the JWT.
2. Send **List managed users** and choose a disposable target account. Set its UUID as `targetUserId`; the collection never chooses a target for you. Send **Selected user authority** to inspect its current grants.
3. Set `roleName` to a new canonical name (default `postman-role`) and optionally `roleDescription`. Send **Create role**, **List roles**, **Role details** and **Update role description**. Creation/list selection stores `roleId` at collection scope. Role names are immutable.
4. Set `permissionResource=reports`, `permissionAction=view`, then send **Create permission definition** and **List permissions**. Creation stores `permissionId`. Definitions do not grant access. A trusted operator must authorize the first grant before an API caller can delegate it:

```powershell
npm run authorization:grant -- ada@example.com reports.view
```

5. Send **Grant permission to role**, **Assign role to user**, and **Selected user authority**. The selected target now inherits `reports.view`. **Grant direct user permission** adds a separate grant; removing that direct grant alone leaves role-derived access intact.
6. To exercise hierarchy, create a second role, note its UUID, and select the parent again using `roleName` plus **List roles**. Set `inheritedRoleId` to the child UUID and send **Add inherited role**. The parent receives the child's authority. Cycles and out-of-scope grants are rejected. Use **Remove inherited role** to undo it.
7. Use **Revoke direct user permission**, **Remove role from user**, **Revoke permission from role**, and **Delete role** for cleanup. Deletion clears the selected `roleId`; repeat selection for any other disposable role.
8. For account administration, set `managedStatus=inactive` and send **Set administrative user status**. This revokes the target's sessions and blocks self-reactivation. Set `managedStatus=active` and repeat to restore administrative eligibility. Restore preserves password lockout and verification state. **Administratively unlock user** is a separate operation and also revokes target sessions. The target must log in again after these operations.

Keep your operator available while experimenting. Mutations cannot exceed the caller's current permissions; role delegation requires holding the role identity or `roles.delegate`. The service rejects changes that would remove the final eligible recovery manager. Catalog creation grants no authority, and bootstrap never grants future custom definitions automatically. A 403 can indicate missing permission or a delegation ceiling; a 409 can indicate duplicate identity or the final-manager safeguard. A hierarchy cycle returns 400. See [Phase 5](phase-05.md) for exact contracts.

### J. User and company management

The ten CRUD requests are in folder `10 - User and company management`. Rerun operator bootstrap explicitly to grant the new management permissions, then follow the [complete user/company walkthrough](USER-COMPANY-MANAGEMENT.md). That guide covers company assignment, managed user verification, archival and safe cleanup.

## 7. Endpoint reference

| Method | Path                                | Required input/capability                    | Success                          |
| ------ | ----------------------------------- | -------------------------------------------- | -------------------------------- |
| GET    | `/api/v1/health/live`               | Public                                       | 200 raw Terminus JSON            |
| GET    | `/api/v1/health/ready`              | Public, database available                   | 200 raw Terminus JSON            |
| GET    | `/docs/openapi.json`                | Swagger enabled                              | 200 OpenAPI JSON                 |
| POST   | `/api/v1/auth/register`             | Email/password + Origin                      | 202 generic message              |
| POST   | `/api/v1/auth/verification/request` | Email + Origin                               | 202 generic message              |
| POST   | `/api/v1/auth/verify-email`         | Verification token + Origin                  | 204                              |
| POST   | `/api/v1/auth/login`                | Email/password, optional deviceName + Origin | 200 credentials + cookie         |
| GET    | `/api/v1/auth/me`                   | Bearer                                       | 200 principal                    |
| POST   | `/api/v1/auth/csrf`                 | Refresh cookie + Origin                      | 200 CSRF token                   |
| POST   | `/api/v1/auth/refresh`              | Refresh cookie + Origin + CSRF               | 200 rotated credentials + cookie |
| GET    | `/api/v1/auth/sessions`             | Bearer; page/limit/sort query                | 200 page                         |
| DELETE | `/api/v1/auth/sessions/:id`         | Bearer + Origin; owned UUID                  | 204                              |
| POST   | `/api/v1/auth/logout`               | Refresh cookie + Origin + CSRF               | 204                              |
| POST   | `/api/v1/auth/logout-all`           | Bearer + Origin                              | 204                              |
| POST   | `/api/v1/auth/forgot-password`      | Email + Origin                               | 202 generic message              |
| POST   | `/api/v1/auth/reset-password`       | Token/newPassword + Origin                   | 204                              |
| POST   | `/api/v1/auth/change-password`      | Bearer/currentPassword/newPassword + Origin  | 204                              |
| POST   | `/api/v1/auth/deactivate`           | Bearer/currentPassword + Origin              | 204                              |
| POST   | `/api/v1/auth/activation/request`   | Email + Origin                               | 202 generic message              |
| POST   | `/api/v1/auth/activate`             | Activation token + Origin                    | 204                              |

The 20 authorization/administration endpoints under `/api/v1/authorization` are listed with required permissions in [Phase 5](phase-05.md#implemented-apis). All require bearer authentication; unsafe requests also require the configured Origin.

Most successful JSON uses `{ "success": true, "data": ... }`. Paginated lists use `{ data: [], meta: ... }`. Health preserves raw Terminus JSON. A 204 has no response body. Errors use the standardized `success/statusCode/message/errors/timestamp/path/requestId` envelope. Sensitive internal errors are hidden.

## 8. Mail setup and operations

File capture requires no SMTP account. For actual email delivery set SMTP fields in `.env`, for example port 587 with `MAIL_SMTP_SECURE=false`, `MAIL_SMTP_REQUIRE_TLS=true`, or implicit TLS on port 465 with `MAIL_SMTP_SECURE=true`. Set a permitted sender address, provider host and credentials, and restart the worker.

The backend uses a trusted configured frontend URL and fragment tokens. Configure `MAIL_PUBLIC_URL` to the real frontend base before sending externally. Supply SMTP credentials through managed secrets in production. Production does not permit file capture or plaintext SMTP policy.

```powershell
npm run mail:status
npm run mail:once
# After correcting a dead-letter cause, retry that exact UUID:
npm run mail:retry -- <outbox-uuid>
```

`mail:once` processes at most one eligible message, not the whole queue. The continuous worker polls separately. Status reports aggregate counts without recipients or bodies. SMTP acceptance is not guaranteed inbox delivery; a crash after acceptance can produce a duplicate on retry. Stable Message-ID and fenced leases support at-least-once processing. Read [Phase 4](phase-04.md) for delivery semantics and safe dead-letter queries.

## 9. Tests, builds, migrations and stopping

```powershell
npm run check              # Types, lint, format, unit/infrastructure tests, build
npm run test:database      # Real PostgreSQL tests, including local SMTP capture
npm run check:all          # Both groups
npm run db:status
npm run db:schema-check
npm audit
```

Configuration and local keys are needed even for infrastructure tests. Database tests require CREATEDB on a dedicated disposable server; they create fresh owned `foundation_test_<uuid>` databases and drop only those, never resetting the configured application database. The current application suite has 168 tests: 63 unit/infrastructure and 105 PostgreSQL tests. SMTP integration tests use a local capture server and do not send external email. The user/company extension adds the fifth migration; apply it before using this version.

For compiled startup:

```powershell
npm run build
npm start
# In a second terminal:
npm run mail:worker:prod
```

For deployment, run migrations once before starting replicas, with the migration toolchain and DDL credentials. Runtime schema synchronization/migration auto-run is disabled. `db:revert` is not a routine startup/reset command: reverting migrations can remove data. Use reviewed forward migrations for released changes.

Stop API and worker with Ctrl+C in their respective terminals. The worker finishes its bounded current operation and closes the database pool. Stop/start only the project-owned Windows cluster with:

```powershell
npm run db:local -- -Action stop
npm run db:local -- -Action start
```

Do not delete `.local/postgres` or Docker volumes to resolve ordinary login/configuration problems. They hold account data. Clearing `.env` keys can make pending ciphertext unreadable and invalidate JWTs; preserve deployed keys and plan rotation.

## 10. Troubleshooting

| Symptom                                                | Check/fix                                                                                                                                                                                |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup reports invalid configuration                  | Run from project root; compare field names with `.env.example`; run `auth:keys`; restart processes. OS environment overrides the file. Never print the whole config.                     |
| Database initialization failed                         | Start the selected database; check host/port/user/password/SSL. Do not run both local database options on port 55432.                                                                    |
| Readiness 503                                          | Database lost connectivity, users table not migrated, or shutdown started. Run `db:status`/`db:migrate` and check database availability. Liveness does not audit all migration versions. |
| Unknown column/table or SQL 500 after upgrade          | Apply pending migrations before starting new code; check `db:schema-check`.                                                                                                              |
| Origin 403                                             | Set Postman `origin` exactly to a permitted frontend origin. Do not use a trailing slash or substitute API origin unless it is explicitly allowed.                                       |
| CSRF 403                                               | Keep the cookie jar enabled; send current `csrfToken`. Recover it using POST `/csrf` or log in again after a lost/consumed refresh.                                                      |
| Refresh 401 after parallel requests/retry              | Strict replay policy revoked the session. Login again and serialize refresh. Do not reuse a copied old cookie.                                                                           |
| Login 401                                              | Verify email; confirm current password; check active/locked status. Password reset/change logs every session out.                                                                        |
| Register/forgot/activation returns 202 but no new mail | Responses are intentionally generic. Check eligibility, recipient cooldown, worker status and the correct queue/template.                                                                |
| Postman says a variable is missing                     | Set the named input or perform Login first. For mail tokens, complete the private preview/capture checkpoint. Runtime token variables belong at collection scope.                        |
| Revoke selected session is blocked                     | Login twice, then List sessions; the script intentionally refuses to auto-select your current session.                                                                                   |
| 429                                                    | Wait for that route's rate window. Invalid/origin-rejected requests also count. Do not repeatedly run stateful folders.                                                                  |
| No captured mail                                       | Start `mail:worker` or run `mail:once`; check `MAIL_TRANSPORT`, queue status, eligibility and obsolete/dead state.                                                                       |
| SMTP fails                                             | Check provider host/port/TLS/from/credentials and safe dead-letter code. Fix the cause before requeueing. Do not log message/provider payloads.                                          |
| Swagger mutation requests get Origin 403               | Swagger UI's browser origin is not the example frontend origin. Use Postman or deliberately permit the local docs origin for development.                                                |
| Browser cookies disappear between frontend and API     | Use consistent hostnames/same-site deployment, `credentials: 'include'`, proper HTTPS and current CSRF. Do not mix localhost and 127.0.0.1 in a browser flow.                            |
| Preview token is expired/consumed                      | Request fresh instructions after cooldown, then copy the latest correct-purpose token. Don't repeat successful token use.                                                                |

Keep `.env`, private captures/previews and Postman runtime values out of shared exports. Before sharing a used collection, clear access/CSRF/token/password values and its cookie jar, or reimport the clean repository files. The committed Postman files contain no passwords, signing keys or issued tokens.

## 11. Validation and boundaries

This guide and collection are checked against the implemented controllers/configuration. The collection uses the official [Postman Collection v2.1 schema](https://schema.postman.com/json/collection/v2.1.0/collection.json) and documented [Postman Sandbox APIs](https://learning.postman.com/docs/tests-and-scripts/postman-sandbox-reference/overview/). Its requests/scripts are exercised against a compiled server and an owned disposable PostgreSQL database; exported files remain blank of secrets.

Local verification uses Windows, installed PostgreSQL 17 and file/local SMTP capture. Docker and an external SMTP provider are documented alternatives, not externally provisioned services. Production still needs reviewed ingress/proxy policy, separate roles/secrets/backups, shared throttling, retention/key rotation and deployment/load validation. See [the roadmap](roadmap.md) for Phase 6.

## Unified Next.js admin integration

Frontend: E:\ai-saas-dashboard, http://localhost:3001/login. Run npm run dev in that repository after starting this API. One login offers Admin/User options and one shared dashboard uses actual roles/permissions. No public registration UI is provided.

Run npm run db:seed after migrations. Development defaults are admin@example.com / Admin@123456789!. Existing passwords are preserved; existing regular identities are never promoted by the seed. Production requires explicit SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD and rejects default credentials. POST /api/v1/auth/admin/login shares the normal credential/session flow and additionally requires live admin.access. POST /api/v1/auth/login remains the regular-user entry point. Login choice never substitutes for permission checks.

Allow the frontend origin in CORS_ORIGINS and configure MAIL_PUBLIC_URL for verification links. Production HTTPS uses __Host-foundation_refresh; set the same API_REFRESH_COOKIE_NAME in the frontend. Tokens are held by same-origin HttpOnly cookies. The Next.js proxy checks permissions and Nest independently enforces scoped RBAC.

See [CRM management and email two-factor](CRM-MANAGEMENT.md) for the reference-style Admins/Roles/Users/Companies screens, migration 6, filtered exports and the email-code login contract.
