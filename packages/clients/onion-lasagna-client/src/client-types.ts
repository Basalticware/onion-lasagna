/**
 * @fileoverview Client types for the unified route system (v2 — flat API).
 *
 * @module unified/client/types
 */

import type {
  RouteDefinition,
  RouterConfig,
  PathParams,
  HasPathParams,
  PrettifyDeep,
} from '@cosmneo/onion-lasagna/http/route';
import type { ValidationIssue } from '@cosmneo/onion-lasagna/http/schema';

// ============================================================================
// Client Configuration
// ============================================================================

/**
 * Per-call options that can be passed as a second argument to a client method.
 */
export interface ClientCallOptions {
  /**
   * An AbortSignal to cancel the request.
   * Merged with the internal timeout controller (if any) via AbortSignal.any.
   */
  readonly signal?: AbortSignal;
}

/**
 * Configuration for creating a client.
 */
export interface ClientConfig {
  /**
   * Base URL of the API server.
   * All route paths will be appended to this.
   *
   * @example 'http://localhost:3000'
   * @example 'https://api.example.com/v1'
   */
  readonly baseUrl: string;

  /**
   * Default headers to include in all requests.
   */
  readonly headers?: Record<string, string>;

  /**
   * Request timeout in milliseconds.
   * @default 30000
   */
  readonly timeout?: number;

  /**
   * Custom fetch implementation.
   * Defaults to global fetch.
   */
  readonly fetch?: typeof fetch;

  /**
   * Request interceptor.
   * Called before each request is sent.
   */
  readonly onRequest?: (request: Request) => Request | Promise<Request>;

  /**
   * Response interceptor.
   * Called after each response is received.
   */
  readonly onResponse?: (response: Response) => Response | Promise<Response>;

  /**
   * Error handler.
   * Called once with the `ClientError` before it is thrown: a non-OK response,
   * a network error, timeout or abort, a 2xx body that cannot be parsed, or a
   * `ResponseValidationError`. A throw from this handler propagates unchanged.
   */
  readonly onError?: (error: ClientError) => void | Promise<void>;

  /**
   * Validates each successful response against the route's declared schema
   * for its status.
   *
   * - `false` (default): the parsed body is returned unvalidated.
   * - `true`: the schema's validated data is returned; a failure throws a
   *   `ResponseValidationError` (after `onError`), which is never retried.
   * - `'warn'`: the schema's validated data is returned; a failure is reported
   *   to `onResponseValidationError` and the unvalidated body is returned, so
   *   the value may not match the route's declared response type.
   *
   * An undeclared 2xx status, a declared status without a schema, and
   * 204/205/304 responses are never validated.
   *
   * @default false
   */
  readonly validateResponses?: boolean | 'warn';

  /**
   * Receives a response validation failure when `validateResponses` is `'warn'`.
   * Defaults to `console.warn`.
   */
  readonly onResponseValidationError?: (error: ResponseValidationError) => void;

  /**
   * Retry configuration.
   */
  readonly retry?: {
    /**
     * Number of retry attempts.
     * @default 0
     */
    readonly attempts?: number;

    /**
     * Base delay for the first retry in milliseconds (used for exponential backoff).
     * @default 1000
     */
    readonly delay?: number;

    /**
     * Maximum delay cap in milliseconds for exponential backoff.
     * @default 30000
     */
    readonly maxDelay?: number;

    /**
     * Custom delay function. When provided, overrides the built-in exponential backoff.
     * Receives the zero-based attempt index (0 = first retry).
     */
    readonly delayFn?: (attempt: number) => number;

    /**
     * Status codes that should trigger a retry.
     * @default [408, 429, 500, 502, 503, 504]
     */
    readonly retryOn?: readonly number[];

    /**
     * HTTP methods that are eligible for retry.
     * Defaults to idempotent methods only: GET, HEAD, DELETE, PUT, OPTIONS.
     * Set this explicitly to include non-idempotent methods such as POST or PATCH.
     *
     * @default ['GET', 'HEAD', 'DELETE', 'PUT', 'OPTIONS']
     */
    readonly retryMethods?: readonly string[];
  };
}

// ============================================================================
// Client Errors
// ============================================================================

/**
 * Error thrown by the client.
 *
 * `status` is the HTTP status of the response, or `0` when no response was
 * received (network error, timeout, abort). The original error, when there is
 * one, is kept as `cause`.
 */
export class ClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly body?: unknown,
    public readonly response?: Response,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ClientError';
  }

  /**
   * Returns true if this is a client error (4xx).
   */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  /**
   * Returns true if this is a server error (5xx).
   */
  get isServerError(): boolean {
    return this.status >= 500;
  }

  /**
   * Returns true if this is a network error.
   */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

/**
 * Error thrown when `validateResponses` is `true` and a successful response
 * does not match the schema the route declares for its status.
 *
 * `body` is the unvalidated parsed body; `issues` are the schema's issues,
 * with paths relative to the body.
 */
export class ResponseValidationError extends ClientError {
  /** Mirrors the server's response validation error code. */
  readonly code = 'RESPONSE_VALIDATION_ERROR' as const;

  constructor(
    status: number,
    statusText: string,
    body: unknown,
    public readonly issues: readonly ValidationIssue[],
    response?: Response,
  ) {
    super(`Response validation failed for status ${status}`, status, statusText, body, response);
    this.name = 'ResponseValidationError';
  }
}

// ============================================================================
// Request Types
// ============================================================================

/**
 * Input for a client request method.
 * Only includes properties that are actually needed based on the route.
 */
export type ClientRequestInput<TRoute extends RouteDefinition> = PrettifyDeep<
  // Build the input type based on what the route needs
  (HasPathParams<TRoute['path']> extends true
    ? { pathParams: PathParams<TRoute['path']> }
    : object) &
    (TRoute['_types']['body'] extends undefined ? object : { body: TRoute['_types']['body'] }) &
    (TRoute['_types']['query'] extends undefined ? object : { query: TRoute['_types']['query'] }) &
    (TRoute['_types']['headers'] extends undefined
      ? object
      : { headers: TRoute['_types']['headers'] })
>;

/**
 * Response from a client request.
 * Reads the response type directly from the route's `_types.response`.
 */
export type ClientResponse<TRoute extends RouteDefinition> =
  TRoute['_types']['response'] extends undefined ? void : TRoute['_types']['response'];

// ============================================================================
// Client Types
// ============================================================================

/**
 * A client method for a single route.
 */
export type ClientMethod<TRoute extends RouteDefinition> =
  // Check if input is required
  RequiresInput<TRoute> extends true
    ? (
        input: ClientRequestInput<TRoute>,
        options?: ClientCallOptions,
      ) => Promise<ClientResponse<TRoute>>
    : (
        input?: ClientRequestInput<TRoute>,
        options?: ClientCallOptions,
      ) => Promise<ClientResponse<TRoute>>;

/**
 * Checks if a route requires input (has body, params, or required query).
 */
type RequiresInput<TRoute extends RouteDefinition> =
  HasPathParams<TRoute['path']> extends true
    ? true
    : TRoute['_types']['body'] extends undefined
      ? false
      : true;

/**
 * Recursively builds the client type from a router config.
 *
 * Note: We use `RouteDefinition<any, any, any, any, any, any, any, any>` instead of
 * just `RouteDefinition` because TypeScript's extends check on generic interfaces
 * requires explicit type parameters for proper variance handling.
 */

export type InferClient<T extends RouterConfig> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Required for proper extends check on generic interface
  [K in keyof T]: T[K] extends RouteDefinition<any, any, any, any, any, any, any, any>
    ? ClientMethod<T[K]>
    : T[K] extends RouterConfig
      ? InferClient<T[K]>
      : never;
};
