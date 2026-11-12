---
'@cosmneo/onion-lasagna': patch
---

**`BaseOutboundAdapter` no longer masks known errors as a 500.** Its method
wrapper let only `InfraError` pass through; every other error, including known
coded errors such as `ConflictError` (409), `UnprocessableError` (422) and
`NotFoundError` (404), was replaced by `InfraError("Outbound adapter error in
<method>")`, which the presentation layer masks as a 500. All four catch sites
(sync throw, rejected thenable, async generator, sync generator) now pass
through any `CodedError` unchanged, matching the library's rule: known errors
pass through, unknown errors are wrapped. Plain `Error`s and other unknown
throwables are still handed to `createInfraError`.
