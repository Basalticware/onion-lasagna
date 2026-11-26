# @cosmneo/onion-lasagna-client

## 1.0.0-beta.6

### Minor Changes

- 36567c0: **Client errors keep their cause, and responses validate when asked.**

  Errors are no longer swallowed into `ClientError(0, 'Network Error')`:
  - A throw from the injected `fetch` still becomes a `ClientError` with status
    `0` and `statusText` `'Network Error'` (or `'Timeout'` / `'Aborted'`), and
    now keeps the original error as `cause`. `ClientError` takes an optional
    sixth argument, `{ cause }`.
  - A throw from `onResponse` propagates unchanged and is never retried.
    **`onError` is no longer called for it.** Before, it became a
    `ClientError(0, 'Network Error')`, was retried, and reached `onError` once as
    that network error; if you log interceptor failures through `onError`, catch
    them at the call site or inside `onResponse` instead.
  - A throw from `onError` propagates unchanged. Before, on a non-OK response it
    was turned into a network error and `onError` ran a second time with it.
  - A timeout is never retried, even when the fetch rejects with an error that is
    not named `AbortError`.
  - A 2xx body that does not parse (for example an empty body sent as
    `application/json`) becomes a `ClientError` with the real status, the parse
    error as `cause` and the raw text as `body`. It calls `onError` and is never
    retried. Before, it was a retried `ClientError(0, 'Network Error')`. A body that fails to read (a reset mid-stream) stays a retryable
    network error, now with its `cause`; a non-OK body that fails to read also
    keeps it as `cause`.

  Response validation is opt-in through `validateResponses?: boolean | 'warn'`
  (default `false`, today's behaviour):
  - When the route declares a schema for the response status, the call returns
    the schema's validated data, so transforms and stripping apply and the
    runtime value matches the declared type.
  - An undeclared 2xx, a declared status without a schema, and 204/205/304 are
    not validated.
  - With `true`, a failure throws `ResponseValidationError`, a `ClientError` with
    `code: 'RESPONSE_VALIDATION_ERROR'` and the schema's `issues`. It calls
    `onError` and is never retried.
  - With `'warn'`, a failure is reported to `onResponseValidationError` (default
    `console.warn`) and the unvalidated data is returned. It does not call
    `onError`.

  `ResponseValidationError` is exported from the package entry. The hooks
  packages inherit both options through their `ClientConfig`.

### Patch Changes

- Updated dependencies [36567c0]
  - @cosmneo/onion-lasagna@1.0.0-beta.6

## 1.0.0-beta.5

### Patch Changes

- Updated dependencies [49f11ea]
  - @cosmneo/onion-lasagna@1.0.0-beta.5

## 1.0.0-beta.4

### Patch Changes

- Updated dependencies [a922e76]
  - @cosmneo/onion-lasagna@1.0.0-beta.4

## 1.0.0-beta.3

### Patch Changes

- Updated dependencies [4f6bb6b]
  - @cosmneo/onion-lasagna@1.0.0-beta.3

## 1.0.0-beta.2

### Patch Changes

- @cosmneo/onion-lasagna@1.0.0-beta.2

## 1.0.0-beta.1

### Patch Changes

- Updated dependencies [f1b086c]
  - @cosmneo/onion-lasagna@1.0.0-beta.1

## 1.0.0-beta.0

### Patch Changes

- Updated dependencies [01b4e2e]
  - @cosmneo/onion-lasagna@1.0.0-beta.0
