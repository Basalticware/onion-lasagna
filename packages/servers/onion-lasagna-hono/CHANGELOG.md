# @cosmneo/onion-lasagna-hono

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

- 91c3844: Stream binary response bodies (`Uint8Array`, typed arrays, `ArrayBuffer`, `ReadableStream`) in `registerHonoRoutes` instead of JSON-serializing them. Handlers returning raw bytes (file downloads, image/binary proxies) with a non-JSON `Content-Type` are now written through `c.body()` unchanged, fixing corrupted binary responses.
  - @cosmneo/onion-lasagna@1.0.0-beta.2

## 1.0.0-beta.1

### Patch Changes

- Updated dependencies [f1b086c]
  - @cosmneo/onion-lasagna@1.0.0-beta.1

## 1.0.0-beta.0

### Patch Changes

- Updated dependencies [01b4e2e]
  - @cosmneo/onion-lasagna@1.0.0-beta.0
