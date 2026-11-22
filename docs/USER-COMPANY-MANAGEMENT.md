# NestJS user and company management

This update is implemented in E:\ai-saas-api. The Laravel repository was used only as a reference for thin controllers, repository contracts, common persistence operations and resource projections. It adds to Phase 5; Phase 6 operational hardening is still separate. No Laravel framework, ORM or authentication code is introduced into NestJS.

## Architecture and reduced repetition

- Existing BaseRepository handles create/update/delete and validated pagination. ManagementRepository adds one shared required lookup and literal multi-column search; both user and company repositories reuse it.
- Existing AuthorizationService.mutate remains the single policy lock, actor/session recheck, transaction and last-recovery-manager boundary. Its callback receives the existing TransactionScope, so feature repositories use the same transaction instead of opening nested transactions or exposing an EntityManager publicly.
- RegistrationService.provision is shared by public registration and managed user creation: both use the existing password hasher, opaque verification token, token digest and encrypted transactional outbox. Managed creation now records a separate audited login approval (migration 7), allowing immediate login without falsely verifying the email or granting extra permissions.
- UserProfileDto is reused through Swagger IntersectionType/PartialType for managed create/update validation. Common PageQueryDto, page metadata, error mapping, success envelopes, Origin guard and RBAC decorators are retained.
- Controllers declare routes, DTOs and exact permissions. Services contain feature rules. HTTP responses use explicit projections rather than raw entities. No generic CRUD controller dynamically guesses validation or permissions.

## Data and migration

The fifth migration adds companies (UUID, name, optional email/phone/website/address, timestamps), nullable user firstName/lastName/phone/companyId, and user deletedAt. Existing accounts retain their credentials, roles, sessions and userType; their new profile fields start null. Company email is normalized and unique when present. Names need not be unique. Indexed companyId references companies with ON DELETE RESTRICT.

One company has many users; each user has zero or one company. This is a business association, not tenant isolation, a login guard, or an automatic role grant. Managers have global access only through their stored permissions; company membership never creates authority.

Run from the NestJS project:

```powershell
cd E:\ai-saas-api
npm run db:local
npm run db:migrate
npm run db:status
npm run db:schema-check
npm run start:dev
# Separate terminal for email capture/delivery:
npm run mail:worker
```

On the current workspace the fifth migration has been applied and schema consistency checked. Fresh checkouts still need the setup/key/database steps in WORKING-GUIDE.md. No new package or environment variable is required. The database remains PostgreSQL 17 + TypeORM on the existing local port 55432.

## Operator permissions

Existing operators do not silently receive new authority during migration. After choosing an active, verified, unlocked operator account, explicitly rerun bootstrap:

```powershell
npm run authorization:bootstrap -- admin@example.com
```

The finite system catalog now includes users.create, users.update, users.delete and companies.read/create/update/delete, alongside existing users.read/status/unlock and role/permission management. Bootstrap idempotently grants these to the named account, without changing its credentials or userType. Existing JWTs see grants on their next request.

Use the Phase 5 delegation APIs to grant narrower subsets to other managers. The route guard is followed by transaction-time permission rechecking. User profile edits and archival additionally enforce the actor's effective role/permission grant ceiling against the target. The last eligible recovery manager cannot be archived; the complete transaction, including revocations, rolls back on that conflict.

## API reference

All paths begin /api/v1. Every route requires a valid bearer access token. POST/PATCH/DELETE also require an exact Origin from CORS_ORIGINS. Responses are Cache-Control: no-store. The existing global throttle still precedes authentication and authorization.

| Method/path           | Permission                  | Result                                                    |
| --------------------- | --------------------------- | --------------------------------------------------------- |
| GET /companies        | companies.read              | 200 paginated companies                                   |
| POST /companies       | companies.create            | 201 company                                               |
| GET /companies/:id    | companies.read              | 200 company or 404                                        |
| PATCH /companies/:id  | companies.update            | 200 updated company                                       |
| DELETE /companies/:id | companies.delete            | Empty 204; linked users cause 409                         |
| GET /users            | users.read                  | 200 paginated user profiles                               |
| POST /users           | users.create                | 201 login-approved account; mailbox verification queued   |
| GET /users/:id        | users.read                  | 200 user profile or 404                                   |
| PATCH /users/:id      | users.update + target scope | 200 profile/company update                                |
| DELETE /users/:id     | users.delete + target scope | Empty 204; archives account and revokes sessions/recovery |

IDs are UUIDs throughout, including companyId. PATCH accepts partial changes; PUT is not exposed. Unknown body fields are rejected by the existing strict validation pipe. Invalid DTOs/UUID/sort fields are 400, missing references are 404, duplicates/linked-company/last-manager conflicts are 409. Lists use {data, meta}; successful objects use {success:true, data}; deletes have no body.

Company create example:

```json
{
  "name": "Acme",
  "email": "office@acme.test",
  "phone": "+923001234567",
  "website": "https://example.com",
  "address": "Karachi"
}
```

Only name is required (trimmed, 1–160 chars). Optional fields accept null to clear them. Email is normalized, website requires HTTP/HTTPS, and all strings have bounded lengths. PATCH cannot set name to null.

Managed user create example (replace companyId with the returned UUID):

```json
{
  "email": "ada@example.com",
  "password": "Choose-a-private-password",
  "firstName": "Ada",
  "lastName": "Lovelace",
  "companyId": "11111111-1111-4111-8111-111111111111"
}
```

Email/password/firstName/lastName are required. Password uses the existing 12–128 character policy and Argon2id hasher. companyId and phone are optional/null. userType stays customer; roles, permissions, verified/status flags and arbitrary fields cannot be supplied. The new account cannot log in until its emailed token is verified through the existing /auth/verify-email endpoint. Use the existing private preview/mail worker instructions locally. No token or hash is returned in the management response.

Update a profile or unlink a company:

```json
{ "firstName": "Grace", "phone": null, "companyId": null }
```

PATCH /users/:id permits firstName, lastName, phone and companyId only. Email and credentials remain outside this CRUD contract to preserve verification and password-recovery rules. Use the existing reset/change-password APIs; status, unlock, roles and direct permissions remain under /authorization. The /auth/me principal includes safe profile fields; use /users/:id for managed profile data.

Lists accept existing page/limit/search/sortBy/sortOrder. Maximum limit is 100. Company search covers name/email; sorts id/name/email/createdAt/updatedAt. User search covers email/firstName/lastName; sorts id/email/firstName/lastName/createdAt/updatedAt/status. Users additionally accept companyId. Search escapes SQL LIKE metacharacters literally. Company profile responses need no per-row user query; user responses expose companyId without per-row company loading.

## Archive and deletion semantics

DELETE /users/:id is a soft archive: deletedAt is set, status becomes administratively inactive, all sessions/refresh tokens are revoked, and reset/activation tokens are invalidated in one transaction. TypeORM reads/credential lookup exclude archived users; the recovery-manager SQL explicitly excludes them as well. Email uniqueness remains reserved. Public registration cannot recreate or revive the archived identity. Public activation and the existing administrative status endpoint cannot restore it. No restore or permanent-delete API is exposed in this increment.

Company deletion never cascades into users. Any linked user, including an archived one, blocks deletion. Unlink or reassign users before archiving if you intend to delete that company later. Archived associations are retained as history; changing those records requires a separately reviewed retention/repair process. A database FK also protects references from writers outside the application policy lock.

## Postman walkthrough

Reimport postman/NestJS-Auth-Foundation.postman_collection.json. It now contains 54 requests; the ten new operations are in 10 - User and company management. Reimport the optional Local environment for new input variables. Your previously imported Postman workspace does not update automatically.

1. Register/verify/bootstrap your operator as usual. Send Login using its email/password inputs.
2. Set companyName. Send Create company, List companies, Get company and Update company. The create script stores companyId at collection scope.
3. Set managedUserEmail and managedUserPassword to a separate disposable account; managedFirstName/managedLastName have example defaults. Send Create managed user. It stores managedUserId, queues verification, and leaves the operator's login/cookie state intact.
4. Send List users and Get managed user. The user can immediately sign in with Login as User. Mailbox verification is separate; enabled email second-factor still applies.
5. Send Update managed user: it edits the name and unlinks companyId. Send Archive managed user, then Delete company for cleanup.

Keep runtime companyId and managedUserId at collection scope; do not shadow them with environment inputs. Password/token export values are blank. Requests use JSON.stringify to preserve quotes/backslashes in input. Do not Run All blindly: mail checkpoints and destructive lifecycle operations need deliberate ordering.

## Verification and limits

```powershell
npm run check:all
npm run db:status
npm run db:schema-check
```

The suite has 150 tests: 63 unit/infrastructure and 87 real PostgreSQL tests, including ten new management tests. Coverage includes actual hashing and verification/login, projections, permissions/Origin, CRUD, literal search, pagination/filter validation, SQL FK enforcement, archived identity/session/recovery denial, privilege ceilings, last-manager rollback and mutation-time permission checks. Existing persistence tests roll all five migrations down/up and check TypeORM metadata consistency.

The importable Postman collection passes its v2.1 schema and script syntax checks. A staged Newman run against the compiled server and an isolated PostgreSQL database passed all 54 request definitions across 64 live requests and 176 assertions, including the complete company/user workflow. Runtime credentials stayed in memory and the exported credential/token inputs remain blank.

No frontend/admin dashboard is included. This update supplies the backend APIs and Postman workflow. Companies are not a tenant authorization boundary. Versioned caches, large-dataset substring search optimization, retention/archival repair and deployment/load hardening remain separate work. Policy-changing writes intentionally share the Phase 5 transaction lock for consistency.

## Important files

- common/persistence/management.repository.ts: shared lookup and search over existing BaseRepository.
- features/companies: company entity, repository, DTOs, service and controller.
- features/users/dto/user-management.dto.ts and user-management service/controller: profile CRUD and archive workflow.
- features/management.module.ts: joins management services with narrow auth and authorization exports.
- features/auth/services/registration.service.ts: shared provisioning used by both registration entry points.
- features/authorization/services/authorization.service.ts: existing scoped policy mutation boundary, now passing its transaction scope to callbacks.
- core/database/migrations/1795233600000-UserCompanyManagement.ts: reversible additive schema changes.
- test/database/management.db-spec.ts: real PostgreSQL/HTTP integration checks.
