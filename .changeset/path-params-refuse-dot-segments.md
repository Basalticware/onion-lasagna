---
'@cosmneo/onion-lasagna': minor
---

**`buildPath` refuses a `.` or `..` path value.** Such a value became a dot
segment that URL parsing collapses: with route `/users/:id/profile`,
`id: '..'` and base URL `http://h/api`, the request went to
`http://h/api/profile`. A path value could retarget the call to another route
on the same host, with the caller's method and credentials. Percent-encoding
does not help, as WHATWG URL treats `%2e%2e` as `..` too.

Now `buildPath` throws an `InvalidRequestError` (code `INVALID_REQUEST`, one
validation error on field `pathParams.<name>`) when a value that fills a
placeholder is exactly `.` or `..` after encoding. Every client built on the
core path builder, such as `createClient`, refuses the call before it sends a
request. Values that merely contain dots (`a.b`, `..a`, `...`) still build.

The refusal is not a `ClientError` and does not reach `onError`: the call
rejects before any request exists. Match it on `error.code ===
'INVALID_REQUEST'` (or `getErrorTypeName(error) === 'InvalidRequestError'`
from `/global`) rather than `instanceof`, since `InvalidRequestError` is
exported from the root entry only and CommonJS entries each carry their own
copy of the class. The check is on the whole value, not the segment it lands
in, so `/files/:name.json` with `name: '..'` is refused too.
