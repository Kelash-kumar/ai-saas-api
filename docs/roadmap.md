# Incremental implementation roadmap

Each phase must compile, have meaningful tests, and document its public API before the next phase. **Phases 1–5 are complete.** See [Phase 5](phase-05.md) for authorization/administration, [Phase 4](phase-04.md) for recovery/lifecycle/delivery, and the root README/working guide for current setup. Phase 6 operational hardening remains.

| Phase | Deliverable                                                                                                                | Acceptance checks                                                                                                                                                                  |
| ----- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Infrastructure, API contracts, configuration, logging, health, pagination                                                  | Strict compilation, lint/format, configuration/privacy tests, real HTTP tests, built-server smoke test                                                                             |
| 2     | PostgreSQL, TypeORM, migrations, normalized identity/RBAC/session/token entities, repository contracts and implementations | Empty-database migration and rollback, transaction rollback, uniqueness/race tests, pagination/filter/sort repository tests, test database isolation, database readiness           |
| 3     | Registration, verification, login, local/JWT strategies, Argon2id, access/refresh tokens, session management, logout       | Real-database auth integration and E2E tests; atomic refresh rotation, replay revokes token family, concurrent refresh and logout tests; inactive/locked/unverified account denial |
| 4     | Forgot/reset/change password, activation/deactivation, lockout, mail port and transactional outbox                         | Single-use expiring hashed purpose-bound tokens, generic anti-enumeration responses, durable delivery, password reset/change revokes sessions, brute-force/account-lock tests      |
| 5     | Dynamic RBAC, direct permissions, role hierarchy, management endpoints, composed guards/decorators                         | Multi-role inheritance, cycle rejection, revocation, deny-by-default, authorization escalation tests, guard order and public-route override tests                                  |
| 6     | Deployment hardening, distributed rate limiting, tracing/error monitoring adapters, final API documentation                | Multi-instance limits, bounded auth-query budgets/load tests, PostgreSQL CI, secret rotation procedure, backup/recovery and deployment checks                                      |

## Target architecture

`AppModule` composes `CoreModule` and feature modules. Core owns infrastructure; it does not import feature business logic. Shared HTTP and pagination components depend on framework primitives and narrow infrastructure APIs. Feature controllers accept DTOs and call application services/use cases. Use cases depend on repository and external-service contracts injected with explicit symbols. Infrastructure adapters implement those contracts.

Planned features: `users`, `auth`, `authorization`, `sessions`, and the existing `health`. User type is profile data, not a hardcoded switch in authentication. Authorization resolves stored roles/permissions for an authenticated subject. Avoid a shared barrel that reexports every module and introduces circular imports. Export narrow providers from feature modules; keep repositories private unless they implement an intentional cross-feature port.

## Persistence decisions for phase 2

Use PostgreSQL and TypeORM with migrations, never runtime schema synchronization. This fits the requested reusable base repository while retaining typed ORM criteria, joins, and transaction capabilities. A base repository will handle generic CRUD, existence/count and bounded pagination; business-specific lookup and lock operations stay in feature repositories. It must never expose ORM entities containing credentials through controllers. Query-manager/transaction context will be explicit so a transaction cannot accidentally fall back to the global connection.

Normalized tables: `users`, `roles`, `permissions`, `user_roles`, `role_permissions`, optional `user_permissions`, `role_inheritance`, `sessions`, `refresh_tokens`, `password_reset_tokens`, `email_verification_tokens`, and a mail outbox. Join tables need composite uniqueness and indexed foreign keys. Unique normalized email and token digests enforce race-safe invariants. Session and token expiry/revocation fields support cleanup and audits. Separate token tables preserve purpose boundaries. Role inheritance must reject cycles inside an appropriate transaction/lock boundary.

Permission names represent resource/action pairs such as `users.read`. Permission creation and assignment require privileged permission checks themselves. Role assignment must not allow an administrator to grant authority beyond their grant scope. Queries load effective authority in batches rather than N+1 lookups. Any future permission cache needs explicit invalidation/versioning so revocation is immediate.

## Authentication decisions for phases 3–4

- Argon2id hashing behind a password-hasher port, with work factors benchmarked on deployment hardware. Normalize identity fields, never silently trim or lowercase passwords.
- Short-lived access JWTs with a fixed algorithm allow-list, issuer, audience, expiry and subject/session identifiers. No permission list trusted indefinitely from a stale JWT. Signing keys and rotation live in the typed auth configuration.
- Cryptographically random opaque refresh tokens, stored only as digests. Each rotation atomically consumes one token and creates its replacement. Retain consumed token lineage so replay revokes the session/family. Define and test the policy for simultaneous refreshes explicitly.
- Sessions bound to user records; lifecycle, lock status and revocation are checked dynamically so deactivation/logout can invalidate access immediately. Device labels and user agents are untrusted display metadata.
- HttpOnly, Secure, scoped refresh cookies where used. SameSite, exact origin checks and explicit CSRF defenses for cookie-authenticated mutations, including refresh/logout. Never put reset/verification/access/refresh tokens in logs, telemetry, or email-provider diagnostic bodies.
- Purpose-bound, single-use, expiring random verification/reset tokens stored as digests. Generic public responses and comparable processing for unknown email addresses. Reset consumption and credential updates use one transaction.
- Throttle IP and normalized account identities, implement bounded lockouts and address lockout denial-of-service tradeoffs. Persist state so restarts/multiple replicas cannot bypass controls.
- Email provider behind a port and durable transactional outbox. Verification/reset flows remain testable with a captured-mail adapter, without exposing tokens in API responses.

## Guard order for phase 5

One documented registration order: rate limiting → authentication strategy selection → roles → permissions. Local authentication is explicitly selected for login and does not rely on global JWT exceptions that accidentally skip every guard. A `Public` marker bypasses authentication only; it must not disable throttling or other security middleware. `CurrentUser` exposes a typed, minimal principal. Route metadata may override default authentication strategy, while authorization defaults deny access when authority is missing. Optional API-key auth hashes keys, enforces scopes, and uses a distinct principal type.

## Testing progression

Phase 1 uses real in-process HTTP requests and no database. Phase 2 adds a dedicated disposable PostgreSQL test database, migrations before tests, and transactional/reset isolation. Never point test cleanup at production databases. Repository tests exercise actual database constraints and transactions; mocks alone cannot prove concurrency safety. Authentication and authorization E2E tests must use the real guard chain, database and test mail adapter. Unit tests mock ports for focused business rules. Performance checks measure query counts and latency under actual indexes and realistic data volumes.
