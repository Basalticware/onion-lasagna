---
name: onion-lasagna-use-case
description: Use when creating Onion Lasagna commands, queries, inbound ports, BaseInboundAdapter classes, authorization checks, or application-layer tests
---

# Onion Lasagna Use Case

## Overview

Use cases coordinate application behavior. `BaseInboundAdapter` always runs `authorize(input)` before
`handle(input, authContext)`. Any `CodedError` passes through unchanged; an unknown error is wrapped as
an `InfraError` (masked 500, original kept as `cause`), never a 400 `UseCaseError`.

## Always First

Inspect the actual app layer and nearby use cases before writing code:

```bash
rg -n "extends BaseInboundAdapter|interface .*Port|protected override async authorize|protected override async handle" packages/onion-lasagna/src starters -g '*.ts'
rg -n "NotFoundError|ForbiddenError|UnauthorizedError|UseCaseError|BaseInboundPort" packages/onion-lasagna/src starters -g '*.ts'
```

Read `packages/onion-lasagna/src/app/classes/base-inbound-adapter.class.ts` when auth context or
error behavior matters.

## Structure

- Define plain input/output interfaces in the app layer.
- Define outbound repository/service ports in app, then inject those ports into the use case.
- Extend `BaseInboundAdapter<TInput, TOutput, TAuthContext>`.
- Override `authorize()` whenever `TAuthContext` is not `void`; the base method returns `undefined`.
- Use `authorize()` for authentication, permission checks, and preloading entities needed by `handle()`.
- Use `handle()` for state changes, query execution, saves, and output mapping.

## Boundaries

- Do not import concrete infra adapters, database schemas, HTTP requests, GraphQL args, or framework contexts.
- Do not duplicate repository lookups in `handle()` when `authorize()` already loaded the entity.
- Throw app errors with object-shaped constructors, such as `new NotFoundError({ message, code })`.
- Let `ObjectValidationError`, `UseCaseError`, `DomainError`, and `InfraError` pass through naturally.
- Keep request parsing and response status/header choices in presentation.

## Test Checklist

- Successful execution calls `authorize()` before `handle()` through `execute()`.
- Permission and missing-resource paths throw the correct app errors.
- Preloaded auth-context entities are reused by `handle()` without duplicate lookups.
- Domain mutation and outbound port save happen in the intended order.
- Unknown errors are wrapped by `BaseInboundAdapter`; known Onion Lasagna errors pass through.
