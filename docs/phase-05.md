# Phase 5: dynamic authorization and scoped administration

Phase 5 adds database-driven role/permission evaluation, explicit access policies, management APIs, operator bootstrap and administrative lifecycle controls. No new schema migration is needed: the normalized roles, permissions, mapping tables and cycle-prevention trigger already exist. The development database still has four migrations.

## Decisions and module boundaries

Authentication establishes a minimal subject/session principal; authorization resolves current authority from PostgreSQL. Roles are independent of `userType`. No role name, administrator user type, wildcard permission or JWT role claim bypasses policy checks. Permission names are exact `resource.action` strings.

`AuthModule` imports the narrow authorization guard exports. Core's global throttler runs first, followed by one `AccessPipelineGuard`: JWT authentication → role guard → permission guard. False guard results short-circuit instead of being ignored. Local login and cookie/CSRF/origin guards retain their Phase 3/4 behavior.

`AuthorizationModule` owns management controllers, DTOs, read/mutation services, the grant policy and a scoped repository. It imports notification ports for administrative notices, not AuthModule. The shared access metadata has no feature dependencies. Unrestricted CRUD repository adapters are not exported from the authorization module; other features should use the authorized service boundary.

The resolver uses PostgreSQL recursive CTEs with UNION to collect assigned/inherited roles and union their permissions with direct user grants. Deduplication handles multiple paths and bounds traversal even if a trusted database writer introduced bad graph data. Ordinary hierarchy writes are additionally protected by the existing database cycle trigger. See [PostgreSQL recursive queries](https://www.postgresql.org/docs/17/queries-with.html) and [Nest authorization concepts](https://docs.nestjs.com/security/authorization).

## Explicit access policies

| Decorator                                    | Meaning                                                                                                                                      |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `@Public()`                                  | Bypasses JWT only when no role/permission requirement is attached. Throttling and route guards still run.                                    |
| `@Authenticated()`                           | Explicit authenticated/self-service route. It can override a public class default and does not cancel attached role/permission requirements. |
| `@Roles('reviewer', 'editor')`               | At least one effective role, including inherited roles.                                                                                      |
| `@AllRoles(...)`                             | Every named effective role.                                                                                                                  |
| `@Permissions('users.read', 'reports.view')` | Every named permission.                                                                                                                      |
| `@AnyPermissions(...)`                       | At least one named permission.                                                                                                               |

Private routes without any declared policy deny authenticated requests with 403; anonymous requests receive 401 first. Existing owner-scoped auth/recovery controllers are explicitly authenticated, with their public methods preserved. Public metadata cannot disable an attached role/permission requirement: JWT is still required in that case.

Method metadata overrides the class requirement of the same kind. Role and permission requirements compose independently. There is no empty-decorator shortcut; empty/invalid policy declarations fail. Role and permission guards share one request-local authority snapshot. No authority is cached between requests, so a stored revocation applies on the next request using the same JWT. In-flight requests may already have passed a read check; management mutations recheck identity and authority inside their transaction.

For a future business controller:

```typescript
import { Controller, Get, Query } from '@nestjs/common';
import { RawResponse } from './common/http/response.decorator';
import { PageQueryDto } from './common/pagination/page-query.dto';
import { AuthorizationModule } from './features/authorization/authorization.module';
import { Permissions } from './features/authorization/decorators/access.decorators';
import { AuthorizationService } from './features/authorization/services/authorization.service';
import { Module } from '@nestjs/common';

@Controller({ path: 'directory', version: '1' })
export class DirectoryController {
  constructor(private readonly authorization: AuthorizationService) {}

  @Get()
  @Permissions('users.read')
  @RawResponse()
  list(@Query() query: PageQueryDto) {
    return this.authorization.users(query);
  }
}

@Module({ imports: [AuthorizationModule], controllers: [DirectoryController] })
export class DirectoryModule {}
```

This complete integration example assumes a file directly under `src/`. Import `DirectoryModule` in your application to expose the additional directory route; it uses the existing safe paginated user projection. The shipped management controller already offers the equivalent protected list under `/authorization/users`.

## Grant ceilings and concurrency

Every management mutation acquires an application-wide PostgreSQL transaction advisory lock, then ordered actor/target user locks where applicable. The actor's current account/session and required permissions are checked again after those locks. HTTP guard success is not reused as transaction authority.

Permission ceilings always apply: a manager may grant/revoke or otherwise affect only permissions they currently hold. A target user's complete effective authority must also fit that ceiling. Role grants additionally require the manager to hold the role identity, unless they possess the explicit `roles.delegate` capability. `roles.delegate` permits delegation of other role identities; it never bypasses permission ceilings. Creating a new role requires both `roles.create` and `roles.delegate`, and names are immutable afterward.

Changing/deleting a shared role checks all inheriting roles and every affected user's full effective authority, including their unrelated roles/direct grants. Thus a limited manager cannot edit a harmless-looking base role to strip authority from a more privileged consumer. Adding inheritance also checks the inherited role's authority. Role/permission/membership operations are serialized, so concurrent API writes cannot race their scope checks.

Once an eligible delegation manager exists, mutations cannot remove the last active, verified, currently unlocked user holding all four recovery capabilities: `roles.delegate`, `roles.assign`, `permissions.assign`, `permissions.revoke`. A conflicting mutation rolls back with 409. This is a permission-based management invariant, not a magic administrator-role check. It applies to the management transaction boundary; temporary lockout, self-service deactivation and direct trusted database operations have their own recovery/operational policies.

The database hierarchy trigger retains its own graph lock and READ COMMITTED requirement. Operator commands use the policy lock as well. Direct SQL/root database access is trusted infrastructure and can bypass application grant checks; never give the runtime database account to untrusted clients.

## Initial bootstrap and custom permission provisioning

No default privileged user is created at startup or migration time. First register and verify the intended account using the existing flow. Then, from a trusted project terminal with operator database credentials:

```powershell
npm run authorization:bootstrap -- admin@example.com
```

The command requires an existing active, verified, unlocked identity. It idempotently creates the system catalog and grants those permissions **directly to that named user**. It does not create/verify accounts, change passwords/user type, seed a shared magic role, or grant authority to pre-existing role members. Existing JWTs see the new authority on their next request; no restart is needed.

The system catalog is:

```text
roles.read                 roles.create              roles.update
roles.delete               roles.assign              roles.delegate
permissions.read           permissions.create        permissions.assign
permissions.revoke         users.read                users.update_status
users.unlock
```

`POST /authorization/permissions` creates a definition but grants it to nobody. If it is new, even its creator cannot grant it until a trusted operator explicitly authorizes that first grant:

```powershell
# After creating reports.view in the catalog:
npm run authorization:grant -- admin@example.com reports.view
```

The grant command accepts one or more exact **existing** names, is transactional, and requires an eligible existing account. It does not create arbitrary definitions, accept wildcards or expand all future permissions automatically. Once a manager holds the permission, API delegation within the normal ceilings is available. This keeps catalog creation from silently self-authorizing a new protected business capability.

Bootstrap is an explicit privileged operator action, not an HTTP endpoint. Use reviewed accounts and restricted operator access in production. The local workspace has not been given an arbitrary administrator: choose the intended verified account yourself.

## Implemented APIs

All paths below start with `/api/v1/authorization`. Every route requires bearer authentication; unsafe requests also require an exact permitted Origin. `me` is available to any authenticated identity, while all management actions require the listed stored permission(s).

| Method/path                                       | Requirement                          | Result                                                                  |
| ------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| `GET /me`                                         | Authenticated                        | Effective role IDs, role names and permissions.                         |
| `GET /roles`                                      | `roles.read`                         | Bounded/searchable/sortable role page.                                  |
| `GET /roles/:roleId`                              | `roles.read`                         | Description, direct permission/inheritance IDs and effective authority. |
| `POST /roles`                                     | `roles.create` + `roles.delegate`    | 201 empty role; no automatic membership.                                |
| `PATCH /roles/:roleId`                            | `roles.update` + impact scope        | Description only; name changes rejected.                                |
| `DELETE /roles/:roleId`                           | `roles.delete` + impact scope        | 204; mapping cascades, subject to last-manager protection.              |
| `GET /permissions`                                | `permissions.read`                   | Permission catalog page.                                                |
| `POST /permissions`                               | `permissions.create`                 | 201 definition only.                                                    |
| `POST /roles/:roleId/permissions/:permissionId`   | `permissions.assign` + scope         | 204 idempotent grant.                                                   |
| `DELETE /roles/:roleId/permissions/:permissionId` | `permissions.revoke` + scope         | 204 direct role grant removal.                                          |
| `POST /roles/:roleId/inherits/:inheritedRoleId`   | `roles.update` + scope               | 204; cycle rejected with 400.                                           |
| `DELETE /roles/:roleId/inherits/:inheritedRoleId` | `roles.update` + scope               | 204 inheritance removal.                                                |
| `GET /users`                                      | `users.read`                         | Safe managed-user page.                                                 |
| `GET /users/:userId/authority`                    | `users.read`                         | Current effective authority.                                            |
| `POST /users/:userId/roles/:roleId`               | `roles.assign` + scope               | 204 membership grant.                                                   |
| `DELETE /users/:userId/roles/:roleId`             | `roles.assign` + scope               | 204 membership removal.                                                 |
| `POST /users/:userId/permissions/:permissionId`   | `permissions.assign` + scope         | 204 direct grant.                                                       |
| `DELETE /users/:userId/permissions/:permissionId` | `permissions.revoke` + scope         | 204 direct grant removal.                                               |
| `PATCH /users/:userId/status`                     | `users.update_status` + target scope | 204 administrative suspension/restoration.                              |
| `POST /users/:userId/unlock`                      | `users.unlock` + target scope        | 204 clears counters/lock and revokes sessions.                          |

Grant/revoke endpoints are idempotent for an existing scoped resource; an unknown entity is 404. Removing one grant does not erase another role, inheritance path or direct grant that still supplies the permission. There is deliberately no destructive catalog-delete endpoint that silently rewrites every referencing subject.

Lists use `{ data, meta }`, maximum 100 rows/page and validated sort fields. Roles/permissions sort by `id/name/createdAt`; users by `id/email/createdAt/status`. Search treats LIKE metacharacters literally. Other JSON uses `{ success, data }`; 204 is empty. User projections exclude password hashes and credential/device secrets. Swagger includes DTOs, permission-management paths, bearer auth and envelope/page schemas.

## Administrative lifecycle behavior

Status input is `{ "status": "active" }` or `{ "status": "inactive" }`. Inactive writes use `deactivationSource=administrative`, preventing public self-reactivation even if a token had been issued earlier. Every status operation invalidates recovery tokens and revokes all sessions. Restoring active status does not verify email, resurrect sessions or clear password lockout. Unlocking is a separate `users.unlock` action and also signs out sessions.

Suspension/restoration notices are queued in the same transaction, with wording distinct from self-service lifecycle mail. The worker can deliver them without any authentication-module dependency. Last-manager rejection rolls back status, notices, token invalidation and session revocation together.

## File responsibilities and dependencies

| File/group                                                                  | Responsibility                                                                                            |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `common/security/access-metadata.ts`                                        | Shared metadata keys and requirement shape.                                                               |
| `authorization/decorators/access.decorators.ts`                             | Explicit authenticated, role and permission declarations with validation.                                 |
| `authorization/interfaces/authority.ts`                                     | Authority snapshot, finite bootstrap catalog and recovery-capability set.                                 |
| `authorization/policies/grant.policy.ts`                                    | Exact all/any matching, permission ceilings and role-identity scope.                                      |
| `authorization/repositories/authorization.repository.ts`                    | Recursive batched reads, policy/user locks, impact analysis, projections and mapping writes.              |
| `authorization/services/authorization.service.ts`                           | Request snapshot sharing, management use cases, transaction reauthorization and last-manager invariant.   |
| `authorization/services/administration.service.ts`                          | Scoped administrative status/unlock with recovery/session revocation and notices.                         |
| `authorization/guards/*.ts`                                                 | Dynamic role/permission enforcement and explicit default denial.                                          |
| `auth/guards/access-pipeline.guard.ts`                                      | One documented JWT → roles → permissions sequence with short-circuit denial.                              |
| `authorization/controllers/authorization.controller.ts`                     | Permission-tagged, validated HTTP contracts only.                                                         |
| `authorization/dto/management.dto.ts`, `common/pagination/page-meta.dto.ts` | Request validation and accurate Swagger response/page models.                                             |
| `authorization/bootstrap.ts`, `scripts/authorization.ts`                    | Trusted explicit operator provisioning, with no public bootstrap path.                                    |
| Existing auth controller decorators                                         | Preserve owner-scoped account APIs through explicit authenticated policy.                                 |
| Notification template changes                                               | Separate administrative suspension/restoration wording.                                                   |
| Policy/pipeline unit specs and authorization database spec                  | Exact matching, false-result denial, inheritance, scope, races, revocation and administrative boundaries. |

## Run and validate

```powershell
cd E:\nestjs-auth-foundation
npm ci --ignore-scripts
npm run auth:keys
npm run db:local
npm run db:migrate
npm run start:dev
# Another terminal, if delivering/capturing queued notices:
npm run mail:worker
```

After registration/verification, explicitly bootstrap the chosen account and log in. Then:

```powershell
$headers = @{ Origin = 'http://localhost:5173'; Authorization = "Bearer $($login.data.accessToken)" }
Invoke-RestMethod http://localhost:3000/api/v1/authorization/me -Headers $headers
$body = @{ name = 'report-reader'; description = 'Reads approved reports' } | ConvertTo-Json
Invoke-RestMethod http://localhost:3000/api/v1/authorization/roles -Method Post -Headers $headers -ContentType application/json -Body $body
```

Set `$login` to the response from `POST /api/v1/auth/login` (body: email, password and optional deviceName; include the configured Origin). Creating roles does not give them permissions or attach users; use the explicit mapping endpoints with returned UUIDs. To protect real business endpoints, declare the intended exact permissions and provision reviewed definitions/grants.

The [Postman collection](../postman/NestJS-Auth-Foundation.postman_collection.json) now has **44 requests**, including folder `09 - Authorization and administration`. Import the updated JSON if your client still shows Phases 1–4. Existing Postman workspace YAML is not the authoritative importable JSON and is not rewritten with these new APIs.

Use the same actor login variables as before. Set `targetUserId` deliberately to another disposable account. `Create role` saves `roleId`; `Create permission definition` saves `permissionId`; set `inheritedRoleId` deliberately for hierarchy changes. Use the operator grant for a newly created business permission before assigning it. `managedStatus` controls suspension/restoration. Never Run All blindly: deletion/status requests are stateful, and last-manager protections may intentionally return 409.

The exported collection passes the official Postman v2.1 schema and script syntax checks. A staged Newman run exercised all 44 request definitions against the compiled server and a fresh owned PostgreSQL database: **54 live requests and 155 assertions passed**, including both operator commands, hierarchy/membership/direct grants, administrative suspension/restoration/unlock and cleanup. Runtime credentials stayed in memory; the importable exports retain blank credential/token inputs.

```powershell
npm run check:all
npm run db:status
npm run db:schema-check
npm audit
```

The full suite has **140 tests**: 63 unit/infrastructure and 77 real PostgreSQL tests. New coverage includes role/direct/multiple-path resolution, next-request revocation, class/method overrides, public conflicts, default denial, one authority read per combined guard, operator first grants, role-only and permission escalation attempts, shared/inheriting-role impacts, last-manager rollback/races, transaction-time reauthorization, administrative lifecycle/lock separation, safe projections and guard false-result/order semantics. All earlier recovery, worker and migration tests remain enabled. CI is configured for PostgreSQL 17 and Node 22/24; remote CI has not been run here.

## Limits, performance and common mistakes

Authority is loaded through one batched recursive query per guarded request, not one query per role. Management transactions intentionally serialize policy mutations and execute bounded batched impact checks; ordinary reads remain concurrent. Large graphs/many affected users can make those uncommon writes expensive. Measure real graph size/query plans before introducing versioned caches or narrower locks; preserve immediate revocation and scope consistency. Database statement timeouts bound failures. Application policy locks do not serialize unrelated direct SQL performed by privileged operators.

Do not infer authority from user type, trust stale JWT permission claims, auto-grant newly declared permissions, let Public disable an attached requirement, rename role identities through a description endpoint, treat role delegation as permission-ceiling bypass, remove only a direct grant and assume all inherited access disappeared, or rely solely on the guard for a mutation that needs a transaction-time check.

API keys, distributed throttling, managed key rotation, operational tracing/retention and deployment/load hardening remain Phase 6. Object ownership/business-resource policies still belong in their feature use cases; a permission name is not a substitute for checking which resource the subject may modify.

## Complete source layout

Source/configuration files (generated output, local secrets and user-managed Postman workspace files omitted):

```text
.env.example
.github/workflows/ci.yml
.gitignore
.prettierignore
.prettierrc.json
README.md
compose.yaml
docs/WORKING-GUIDE.md
docs/phase-01.md
docs/phase-02.md
docs/phase-03.md
docs/phase-04.md
docs/phase-05.md
docs/roadmap.md
eslint.config.mjs
jest.config.cjs
jest.database.config.cjs
package-lock.json
package.json
postman/Local.postman_environment.json
postman/NestJS-Auth-Foundation.postman_collection.json
scripts/auth-keys.ts
scripts/authorization.ts
scripts/database.ts
scripts/local-postgres.ps1
scripts/outbox.ts
scripts/recovery-preview.ts
scripts/verification-preview.ts
src/app.module.ts
src/common/errors/api-exception.filter.ts
src/common/errors/application.exception.ts
src/common/errors/database-error.spec.ts
src/common/errors/database-error.ts
src/common/http/api-success.decorator.ts
src/common/http/response.decorator.ts
src/common/http/response.interceptor.ts
src/common/http/validation.pipe.ts
src/common/pagination/page-meta.dto.ts
src/common/pagination/page-query.dto.ts
src/common/pagination/page.spec.ts
src/common/pagination/page.ts
src/common/persistence/base.entity.ts
src/common/persistence/base.repository.ts
src/common/security/access-metadata.ts
src/core/config/auth-config.service.ts
src/core/config/database-config.service.ts
src/core/config/environment.spec.ts
src/core/config/environment.ts
src/core/config/load-cli-config.ts
src/core/config/mail-config.service.ts
src/core/config/runtime-config.module.ts
src/core/config/runtime-config.service.ts
src/core/core.module.ts
src/core/database/data-source.ts
src/core/database/database.module.ts
src/core/database/database.options.ts
src/core/database/entities.ts
src/core/database/migrations/1795146450469-InitialIdentitySchema.ts
src/core/database/migrations/1795146450470-RoleHierarchyIntegrity.ts
src/core/database/migrations/1795149291751-AccountRecoveryAndOutboxLeases.ts
src/core/database/migrations/1795149291752-OutboxPendingIndex.ts
src/core/database/unit-of-work.ts
src/core/logging/app-logger.service.ts
src/core/logging/logging.module.ts
src/core/logging/logging.options.ts
src/core/logging/logging.spec.ts
src/features/auth/auth.module.ts
src/features/auth/controllers/auth.controller.ts
src/features/auth/controllers/recovery.controller.ts
src/features/auth/crypto/access-token.service.ts
src/features/auth/crypto/argon-password-hasher.ts
src/features/auth/crypto/auth-crypto.spec.ts
src/features/auth/crypto/opaque-token.ts
src/features/auth/decorators/auth.decorators.ts
src/features/auth/dto/auth.dto.ts
src/features/auth/dto/recovery.dto.ts
src/features/auth/entities/account-activation-token.entity.ts
src/features/auth/entities/email-verification-token.entity.ts
src/features/auth/entities/password-reset-token.entity.ts
src/features/auth/guards/access-pipeline.guard.spec.ts
src/features/auth/guards/access-pipeline.guard.ts
src/features/auth/guards/csrf.guard.ts
src/features/auth/guards/jwt-authentication.guard.ts
src/features/auth/guards/local-authentication.guard.ts
src/features/auth/guards/origin.guard.ts
src/features/auth/interfaces/auth.types.ts
src/features/auth/policies/account-lock.policy.spec.ts
src/features/auth/policies/account-lock.policy.ts
src/features/auth/repositories/authentication.repository.ts
src/features/auth/repositories/recovery.repository.ts
src/features/auth/services/account-lifecycle.service.ts
src/features/auth/services/password-confirmation.service.ts
src/features/auth/services/password-recovery.service.ts
src/features/auth/services/registration.service.ts
src/features/auth/services/session-auth.service.ts
src/features/auth/strategies/jwt.strategy.ts
src/features/auth/strategies/local.strategy.ts
src/features/auth/transport/session-cookies.ts
src/features/authorization/authorization.module.ts
src/features/authorization/bootstrap.ts
src/features/authorization/controllers/authorization.controller.ts
src/features/authorization/decorators/access.decorators.ts
src/features/authorization/dto/management.dto.ts
src/features/authorization/entities/permission.entity.ts
src/features/authorization/entities/role-inheritance.entity.ts
src/features/authorization/entities/role-permission.entity.ts
src/features/authorization/entities/role.entity.ts
src/features/authorization/entities/user-permission.entity.ts
src/features/authorization/entities/user-role.entity.ts
src/features/authorization/guards/permissions.guard.ts
src/features/authorization/guards/roles.guard.ts
src/features/authorization/interfaces/authority.ts
src/features/authorization/policies/grant.policy.spec.ts
src/features/authorization/policies/grant.policy.ts
src/features/authorization/repositories/authorization.repository.ts
src/features/authorization/repositories/permissions.repository.ts
src/features/authorization/repositories/roles.repository.ts
src/features/authorization/services/administration.service.ts
src/features/authorization/services/authorization.service.ts
src/features/health/database-health.indicator.ts
src/features/health/health.controller.ts
src/features/health/health.module.ts
src/features/health/lifecycle.service.ts
src/features/notifications/encrypted-messages.ts
src/features/notifications/entities/mail-outbox.entity.ts
src/features/notifications/interfaces/mail.types.ts
src/features/notifications/mail-worker.module.ts
src/features/notifications/mail.renderer.ts
src/features/notifications/mail.spec.ts
src/features/notifications/notifications.module.ts
src/features/notifications/outbox.worker.ts
src/features/notifications/repositories/outbox.repository.ts
src/features/notifications/transports/file-mail.transport.ts
src/features/notifications/transports/smtp-mail.transport.ts
src/features/notifications/verification-message.factory.ts
src/features/sessions/entities/refresh-token.entity.ts
src/features/sessions/entities/session.entity.ts
src/features/sessions/repositories/sessions.repository.ts
src/features/sessions/sessions.module.ts
src/features/users/entities/user.entity.ts
src/features/users/interfaces/users-repository.interface.ts
src/features/users/repositories/typeorm-users.repository.ts
src/features/users/users.module.ts
src/main-mail-worker.ts
src/main.ts
src/setup-app.ts
test/database/authentication.db-spec.ts
test/database/authorization.db-spec.ts
test/database/database-harness.ts
test/database/outbox.db-spec.ts
test/database/persistence.db-spec.ts
test/database/recovery.db-spec.ts
test/foundation.e2e-spec.ts
test/support/auth-settings.ts
test/support/test-application.ts
tsconfig.build.json
tsconfig.json
```
