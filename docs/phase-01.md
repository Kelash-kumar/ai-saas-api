# Phase 1: runnable application infrastructure

Historical phase guide. The current project also includes [Phase 2 persistence](phase-02.md). Follow the root README for current setup: a configured, migrated PostgreSQL database is now required to start the application. Infrastructure HTTP tests use a database double.

## Architectural decision

Establish the transport and infrastructure conventions before credentials, persistence and authorization. Security features need a stable validation boundary, trustworthy configuration, private logs and meaningful integration tests. This phase provides those components without pretending that an in-memory account store or fake mailer is production authentication.

NestJS 11 is selected explicitly for ecosystem compatibility. The current NestJS documentation also includes newer APIs; this project uses APIs verified by its installed versions and tests. See [NestJS 11 prerequisites](https://docs.nestjs.com/v11/first-steps), [configuration](https://docs.nestjs.com/techniques/configuration), [rate limiting](https://docs.nestjs.com/security/rate-limiting), [Terminus](https://docs.nestjs.com/recipes/terminus), and [nestjs-pino](https://github.com/iamolegga/nestjs-pino).

## Exact source structure

Generated `dist`, `coverage` and dependency directories are omitted.

```text
nestjs-auth-foundation/
├── .github/workflows/ci.yml
├── .env.example
├── .gitignore
├── .prettierignore
├── .prettierrc.json
├── eslint.config.mjs
├── jest.config.cjs
├── package.json
├── package-lock.json
├── README.md
├── tsconfig.json
├── tsconfig.build.json
├── docs/
│   ├── phase-01.md
│   └── roadmap.md
├── src/
│   ├── main.ts
│   ├── setup-app.ts
│   ├── app.module.ts
│   ├── common/
│   │   ├── errors/
│   │   │   ├── api-exception.filter.ts
│   │   │   └── application.exception.ts
│   │   ├── http/
│   │   │   ├── response.decorator.ts
│   │   │   └── response.interceptor.ts
│   │   └── pagination/
│   │       ├── page-query.dto.ts
│   │       ├── page.ts
│   │       └── page.spec.ts
│   ├── core/
│   │   ├── core.module.ts
│   │   ├── config/
│   │   │   ├── environment.ts
│   │   │   ├── environment.spec.ts
│   │   │   ├── runtime-config.module.ts
│   │   │   └── runtime-config.service.ts
│   │   └── logging/
│   │       ├── app-logger.service.ts
│   │       ├── logging.module.ts
│   │       ├── logging.options.ts
│   │       └── logging.spec.ts
│   └── features/
│       └── health/
│           ├── health.controller.ts
│           ├── health.module.ts
│           └── lifecycle.service.ts
└── test/
    ├── foundation.e2e-spec.ts
    └── support/test-application.ts
```

The local `.env` is untracked. Future feature folders are created when their code is implemented; there are no empty placeholder repositories, guards or entities.

## Responsibilities and dependencies

| File or group                      | Responsibility                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `main.ts`                          | Creates the HTTP application, applies setup, listens, handles startup failure safely.                                                                  |
| `setup-app.ts`                     | Shared production/test HTTP setup: trusted request ID, security headers, body limits, CORS, versioning, validation, Swagger, shutdown.                 |
| `app.module.ts`                    | Root composition; no business logic.                                                                                                                   |
| `core.module.ts`                   | Registers global throttler, exception filter and response interceptor through DI.                                                                      |
| `environment.ts`                   | Single startup validation/coercion boundary. Invalid settings fail before the server listens; values are not echoed.                                   |
| `runtime-config.module.ts`         | Global `@nestjs/config` registration, environment-file loading and caching.                                                                            |
| `runtime-config.service.ts`        | Typed frozen application/logging/security configuration domains. Future database/auth/email domains get their own validated providers in their phases. |
| `logging.options.ts`               | Allow-listed request/response serialization, redaction, request IDs, timings and status-based levels.                                                  |
| `app-logger.service.ts`            | Narrow injectable operational logging API and typed security events.                                                                                   |
| `logging.module.ts`                | Configures Pino once, exports logging integration.                                                                                                     |
| `application.exception.ts`         | Explicit public error messages with stable machine-readable codes.                                                                                     |
| `api-exception.filter.ts`          | Maps Nest, validation and parser errors to one HTTP contract; logs unexpected stacks internally.                                                       |
| `response.interceptor.ts`          | Wraps JSON responses; respects raw protocols, streams and 204.                                                                                         |
| `response.decorator.ts`            | Opt-out metadata for raw responses.                                                                                                                    |
| `page-query.dto.ts`                | Explicit query coercion and bounded page/limit/search/sorting shape.                                                                                   |
| `page.ts`                          | Generic page metadata, offset calculation and safe sort resolution.                                                                                    |
| `health.controller.ts`             | Terminus checks exposed as versioned endpoints with raw responses.                                                                                     |
| `lifecycle.service.ts`             | Marks readiness down when shutdown starts.                                                                                                             |
| `health.module.ts`                 | Composes Terminus and lifecycle dependencies.                                                                                                          |
| Unit specs                         | Configuration, pagination, and log-privacy invariants.                                                                                                 |
| `test/support/test-application.ts` | Real application factory with deterministic typed settings and captured error logger.                                                                  |
| `foundation.e2e-spec.ts`           | Tests production HTTP setup and global providers through test-only endpoints.                                                                          |

Dependency graph: `AppModule → CoreModule → RuntimeConfigModule + LoggingModule + ThrottlerModule`; `AppModule → HealthModule → TerminusModule`. Logging consumes configuration; health consumes Terminus and lifecycle. Common error handling uses the narrow logger API. No feature imports the application root or core composition module. Global registration is limited to infrastructure; business services will use explicit module exports and ports.

Middleware runs before guards, then validation and controller invocation, followed by response interception. Exceptions go to the global filter. The current only global guard is the throttler. Authentication/authorization guards will be registered together in a documented order in later phases.

## Installation and configuration

The complete TypeScript implementation is in the files above. Use `npm ci --ignore-scripts` after checkout, then copy `.env.example` to `.env`. Never commit live secrets. No global CLI is required. Run all commands from the project root so `.env` resolves consistently.

| Variable              | Default           | Meaning                                                                                      |
| --------------------- | ----------------- | -------------------------------------------------------------------------------------------- |
| `NODE_ENV`            | `development`     | Must be development, test or production.                                                     |
| `HOST`                | `127.0.0.1`       | Local-only by default; set `0.0.0.0` for containers deliberately.                            |
| `PORT`                | `3000`            | Integer 1–65535.                                                                             |
| `APP_NAME`            | `auth-foundation` | Bounded service label.                                                                       |
| `SWAGGER_ENABLED`     | `false`           | Explicit boolean; example enables it for development.                                        |
| `CORS_ORIGINS`        | empty             | Comma-separated exact HTTP(S) origins; HTTPS required in production. No paths or wildcard.   |
| `LOG_LEVEL`           | `info`            | Pino level; `trace` implements the logger's verbose method.                                  |
| `RATE_LIMIT_TTL_MS`   | `60000`           | Window in milliseconds, 1000–3600000.                                                        |
| `RATE_LIMIT_MAX`      | `100`             | Requests per route/IP/window, 1–100000.                                                      |
| `SHUTDOWN_TIMEOUT_MS` | `10000`           | Terminus graceful shutdown delay, 1000–120000. This is not an overall process-kill deadline. |

`ConfigModule` reads the OS environment and `.env` once. Its validated configuration is passed through `ConfigService` to the typed wrapper. `skipProcessEnv` prevents later reads from bypassing the validated snapshot. Application code never reads `process.env`. Add validation and typed providers when introducing a configuration domain; do not add unused JWT secrets or database credentials now.

## API examples

```powershell
curl.exe -i http://127.0.0.1:3000/api/v1/health/live
curl.exe -i http://127.0.0.1:3000/api/v1/health/ready
curl.exe -i "http://127.0.0.1:3000/api/v1/missing?token=private"
```

Health endpoints return the Terminus protocol directly:

```json
{
  "status": "ok",
  "info": { "process": { "status": "up" } },
  "error": {},
  "details": { "process": { "status": "up" } }
}
```

Readiness checks `application`, not a database. During shutdown it returns 503. When persistence is added, readiness must also query database connectivity with a timeout; liveness must stay independent of downstream services.

Missing routes return 404 with this shape (IDs/times vary):

```json
{
  "success": false,
  "statusCode": 404,
  "message": "Resource not found",
  "errors": [],
  "timestamp": "2026-11-20T00:00:00.000Z",
  "path": "/api/v1/missing",
  "requestId": "a-server-generated-uuid"
}
```

The implementation sanitizes the default 404 message to prevent query disclosure. Unexpected errors expose only `Internal server error`; internal logs retain frame locations without the exception message. Validation returns `Validation failed` with field constraints in `errors`, omitting submitted values. Parser errors safely return 400, 413 or 415. Future database adapters must translate known constraint errors to safe application exceptions; unknown database errors already become safe 500s.

Ordinary JSON responses use `{ "success": true, "data": ... }`. `@RawResponse()` preserves endpoints with an existing complete protocol. For future list endpoints apply `@RawResponse()` and return `Page<T>` directly to keep the requested `{ data: [], meta: ... }` contract, avoiding nested page envelopes. Files and 204 bodies bypass wrapping automatically. Add explicit OpenAPI response DTOs as feature response schemas are introduced; do not assume Swagger understands interceptor wrapping automatically.

## Pagination integration

Future controllers accept `@Query() query: PageQueryDto`. Repositories receive the validated DTO or an application query object, use `pageOffset(query)` and `query.limit`, and resolve sorting against a feature-owned allow-list. `createPage(rows, count, query)` computes total pages and next/previous flags. Empty results have zero total pages; pages beyond the end return an empty array while preserving the requested page number. Search is bounded but its business meaning is feature-specific. Add explicit filter DTO fields per feature rather than an arbitrary client-supplied SQL/filter expression.

The default page size is 20, capped at 100; an endpoint may define a more restrictive DTO. Pages are capped at 10,000 to bound offsets. Use deterministic ordering with a unique tie-breaker in the repository. `COUNT` and large offsets can be expensive: phase 2 will use appropriate indexes and phase 6 can add opaque keyset cursors for high-volume datasets. Cursor and page semantics must not be mixed silently.

## Privacy, security and operational behavior

- The server creates a UUID at the HTTP trust boundary. Client-provided IDs cannot inject log fields. Error responses and `X-Request-Id` carry the same identifier.
- Pino logs method/ID, response status, latency and static completion messages. Request URLs, query strings, bodies, arbitrary headers, cookies and user agents are omitted. Do not place user data or credentials in logger message strings. Security events accept a fixed event name and opaque actor ID only. Pino provides an adapter boundary for later tracing/error-monitoring integrations; no Sentry or OpenTelemetry exporter is wired yet.
- Strict DTOs reject unknown properties. Only explicitly annotated numeric query fields are converted. This avoids broad implicit conversion surprises. Global body size is 16 KiB; future upload endpoints need explicit limits and streaming design.
- CORS only controls browser access. Credentials require exact origins, and CSRF defenses will accompany cookie auth. A request with a disallowed origin can still reach the API outside a browser.
- `trust proxy=false` prevents forged forwarding headers from selecting rate-limit keys. Configure exact trusted proxy networks only when deploying behind known ingress. In-memory throttle counters do not coordinate multiple replicas or survive restarts; a shared adapter is a later phase acceptance requirement.
- Health is exempt from route throttling for orchestrator probes. Restrict probes at the ingress as needed. Swagger's middleware is not protected by Nest route guards; enable it only in appropriately controlled environments.
- Helmet and body limits are applied to the real server and test application through the same setup function. Shutdown hooks mark readiness down and Terminus allows a grace period. Configure the orchestrator's termination grace above that delay plus in-flight request time.

## Verification

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm audit --omit=dev
```

Unit tests cover environment coercion/fail-fast validation, exact origins, immutable config, page limits/metadata/sort allow-lists, and log redaction. HTTP tests use the real global guard/filter/interceptor and shared setup. They verify liveness/readiness, server-generated IDs, unknown field rejection, safe errors, JSON/body limits, CORS, rate limiting under forged forwarding headers, raw/204 responses, versioning and Swagger opt-in. Test-only fixture controllers are never imported by `AppModule`.

Common mistakes to avoid: using `tsx` to run constructor-injected Nest code without decorator metadata; trusting raw environment strings as booleans; logging full Express requests; assuming DTO validation makes arbitrary SQL sorting safe; exposing ORM entities with password hashes; claiming lifecycle-only readiness proves database health; and treating passing infrastructure tests as proof of complete authentication security.
