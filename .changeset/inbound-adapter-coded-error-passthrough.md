---
'@cosmneo/onion-lasagna': patch
---

**`BaseInboundAdapter.execute` passes every `CodedError` through and masks
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
