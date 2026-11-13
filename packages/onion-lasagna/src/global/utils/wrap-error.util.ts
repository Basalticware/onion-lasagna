/**
 * Error wrapping utilities for boundary error handling.
 *
 * Provides functions to wrap code execution with error transformation,
 * converting caught errors into typed Error instances.
 * Useful at layer boundaries (infra, use case, controller) to normalize errors.
 *
 * @example Wrapping async database calls
 * ```typescript
 * const user = await wrapErrorAsync(
 *   () => this.db.query('SELECT * FROM users WHERE id = ?', [id]),
 *   (cause) => new DbError({ message: 'Failed to fetch user', cause }),
 * );
 * ```
 *
 * @example Wrapping sync operations
 * ```typescript
 * const parsed = wrapError(
 *   () => JSON.parse(data),
 *   (cause) => new InvariantViolationError({
 *     message: 'Invalid JSON format',
 *     cause,
 *   }),
 * );
 * ```
 *
 * @module
 */

/**
 * Factory function that creates an Error from a caught error.
 *
 * @typeParam E - The specific Error subclass to create
 * @param cause - The original caught error
 * @returns A new Error instance
 */
export type ErrorFactory<E extends Error> = (cause: unknown) => E;

/**
 * Wraps a synchronous function with error transformation.
 *
 * Executes the provided function and catches any thrown errors,
 * transforming them using the error factory.
 *
 * @typeParam T - The return type of the wrapped function
 * @typeParam E - The Error subclass to throw on error
 * @param fn - The function to execute
 * @param errorFactory - Factory to create the typed error from the caught error
 * @returns The result of the function if successful
 * @throws {E} The transformed error if the function throws
 *
 * @example
 * ```typescript
 * const config = wrapError(
 *   () => JSON.parse(configString),
 *   (cause) => new InvariantViolationError({
 *     message: 'Invalid configuration format',
 *     code: 'CONFIG_PARSE_ERROR',
 *     cause,
 *   }),
 * );
 * ```
 */
export function wrapError<T, E extends Error>(fn: () => T, errorFactory: ErrorFactory<E>): T {
  try {
    return fn();
  } catch (error) {
    throw errorFactory(error);
  }
}

/**
 * Wraps an asynchronous function with error transformation.
 *
 * Executes the provided async function and catches any thrown errors,
 * transforming them using the error factory.
 *
 * @typeParam T - The return type of the wrapped function
 * @typeParam E - The Error subclass to throw on error
 * @param fn - The async function to execute
 * @param errorFactory - Factory to create the typed error from the caught error
 * @returns A promise resolving to the result if successful
 * @throws {E} The transformed error if the function throws
 *
 * @example Repository usage
 * ```typescript
 * async findById(id: string): Promise<User | null> {
 *   return wrapErrorAsync(
 *     () => this.db.users.findUnique({ where: { id } }),
 *     (cause) => new DbError({
 *       message: `Failed to find user by ID: ${id}`,
 *       cause,
 *     }),
 *   );
 * }
 * ```
 *
 * @example External service usage
 * ```typescript
 * async sendEmail(to: string, body: string): Promise<void> {
 *   await wrapErrorAsync(
 *     () => this.emailClient.send({ to, body }),
 *     (cause) => new ExternalServiceError({
 *       message: 'Email delivery failed',
 *       code: 'EMAIL_SEND_FAILED',
 *       cause,
 *     }),
 *   );
 * }
 * ```
 */
export async function wrapErrorAsync<T, E extends Error>(
  fn: () => Promise<T>,
  errorFactory: ErrorFactory<E>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw errorFactory(error);
  }
}

/**
 * Constructor type for error classes (including abstract classes).
 *
 * Used to specify error types that should pass through without transformation.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ErrorConstructor = abstract new (...args: any[]) => Error;

/**
 * Wraps a synchronous function with conditional error transformation.
 *
 * Executes the provided function and catches any thrown errors.
 * Errors matching any of the passthrough types are re-thrown as-is.
 * All other errors are transformed using the error factory.
 *
 * @typeParam T - The return type of the wrapped function
 * @typeParam E - The Error subclass to throw for unknown errors
 * @param fn - The function to execute
 * @param errorFactory - Factory to create the typed error from unknown errors
 * @param passthroughTypes - Array of error classes to re-throw without transformation
 * @returns The result of the function if successful
 * @throws The original error if it matches a passthrough type
 * @throws {E} The transformed error for unknown error types
 *
 * @example Controller boundary
 * ```typescript
 * const result = wrapErrorUnless(
 *   () => this.requestMapper(input),
 *   (cause) => new ControllerError({ message: 'Mapping failed', cause }),
 *   [CodedError],
 * );
 * ```
 */
export function wrapErrorUnless<T, E extends Error>(
  fn: () => T,
  errorFactory: ErrorFactory<E>,
  passthroughTypes: ErrorConstructor[],
): T {
  try {
    return fn();
  } catch (error) {
    if (passthroughTypes.some((Type) => error instanceof Type)) {
      throw error;
    }
    throw errorFactory(error);
  }
}

/**
 * Wraps an asynchronous function with conditional error transformation.
 *
 * Executes the provided async function and catches any thrown errors.
 * Errors matching any of the passthrough types are re-thrown as-is.
 * All other errors are transformed using the error factory.
 *
 * @typeParam T - The return type of the wrapped function
 * @typeParam E - The Error subclass to throw for unknown errors
 * @param fn - The async function to execute
 * @param errorFactory - Factory to create the typed error from unknown errors
 * @param passthroughTypes - Array of error classes to re-throw without transformation
 * @returns A promise resolving to the result if successful
 * @throws The original error if it matches a passthrough type
 * @throws {E} The transformed error for unknown error types
 *
 * @example Use case boundary (what `BaseInboundAdapter.execute` does)
 * ```typescript
 * // Every coded error passes through; an unknown error becomes an InfraError,
 * // which the presentation layer masks as a 500 / INTERNAL_ERROR.
 * return wrapErrorUnlessAsync(
 *   () => this.handle(input),
 *   (cause) => new InfraError({ message: 'Unexpected use case handler error', cause }),
 *   [CodedError],
 * );
 * ```
 *
 * @example Controller boundary
 * ```typescript
 * return wrapErrorUnlessAsync(
 *   async () => {
 *     const result = await this.useCase.execute(input);
 *     return this.responseMapper(result);
 *   },
 *   (cause) => new ControllerError({ message: 'Controller failed', cause }),
 *   [CodedError],
 * );
 * ```
 */
export async function wrapErrorUnlessAsync<T, E extends Error>(
  fn: () => Promise<T>,
  errorFactory: ErrorFactory<E>,
  passthroughTypes: ErrorConstructor[],
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (passthroughTypes.some((Type) => error instanceof Type)) {
      throw error;
    }
    throw errorFactory(error);
  }
}
