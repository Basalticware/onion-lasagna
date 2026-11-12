# CLAUDE.md

> **IMPORTANT:** When working with this library, ALWAYS search the codebase for actual implementations. DO NOT imagine or assume file contents, exports, or patterns. Use `Glob`, `Grep`, or `Read` tools to verify before making changes.

## Monorepo Structure

```
onion-lasagna/
├── packages/onion-lasagna/                    # Core library (@cosmneo/onion-lasagna)
├── packages/servers/
│   ├── onion-lasagna-hono/                    # @cosmneo/onion-lasagna-hono
│   ├── onion-lasagna-elysia/                  # @cosmneo/onion-lasagna-elysia
│   ├── onion-lasagna-express/                 # @cosmneo/onion-lasagna-express
│   ├── onion-lasagna-fastify/                 # @cosmneo/onion-lasagna-fastify
│   ├── onion-lasagna-nestjs/                  # @cosmneo/onion-lasagna-nestjs
│   └── onion-lasagna-yoga/                    # @cosmneo/onion-lasagna-yoga (GraphQL Yoga)
├── packages/schemas/
│   ├── onion-lasagna-zod/                     # @cosmneo/onion-lasagna-zod (v4)
│   ├── onion-lasagna-zod-v3/                  # @cosmneo/onion-lasagna-zod-v3
│   ├── onion-lasagna-typebox/                 # @cosmneo/onion-lasagna-typebox
│   ├── onion-lasagna-valibot/                 # @cosmneo/onion-lasagna-valibot
│   └── onion-lasagna-arktype/                 # @cosmneo/onion-lasagna-arktype
├── packages/clients/
│   ├── onion-lasagna-client/                  # @cosmneo/onion-lasagna-client
│   ├── onion-lasagna-axios/                   # @cosmneo/onion-lasagna-axios
│   ├── onion-lasagna-react-query/             # @cosmneo/onion-lasagna-react-query
│   ├── onion-lasagna-graphql-client/          # @cosmneo/onion-lasagna-graphql-client
│   ├── onion-lasagna-graphql-react-query/     # @cosmneo/onion-lasagna-graphql-react-query
│   ├── onion-lasagna-svelte-query/            # @cosmneo/onion-lasagna-svelte-query
│   ├── onion-lasagna-swr/                     # @cosmneo/onion-lasagna-swr
│   └── onion-lasagna-vue-query/               # @cosmneo/onion-lasagna-vue-query
├── packages/patterns/
│   └── onion-lasagna-saga/                    # @cosmneo/onion-lasagna-saga
├── packages/tooling/                          # CLI tools (out of scope)
├── apps/docs/                                 # Next.js docs site
└── starters/                                  # Project templates (simple-clean-starter, modules-clean-starter)
```

## Commands

```bash
bun install        # Install deps
bun run build      # Build all
bun run dev        # Dev mode
bun run test       # Tests (watch)
bun run test:run   # Tests (once)
bun run lint:fix   # Fix lint
bun run format     # Prettier
```

**Runtime:** Always use `bun`, never `node/npm/pnpm`.

---

## Core Library Source Layout

All paths relative to `packages/onion-lasagna/src/`:

| Layer        | Path            | Purpose                                                            |
| ------------ | --------------- | ------------------------------------------------------------------ |
| Domain       | `domain/`       | Entities, VOs, Events, business rules                              |
| App          | `app/`          | Use cases (`BaseInboundAdapter`), inbound port (`BaseInboundPort`) |
| Infra        | `infra/`        | Outbound adapters, error wrapping                                  |
| Presentation | `presentation/` | HTTP/GraphQL/Events route system, error mapping                    |
| Global       | `global/`       | Shared errors, utils, validation types, common port interfaces     |

> **Ports note:** `BaseInboundPort` lives in `app/interfaces/ports/`. Common infrastructure port interfaces (Logger, Cache, Clock, Email, etc.) live in `global/interfaces/ports/` and are re-exported via the `@cosmneo/onion-lasagna/ports` entry point.

> **Search:** For exports and classes, grep `packages/onion-lasagna/src/**/index.ts`

---

## Data Flow

```
HTTP Request → Framework Adapter → RawHttpRequest
    → Schema validation (if defined) → ValidatedRequest
    → Route Handler:
        → requestMapper(req, ctx) → UseCaseInput
        → useCase.execute()
            → BaseInboundAdapter.handle()
            → Domain ops + Repository calls
            → UseCaseOutput
        → responseMapper(output) → { status, body, headers }
    → Framework sends response
```

## Error Flow

```
Repository throws → BaseOutboundAdapter: PASSTHROUGH all CodedError, WRAP others → InfraError
    → UseCase (passthrough or throw UseCaseError/DomainError)
    → BaseInboundAdapter.execute()
        PASSTHROUGH: ObjectValidationError, UseCaseError, DomainError, InfraError
        WRAP others → UseCaseError
    → Route Handler
        Schema validation fails → ObjectValidationError
        PASSTHROUGH: all CodedError
    → Framework error handler (onionErrorHandler) → mapErrorToResponse()
```

**Principle:** Known errors passthrough; unknown errors wrap at each boundary.

---

## Domain Layer

| Class                       | Use When                                      |
| --------------------------- | --------------------------------------------- |
| `BaseEntity<TId, TProps>`   | Identity-based, mutable state, versioning     |
| `BaseAggregateRoot`         | Entity + domain event collection              |
| `BaseValueObject<T>`        | Immutable, compared by value, self-validating |
| `BaseDomainEvent<TPayload>` | Immutable event record (deep frozen)          |

**Built-in VOs:** `BaseUuidV4Vo`, `BaseUuidV7Vo`, `BaseEmailVo`, `BaseShortTextVo`, `BaseMediumTextVo`, `BaseLongTextVo`, `BasePaginationVo`, `BaseAuditByVo`, `BaseAuditOnVo`

> **Search:** For VO constraints/validation, read `packages/onion-lasagna/src/domain/value-objects/*.ts`

**Pattern:** Always use static `create()` factory, private constructor, validate before construction.

---

## Application Layer

| Class                                               | Purpose                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------- |
| `BaseInboundPort<TInDto, TOutDto>`                  | Use case interface                                                  |
| `BaseInboundAdapter<TInput, TOutput, TAuthContext>` | Implements port; two-phase execution: `authorize()` then `handle()` |

**Two-phase execution:** `BaseInboundAdapter` runs `authorize(input)` first (returns a typed `TAuthContext`), then passes both `input` and `authContext` to `handle(input, authContext)`. Override `authorize()` to perform permission checks and pre-load entities — the returned context is forwarded to `handle()`, avoiding duplicate lookups.

**Errors:** `UseCaseError`, `UnauthorizedError` (401), `ForbiddenError` (403), `NotFoundError` (404), `ConflictError` (409), `UnprocessableError` (422)

> **Search:** For error handling logic, read `packages/onion-lasagna/src/app/classes/base-inbound-adapter.class.ts`

---

## Infrastructure Layer

| Class                 | Purpose                                    |
| --------------------- | ------------------------------------------ |
| `BaseOutboundAdapter` | Auto-wraps ALL methods with error handling |

Known errors (any `CodedError`) thrown inside an adapter method pass through unchanged; only
unknown errors are wrapped. Override `createInfraError(error, methodName)` to customize the
wrapping error type.

**Errors:** `InfraError`, `DbError`, `NetworkError`, `TimeoutError`, `ExternalServiceError`

> **Search:** For wrapping mechanism, read `packages/onion-lasagna/src/infra/classes/base-outbound-adapter.class.ts`

---

## Presentation Layer (HTTP Routes)

Use `serverRoutes()` builder for type-safe route handling. There are two handler registration methods:

**`.handle(key, fn | { handler, middleware? })`** — simple handler; receives validated request + context, returns response directly:

```typescript
import { serverRoutes } from '@cosmneo/onion-lasagna/http/server';

const routes = serverRoutes(projectRouter)
  .handle('projects.get', async (req, ctx) => ({
    status: 200 as const,
    body: { id: req.pathParams.id },
  }))
  .build();
```

**`.handleWithUseCase(key, { requestMapper, useCase, responseMapper, middleware? })`** — use case pattern; follows requestMapper → useCase.execute() → responseMapper pipeline:

```typescript
import { serverRoutes } from '@cosmneo/onion-lasagna/http/server';

const routes = serverRoutes(projectRouter)
  .handleWithUseCase('projects.create', {
    requestMapper: (req, ctx) => ({ name: req.body.name, createdBy: ctx.userId }),
    useCase: createProjectUseCase,
    responseMapper: (output) => ({ status: 201 as const, body: { id: output.id } }),
  })
  .build();
```

**Pipeline for `.handleWithUseCase`:** requestMapper → useCase.execute() → responseMapper

**HTTP Types (from `@cosmneo/onion-lasagna/http/server`):**

- `RawHttpRequest` - body, headers, query, pathParams
- `ValidatedRequest<T>` - typed request after schema validation
- `HandlerResponse` - status, headers, body

**Errors:** `AccessDeniedError` (403), `InvalidRequestError` (400)

> **Search:** For server routes, read `packages/onion-lasagna/src/presentation/http/server/`

---

## Error → HTTP Mapping

| Error                                          | Status | Masked                     |
| ---------------------------------------------- | ------ | -------------------------- |
| `ObjectValidationError`, `InvalidRequestError` | 400    | No (includes field errors) |
| `UseCaseError`                                 | 400    | No                         |
| `UnauthorizedError`                            | 401    | No                         |
| `AccessDeniedError`, `ForbiddenError`          | 403    | No                         |
| `NotFoundError`                                | 404    | No                         |
| `ConflictError`                                | 409    | No                         |
| `UnprocessableError`                           | 422    | No                         |
| `DomainError`, `InfraError`, `ControllerError` | 500    | **Yes** (security)         |

> **Search:** For mapping logic, read `mapErrorToHttpResponse` in `packages/onion-lasagna/src/presentation/http/shared/error-mapping.ts`. Each framework adapter re-exports it as `mapErrorToResponse` (a local alias).

---

## Schema Adapter Packages

Each schema adapter is a separate package:

| Library | Package                          | Adapter Function  |
| ------- | -------------------------------- | ----------------- |
| Zod v4  | `@cosmneo/onion-lasagna-zod`     | `zodSchema()`     |
| Zod v3  | `@cosmneo/onion-lasagna-zod-v3`  | `zodSchema()`     |
| TypeBox | `@cosmneo/onion-lasagna-typebox` | `typeboxSchema()` |
| Valibot | `@cosmneo/onion-lasagna-valibot` | `valibotSchema()` |
| ArkType | `@cosmneo/onion-lasagna-arktype` | `arktypeSchema()` |

> **Search:** For schema implementations, read `packages/schemas/*/src/`

---

## Server Framework Packages

Each framework adapter is a separate package. HTTP adapters export `registerRoutes`, `onionErrorHandler`, and `mapErrorToResponse`:

| Framework    | Package                          | Notes                              |
| ------------ | -------------------------------- | ---------------------------------- |
| Hono         | `@cosmneo/onion-lasagna-hono`    | HTTP                               |
| Elysia       | `@cosmneo/onion-lasagna-elysia`  | HTTP                               |
| Express      | `@cosmneo/onion-lasagna-express` | HTTP                               |
| Fastify      | `@cosmneo/onion-lasagna-fastify` | HTTP                               |
| NestJS       | `@cosmneo/onion-lasagna-nestjs`  | HTTP                               |
| GraphQL Yoga | `@cosmneo/onion-lasagna-yoga`    | GraphQL; exports `createOnionYoga` |

> **Search:** For integration details, read `packages/servers/*/src/index.ts`

---

## Client Packages

| Package                                      | Purpose                                           |
| -------------------------------------------- | ------------------------------------------------- |
| `@cosmneo/onion-lasagna-client`              | Type-safe HTTP client from router definitions     |
| `@cosmneo/onion-lasagna-axios`               | Axios transport adapter for onion-lasagna-client  |
| `@cosmneo/onion-lasagna-react-query`         | React Query hooks from HTTP router definitions    |
| `@cosmneo/onion-lasagna-svelte-query`        | Svelte Query hooks from HTTP router definitions   |
| `@cosmneo/onion-lasagna-swr`                 | SWR hooks from HTTP router definitions            |
| `@cosmneo/onion-lasagna-vue-query`           | Vue Query hooks from HTTP router definitions      |
| `@cosmneo/onion-lasagna-graphql-client`      | Type-safe GraphQL client from schema definitions  |
| `@cosmneo/onion-lasagna-graphql-react-query` | React Query hooks from GraphQL schema definitions |

**Key features of `createReactQueryHooks`:**

- GET/HEAD → `useQuery`, other methods → `useMutation`
- `queryKeyPrefix` for cache isolation
- `useEnabled` hook for global query gating (e.g., auth session readiness)
- `onRequest` interceptor for dynamic headers (Bearer tokens)

> **Search:** For client implementations, read `packages/clients/*/src/`

---

## Pattern Packages

| Package                       | Purpose                                        |
| ----------------------------- | ---------------------------------------------- |
| `@cosmneo/onion-lasagna-saga` | Sequential saga orchestrator with compensation |

**Key features:** per-step retry, `exponentialBackoff(minMs, maxMs)` helper, compensation strategies, timeout + abort propagation, lifecycle hooks.

> **Search:** For saga implementation, read `packages/patterns/onion-lasagna-saga/src/`

---

## Core Package Exports

The package exposes 21 entry points. Commonly used ones:

| Entry Point                                | Purpose                                     |
| ------------------------------------------ | ------------------------------------------- |
| `@cosmneo/onion-lasagna`                   | All layers (domain, app, infra, etc)        |
| `@cosmneo/onion-lasagna/global`            | Shared errors, utils, types                 |
| `@cosmneo/onion-lasagna/ports`             | Common infrastructure port interfaces       |
| `@cosmneo/onion-lasagna/types`             | Shared type definitions                     |
| `@cosmneo/onion-lasagna/http`              | HTTP types and utilities                    |
| `@cosmneo/onion-lasagna/http/route`        | `defineRoute`, `defineRouter`               |
| `@cosmneo/onion-lasagna/http/server`       | `serverRoutes`, route handlers              |
| `@cosmneo/onion-lasagna/http/schema`       | Schema adapter interface                    |
| `@cosmneo/onion-lasagna/http/schema/types` | Schema adapter type definitions             |
| `@cosmneo/onion-lasagna/http/shared`       | `mapErrorToHttpResponse`, shared HTTP types |
| `@cosmneo/onion-lasagna/http/openapi`      | OpenAPI generation                          |
| `@cosmneo/onion-lasagna/events`            | Event routing types and utilities           |
| `@cosmneo/onion-lasagna/events/handler`    | Event handler utilities                     |
| `@cosmneo/onion-lasagna/events/server`     | `eventRoutes` builder                       |
| `@cosmneo/onion-lasagna/events/shared`     | Shared event types                          |
| `@cosmneo/onion-lasagna/events/asyncapi`   | AsyncAPI generation                         |
| `@cosmneo/onion-lasagna/graphql`           | GraphQL types and utilities                 |
| `@cosmneo/onion-lasagna/graphql/field`     | Field definition helpers                    |
| `@cosmneo/onion-lasagna/graphql/server`    | `graphqlRoutes` builder                     |
| `@cosmneo/onion-lasagna/graphql/shared`    | Shared GraphQL types                        |
| `@cosmneo/onion-lasagna/graphql/sdl`       | SDL/schema generation                       |

> **IMPORTANT:** Always verify actual exports by reading the index.ts files. Do not assume.

---

## Decision Quick Reference

**Which base class?**

- Unique identity + mutable → `BaseEntity`
- Entity + consistency boundary → `BaseAggregateRoot`
- Immutable + value comparison → `BaseValueObject`
- Past occurrence record → `BaseDomainEvent`

**Which error?**

- Business rule violation → `InvariantViolationError`
- Resource not found → `NotFoundError`
- Duplicate/conflict → `ConflictError`
- Valid but not processable → `UnprocessableError`
- Not authenticated / invalid token → `UnauthorizedError` (401, use case layer)
- Authenticated but no permission → `ForbiddenError` (403, use case layer)
- HTTP-layer access denial → `AccessDeniedError` (403, presentation layer)
- DB failure → `DbError`
- Network failure → `NetworkError`
- API timeout → `TimeoutError`
- External service failure → `ExternalServiceError`
- Bad request data → `InvalidRequestError`

**When to validate?**

- External input → Always validate
- Value Object factory → Always (in `create()`)

---

## Testing

> **Search:** For testing patterns and mocks, read test files in `packages/onion-lasagna/src/**/tests/` and `starters/simple-clean-starter/` or `starters/modules-clean-starter/`

**Mock pattern:** Mock repository ports, inject into use case, assert on calls and results.

---

## Code Style

- TypeScript strict + `noUncheckedIndexedAccess`
- Interfaces over types
- Type-only imports
- No `any`, no unused imports, no `console.log`
- Prettier: single quotes, semicolons, trailing commas, 100 chars, LF

---

## Reference Implementations

> **Search:** For real-world usage patterns, explore the starter templates:
>
> - `starters/simple-clean-starter/` — flat structure for smaller services
> - `starters/modules-clean-starter/` — module-based structure for complex systems

These starters show complete implementation of entities, use cases, repositories, controllers, and route registration.
