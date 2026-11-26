/**
 * @fileoverview Factory function for creating type-safe API clients.
 *
 * The `createClient` function generates a fully-typed HTTP client from
 * a router definition. The client provides methods for each route with
 * complete type safety for request and response data.
 *
 * @module unified/client/create-client
 */

import type {
  RouterConfig,
  RouterDefinition,
  PrettifyDeep,
} from '@cosmneo/onion-lasagna/http/route';
import {
  isRouteDefinition,
  isRouterDefinition,
  buildPath,
  hasPathParams,
} from '@cosmneo/onion-lasagna/http/route';
import type { SchemaAdapter } from '@cosmneo/onion-lasagna/http/schema';
import type { ClientCallOptions, ClientConfig, InferClient } from './client-types';
import { ClientError, ResponseValidationError } from './client-types';

/**
 * Default retry status codes.
 */
const DEFAULT_RETRY_STATUS_CODES = [408, 429, 500, 502, 503, 504];

/**
 * Default idempotent HTTP methods eligible for automatic retry.
 * POST and PATCH are intentionally excluded — retry them only when explicitly opted in.
 */
const DEFAULT_RETRY_METHODS = ['GET', 'HEAD', 'DELETE', 'PUT', 'OPTIONS'];

/**
 * Default request timeout in milliseconds.
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * Creates a type-safe API client from a router definition.
 *
 * The client mirrors the structure of the router, providing methods
 * for each route with full TypeScript type inference.
 *
 * @param router - Router definition or router config
 * @param config - Client configuration
 * @returns A fully-typed API client
 *
 * @example Basic usage
 * ```typescript
 * import { createClient } from '@cosmneo/onion-lasagna-client';
 *
 * const api = defineRouter({
 *   users: {
 *     list: listUsersRoute,
 *     get: getUserRoute,
 *     create: createUserRoute,
 *   },
 * });
 *
 * const client = createClient(api, {
 *   baseUrl: 'http://localhost:3000',
 * });
 *
 * // Fully typed API calls
 * const users = await client.users.list();
 * const user = await client.users.get({ pathParams: { userId: '123' } });
 * const newUser = await client.users.create({ body: { name: 'John' } });
 * ```
 *
 * @example With interceptors
 * ```typescript
 * const client = createClient(api, {
 *   baseUrl: 'http://localhost:3000',
 *   headers: {
 *     'Content-Type': 'application/json',
 *   },
 *   onRequest: async (request) => {
 *     // Add auth token
 *     const token = await getAuthToken();
 *     request.headers.set('Authorization', `Bearer ${token}`);
 *     return request;
 *   },
 *   onResponse: async (response) => {
 *     // Log responses
 *     console.log(`${response.status} ${response.url}`);
 *     return response;
 *   },
 *   onError: async (error) => {
 *     // Handle errors globally
 *     if (error.status === 401) {
 *       await refreshToken();
 *     }
 *   },
 * });
 * ```
 *
 * @example With retry
 * ```typescript
 * const client = createClient(api, {
 *   baseUrl: 'http://localhost:3000',
 *   retry: {
 *     attempts: 3,
 *     delay: 1000,
 *     retryOn: [500, 502, 503, 504],
 *   },
 * });
 * ```
 */
export function createClient<T extends RouterConfig>(
  router: T | RouterDefinition<T>,
  config: ClientConfig,
): PrettifyDeep<InferClient<T>> {
  const routes = isRouterDefinition(router) ? router.routes : router;
  return buildClientProxy(routes, config) as PrettifyDeep<InferClient<T>>;
}

/**
 * Recursively builds a client proxy from router config.
 */
function buildClientProxy<T extends RouterConfig>(routes: T, config: ClientConfig): InferClient<T> {
  const client: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(routes)) {
    if (isRouteDefinition(value)) {
      // Create a method for this route
      client[key] = createRouteMethod(value, config);
    } else if (isRouterDefinition(value)) {
      // Recursively build nested router
      client[key] = buildClientProxy(value.routes, config);
    } else if (typeof value === 'object' && value !== null) {
      // Plain object - recurse
      client[key] = buildClientProxy(value as RouterConfig, config);
    }
  }

  return client as InferClient<T>;
}

/**
 * Computes exponential backoff with full jitter.
 *
 * delay = random(0, min(maxDelay, base * 2^attempt))
 */
function computeBackoff(attempt: number, base: number, maxDelay: number): number {
  const ceiling = Math.min(maxDelay, base * Math.pow(2, attempt));
  return Math.random() * ceiling;
}

/**
 * Parses a Retry-After header value and returns the delay in milliseconds.
 * Supports both integer seconds and HTTP-date formats.
 * Returns undefined when the header is absent or unparseable.
 */
function parseRetryAfterMs(retryAfterHeader: string | null): number | undefined {
  if (!retryAfterHeader) {
    return undefined;
  }

  // Integer seconds
  const seconds = Number(retryAfterHeader.trim());
  if (!Number.isNaN(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  // HTTP-date (RFC 7231)
  const dateMs = Date.parse(retryAfterHeader);
  if (!Number.isNaN(dateMs)) {
    const delayMs = dateMs - Date.now();
    return delayMs > 0 ? delayMs : 0;
  }

  return undefined;
}

/**
 * The parts of a route definition the client method reads at runtime.
 */
interface RouteShape {
  readonly method: string;
  readonly path: string;
  readonly request?: unknown;
  readonly responses?: Readonly<Record<string, { readonly schema?: SchemaAdapter }>>;
}

/**
 * Maps an error thrown by `fetch`, or by reading a response body, to a
 * `ClientError` with status 0, keeping the original as `cause`.
 */
function toTransportError(
  error: unknown,
  didTimeout: boolean,
  effectiveTimeout: number,
): { clientError: ClientError; retryable: boolean } {
  const isAbortError =
    error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

  let errorMessage: string;
  let errorStatus: string;

  if (didTimeout) {
    errorMessage = `Request timeout after ${effectiveTimeout}ms`;
    errorStatus = 'Timeout';
  } else if (isAbortError) {
    errorMessage = 'Request was aborted';
    errorStatus = 'Aborted';
  } else {
    errorMessage = error instanceof Error ? error.message : 'Network error';
    errorStatus = 'Network Error';
  }

  return {
    clientError: new ClientError(errorMessage, 0, errorStatus, undefined, undefined, {
      cause: error,
    }),
    // Timeouts and aborts are never retried
    retryable: !didTimeout && !isAbortError,
  };
}

/**
 * Hands a client error to `onError` once, then throws it. A throw from
 * `onError` propagates unchanged.
 */
async function fail(error: ClientError, config: ClientConfig): Promise<never> {
  if (config.onError) {
    await config.onError(error);
  }
  throw error;
}

/**
 * F2: validates a successful body against the schema the route declares for
 * the response status, when `validateResponses` asks for it.
 *
 * Returns the schema's validated data on success. An undeclared status or a
 * declared status without a schema returns the body unchanged.
 */
async function validateResponseBody(
  route: RouteShape,
  response: Response,
  body: unknown,
  config: ClientConfig,
): Promise<unknown> {
  const mode = config.validateResponses ?? false;
  if (!mode) {
    return body;
  }

  const schema = route.responses?.[String(response.status)]?.schema;
  if (!schema) {
    return body;
  }

  const result = schema.validate(body);
  if (result.success) {
    return result.data;
  }

  const error = new ResponseValidationError(
    response.status,
    response.statusText,
    body,
    result.issues,
    response,
  );

  if (mode === 'warn') {
    if (config.onResponseValidationError) {
      config.onResponseValidationError(error);
    } else {
      console.warn(error.message, error);
    }
    return body;
  }

  // Deterministic: never retried
  return fail(error, config);
}

/**
 * Creates a method for a single route.
 */
function createRouteMethod(
  route: RouteShape,
  config: ClientConfig,
): (input?: Record<string, unknown>, options?: ClientCallOptions) => Promise<unknown> {
  return async (input?: Record<string, unknown>, options?: ClientCallOptions) => {
    const fetchFn = config.fetch ?? fetch;

    // Build the URL (joinUrl handles trailing/leading slash normalization)
    let url = joinUrl(config.baseUrl, route.path);

    // Replace path parameters
    const pathParams = input?.['pathParams'];
    if (pathParams && hasPathParams(route.path)) {
      url = buildPath(url, pathParams as Record<string, string>);
    }

    // Add query parameters
    // Arrays are emitted as repeated keys (e.g. tags=a&tags=b) rather than comma-joined
    const queryInput = input?.['query'];
    if (queryInput) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(queryInput as Record<string, unknown>)) {
        if (value === undefined || value === null) {
          continue;
        }
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item !== undefined && item !== null) {
              params.append(key, String(item));
            }
          }
        } else {
          params.append(key, String(value));
        }
      }
      const queryString = params.toString();
      if (queryString) {
        url += `?${queryString}`;
      }
    }

    // Build headers
    const headers = new Headers(config.headers);
    const headersInput = input?.['headers'];
    if (headersInput) {
      for (const [key, value] of Object.entries(headersInput as Record<string, string>)) {
        headers.set(key, value);
      }
    }

    // Set content type for body — use !== undefined so falsy values (false, 0, '', null) are sent
    const bodyInput = input?.['body'];
    if (bodyInput !== undefined && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    // Build request options
    const requestInit: RequestInit = {
      method: route.method,
      headers,
      body: bodyInput !== undefined ? JSON.stringify(bodyInput) : undefined,
    };

    // Create the request
    let request = new Request(url, requestInit);

    // Apply request interceptor
    if (config.onRequest) {
      request = await config.onRequest(request);
    }

    // Execute with retry logic
    const retryAttempts = config.retry?.attempts ?? 0;
    const retryBaseDelay = config.retry?.delay ?? 1000;
    const retryMaxDelay = config.retry?.maxDelay ?? 30000;
    const retryDelayFn = config.retry?.delayFn;
    const retryOn = config.retry?.retryOn ?? DEFAULT_RETRY_STATUS_CODES;
    // C10-3: Only retry idempotent methods by default; POST/PATCH require explicit opt-in
    const retryMethods = config.retry?.retryMethods ?? DEFAULT_RETRY_METHODS;
    const isMethodRetryable = retryMethods.includes(route.method.toUpperCase());
    const backoff = (attempt: number): number =>
      retryDelayFn ? retryDelayFn(attempt) : computeBackoff(attempt, retryBaseDelay, retryMaxDelay);

    // C10-1: apply the documented 30 s default timeout when none is configured
    const effectiveTimeout = config.timeout ?? DEFAULT_TIMEOUT;

    // Resolve external signal once (per call, not per attempt)
    const externalSignal = options?.signal;
    const hasSignalSource = Boolean(effectiveTimeout) || Boolean(externalSignal);

    let lastError: ClientError | undefined;

    for (let attempt = 0; attempt <= retryAttempts; attempt++) {
      // C16 abort-alloc: only allocate AbortController when actually needed
      let controller: AbortController | undefined;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let didTimeout = false;
      let effectiveSignal: AbortSignal | undefined;

      if (hasSignalSource) {
        controller = new AbortController();

        if (effectiveTimeout) {
          timeoutId = setTimeout(() => {
            didTimeout = true;
            controller!.abort();
          }, effectiveTimeout);
        }

        // C10-2: merge external signal with internal timeout controller
        if (externalSignal) {
          // AbortSignal.any is available in Node 20+ and modern browsers
          if (typeof AbortSignal.any === 'function') {
            effectiveSignal = AbortSignal.any([controller.signal, externalSignal]);
          } else {
            // Fallback: forward abort from external signal to internal controller
            if (externalSignal.aborted) {
              controller.abort(externalSignal.reason);
            } else {
              externalSignal.addEventListener('abort', () => {
                controller!.abort(externalSignal.reason);
              });
            }
            effectiveSignal = controller.signal;
          }
        } else {
          effectiveSignal = controller.signal;
        }
      }

      try {
        // F1: only the fetch itself is guarded as a transport failure. Throws from
        // onResponse and onError propagate unchanged.
        let response: Response;
        try {
          response = await fetchFn(
            request.clone(),
            effectiveSignal ? { signal: effectiveSignal } : {},
          );
        } catch (error) {
          const { clientError, retryable } = toTransportError(error, didTimeout, effectiveTimeout);

          // Don't retry timeouts, user-initiated aborts, or non-idempotent methods
          if (attempt < retryAttempts && retryable && isMethodRetryable) {
            lastError = clientError;
            await sleep(backoff(attempt));
            continue;
          }

          return await fail(clientError, config);
        }

        // Apply response interceptor
        if (config.onResponse) {
          response = await config.onResponse(response);
        }

        // Handle non-OK responses
        if (!response.ok) {
          // C16: decide whether to retry BEFORE parsing the body to avoid wasted
          // body consumption on transient failures during storms.
          if (attempt < retryAttempts && retryOn.includes(response.status) && isMethodRetryable) {
            // C16-1: honor Retry-After for 429/503, else use exponential backoff with jitter
            const retryAfterMs =
              response.status === 429 || response.status === 503
                ? parseRetryAfterMs(response.headers.get('Retry-After'))
                : undefined;

            const delay = retryAfterMs ?? backoff(attempt);

            // Stash a minimal error in case we exhaust all retries
            lastError = new ClientError(
              `Request failed with status ${response.status}`,
              response.status,
              response.statusText,
              undefined,
              response,
            );

            await sleep(delay);
            continue;
          }

          // Not retrying — parse the body once as text then try to JSON-decode it.
          // Reading as text first prevents the body double-read bug where calling
          // response.json() consumes the stream, making response.text() return ''.
          let body: unknown;
          let readFailure: { cause: unknown } | undefined;
          try {
            const text = await response.text();
            try {
              body = JSON.parse(text);
            } catch {
              body = text;
            }
          } catch (readError) {
            readFailure = { cause: readError };
            body = {
              _parseError: 'Failed to read response body',
              _readError: readError instanceof Error ? readError.message : 'Read failed',
            };
          }

          return await fail(
            new ClientError(
              `Request failed with status ${response.status}`,
              response.status,
              response.statusText,
              body,
              response,
              readFailure,
            ),
            config,
          );
        }

        // Parse successful response
        // 204 No Content, 205 Reset Content, 304 Not Modified have no body
        if (response.status === 204 || response.status === 205 || response.status === 304) {
          return undefined;
        }

        // A failure while the body streams in (reset, timeout, abort) is a
        // transport failure, retried like a fetch throw.
        let text: string;
        try {
          text = await response.text();
        } catch (error) {
          const { clientError, retryable } = toTransportError(error, didTimeout, effectiveTimeout);

          if (attempt < retryAttempts && retryable && isMethodRetryable) {
            lastError = clientError;
            await sleep(backoff(attempt));
            continue;
          }

          return await fail(clientError, config);
        }

        // F1: a 2xx body that does not parse is a client error with the real
        // status and the parse error as its cause. It is deterministic, so it is
        // never retried.
        let body: unknown = text;
        if (response.headers.get('Content-Type')?.includes('application/json')) {
          try {
            body = JSON.parse(text);
          } catch (error) {
            return await fail(
              new ClientError(
                `Failed to parse response body (status ${response.status})`,
                response.status,
                response.statusText,
                text,
                response,
                { cause: error },
              ),
              config,
            );
          }
        }

        return await validateResponseBody(route, response, body, config);
      } finally {
        // Always clear timeout to prevent memory leaks
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    }

    // Should not reach here, but just in case
    throw lastError ?? new ClientError('Request failed', 0, 'Unknown Error');
  };
}

/**
 * Sleep helper for retry delays.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Joins base URL and path, ensuring exactly one slash between them.
 *
 * Handles cases where:
 * - baseUrl ends with `/` and path starts with `/` → no double slash
 * - baseUrl doesn't end with `/` and path doesn't start with `/` → adds slash
 * - Either one has the slash → uses it
 */
function joinUrl(baseUrl: string, path: string): string {
  const hasTrailingSlash = baseUrl.endsWith('/');
  const hasLeadingSlash = path.startsWith('/');

  if (hasTrailingSlash && hasLeadingSlash) {
    // Remove duplicate slash: "http://localhost/" + "/api" → "http://localhost/api"
    return baseUrl.slice(0, -1) + path;
  }
  if (!hasTrailingSlash && !hasLeadingSlash) {
    // Add missing slash: "http://localhost" + "api" → "http://localhost/api"
    return baseUrl + '/' + path;
  }
  // One has the slash already
  return baseUrl + path;
}
