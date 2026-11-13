# @cosmneo/onion-lasagna

## 1.0.0-beta.5

### Patch Changes

- 49f11ea: **`BaseInboundAdapter.execute` passes every `CodedError` through and masks
  unknown errors as a 500.** Its pass-through list was `ObjectValidationError`,
  `UseCaseError`, `DomainError` and `InfraError`; every other error, including
  known coded errors such as `AccessDeniedError` (403) and `InvalidRequestError`
  (400 with its own code), was replaced by a `UseCaseError` and surfaced as a
  400 `BAD_REQUEST`. The same happened to genuinely unexpected errors (a bare
  `Error`, `TypeError`, `RangeError`), which told the client it had sent a bad
  request when the server had failed.

  Now any `CodedError` thrown by `authorize()` or `handle()` is re-thrown
  unchanged, and anything else is wrapped in an `InfraError`
  (`'Unexpected use case handler error'`, original kept as `cause`), which the
  HTTP and GraphQL mappers mask as a 500 / `INTERNAL_ERROR`. In event and
  schedule handlers such an error is now retried (as an unwrapped unknown error
  always was) instead of being dead-lettered as a `UseCaseError`.

  `mapErrorToGraphQLError` also learns `InvalidRequestError`: it maps to
  `VALIDATION_ERROR` with its field errors and own code, mirroring the HTTP 400,
  instead of being masked as `INTERNAL_ERROR`.

## 1.0.0-beta.4

### Patch Changes

- a922e76: **`BaseOutboundAdapter` no longer masks known errors as a 500.** Its method
  wrapper let only `InfraError` pass through; every other error, including known
  coded errors such as `ConflictError` (409), `UnprocessableError` (422) and
  `NotFoundError` (404), was replaced by `InfraError("Outbound adapter error in
<method>")`, which the presentation layer masks as a 500. All four catch sites
  (sync throw, rejected thenable, async generator, sync generator) now pass
  through any `CodedError` unchanged, matching the library's rule: known errors
  pass through, unknown errors are wrapped. Plain `Error`s and other unknown
  throwables are still handed to `createInfraError`.

## 1.0.0-beta.3

### Minor Changes

- 4f6bb6b: Add a `schedule` transport tier (scheduled work: recurring crons + one-time timers) — the fourth tier alongside `http`, `graphql`, and `events`.

  Define a **task** (`defineScheduledTask`, what runs) and bind it with a separate **trigger** (`defineScheduleTriggers`, when/how), group with `defineScheduleRouter`/`mergeScheduleRouters`, wire handlers via `scheduleRoutes(router).handle/.handleWithUseCase().build()` → `UnifiedScheduleInput[]`, and run a fired schedule with the invocation primitives (`indexScheduleRoutes`, `findScheduleRoute`, `invokeScheduledTask`, `resolveScheduleTrigger`). A run returns a `ScheduleResult` (`completed | skipped | retry | failed`); `skipped` is only ever an explicit handler decision, and default error mapping classifies validation/domain errors as `failed` and transient/unknown as `retry`. `generateScheduleCatalog` produces a validated task+trigger inventory.

  New subpath exports: `@cosmneo/onion-lasagna/schedule`, `/schedule/task`, `/schedule/server`, `/schedule/shared`, `/schedule/catalog`. The tier is execution-only (scheduling/cancellation, locking/overlap, and retry policy are deliberately out of scope and left to the app/delivery layer).

## 1.0.0-beta.2

## 1.0.0-beta.1

### Patch Changes

- f1b086c: **GraphQL SDL: zero-variant unions no longer emit unparseable SDL.** A schema
  shape carrying an empty `anyOf` / `oneOf` — most commonly zod's `z.tuple([])`
  ("always-empty array"), which Zod v4 converts to
  `{ type: 'array', items: { anyOf: [] } }` — made the generator emit
  `union X = ` with no members. That is invalid SDL, so the **entire** generated
  schema failed to parse at server boot, surfacing as a misleading syntax error
  on whatever definition happened to follow the union. Zero-variant unions now
  fall back to the `JSON` scalar, consistent with the generator's handling of
  other unrepresentable shapes (mixed-type unions, empty objects).

## 1.0.0-beta.0

### Major Changes

- 01b4e2e: **1.0.0 — audited & stabilized.** This release remediates a full code-quality audit (120 findings:
  1 blocker, 3 critical, 42 major, plus minors/nits) across every package, each fix covered by tests.

  Notable behavior changes (the reason this is a major):
  - **HTTP client** — non-idempotent methods (POST/PATCH) are no longer auto-retried by default; the
    documented 30s request timeout is now actually applied; array query params serialize as repeated
    keys (`?tag=a&tag=b`); `ClientError` no longer drops non-JSON error bodies.
  - **GraphQL (Yoga)** — discriminated-union outputs now resolve at runtime (were unqueryable); typed
    subscriptions validate per yielded item instead of failing; output-validation failures are masked
    rather than leaking internal field paths; `UnauthorizedError` maps to the `UNAUTHENTICATED`
    extension code (was `FORBIDDEN`).
  - **Svelte Query / Vue Query** — hooks are now reactive: `useEnabled` gating and input-derived query
    keys update correctly (previously frozen at setup).
  - **Errors** — `DbError` / `TimeoutError` / `PartialLoadError` are now reliably masked across
    HTTP/GraphQL even under bundling; a stable error brand replaces fragile class-name matching.
  - **HTTP server** — `HandlerResponse.headers` now accepts `string | string[]` (multi-value headers
    like `Set-Cookie`); malformed request bodies normalize to 400; `defineRouter` `basePath` is now
    applied; response validation rejects undeclared status codes.
  - **Domain** — value objects and domain events no longer leak mutable internal state via `.value` /
    `.occurredOn`.
  - **Packaging** — `uuid` is bundled so the CommonJS build no longer breaks ESM-only consumers;
    `typescript` is now an optional peer dependency.

  See PRs #11–#38 for full detail.
