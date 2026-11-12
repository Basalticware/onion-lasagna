import { CodedError } from '../../global/exceptions/coded-error.error';
import { InfraError } from '../exceptions/infra.error';

/** @internal Function signature for wrapped methods. */
type UnknownFn = (...args: unknown[]) => unknown;

/**
 * Abstract base class for outbound adapters (secondary/driven ports).
 *
 * ## Wrapping contract
 *
 * Every **function-valued property** on the concrete instance is automatically
 * wrapped with error-handling, including:
 *
 * - Prototype methods defined with the `method() {}` syntax.
 * - Arrow-function **class fields** (`myFn = () => {}`), which are own
 *   enumerable properties created *after* `super()` returns.
 *
 * ### What is wrapped
 *
 * | Return type                          | Handling                                     |
 * | ------------------------------------ | -------------------------------------------- |
 * | Sync value                           | try/catch → `createInfraError`              |
 * | `instanceof Promise`                 | `.catch()` → `createInfraError`             |
 * | Duck-typed thenable (`then` present) | `.catch()` via `Promise.resolve()` wrapper  |
 * | `AsyncGenerator` (Symbol.asyncIterator) | wraps each `.next()` call                 |
 * | `Generator` (Symbol.iterator)        | wraps each `.next()` call                   |
 *
 * ### What is NOT wrapped
 *
 * - Getters / setters.
 * - Methods on `BaseOutboundAdapter.prototype` itself (infrastructure methods).
 * - `createInfraError` itself.
 *
 * ### Known errors pass through
 *
 * Known errors pass through; unknown errors are wrapped. If the thrown (or
 * rejected) value is already an `instanceof CodedError` — an `InfraError`
 * subtype, but equally a `ConflictError`, `NotFoundError`,
 * `UnprocessableError`, `DomainError`, … — it is re-thrown as-is so that its
 * subtype and error code are preserved (a 409 stays a 409 instead of being
 * masked as a 500). Only values that are not a `CodedError` (plain `Error`s,
 * driver errors, non-error throwables) are handed to `createInfraError`.
 *
 * ### Configurability
 *
 * All wrapped properties are installed with `configurable: true` so that
 * test spies (`vi.spyOn`, `jest.spyOn`) can replace and restore them.
 *
 * ### Implementation approach — lazy Proxy
 *
 * The class returns a `Proxy` from its constructor rather than walking the
 * prototype chain eagerly in `super()`.  This is necessary because arrow-field
 * class properties are own-instance properties assigned **after** `super()`
 * returns; they do not exist on `this` at `super()` time and therefore cannot
 * be discovered by a plain constructor-time scan.
 *
 * A per-instance `WeakMap`-backed cache memoises the wrapped version of each
 * method so each accessor pays the one-time cost only on first call.
 *
 * @example
 * ```typescript
 * class UserRepository extends BaseOutboundAdapter {
 *   constructor(private db: Database) {
 *     super();
 *   }
 *
 *   async findById(id: string): Promise<User | null> {
 *     return this.db.users.findUnique({ where: { id } });
 *   }
 *
 *   // Arrow fields are also wrapped automatically:
 *   save = async (user: User): Promise<void> => {
 *     await this.db.users.upsert(user);
 *   };
 *
 *   protected override createInfraError(error: unknown, methodName: string): InfraError {
 *     return new DbError({
 *       message: `Database error in ${methodName}`,
 *       cause: error,
 *     });
 *   }
 * }
 * ```
 */
export abstract class BaseOutboundAdapter {
  /**
   * Initializes the adapter.
   *
   * Returns a `Proxy` so that arrow-field class properties — which are
   * assigned **after** `super()` returns — are also intercepted and wrapped.
   */
  constructor() {
    // Per-instance cache: property name → wrapped function.
    // Stored on the target (real instance) so the Proxy's get trap can reach it.
    const wrapCache = new Map<string | symbol, UnknownFn>();

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const target = this;

    const proxy = new Proxy(target, {
      get(obj, prop, receiver) {
        // Retrieve the raw value from the real instance / prototype chain.
        const raw = Reflect.get(obj, prop, receiver);

        // Only intercept callable, non-constructor own-or-prototype functions
        // that do NOT belong to BaseOutboundAdapter itself.
        if (
          typeof prop !== 'string' ||
          typeof raw !== 'function' ||
          prop === 'constructor' ||
          // Skip infrastructure methods on the base class itself
          Object.prototype.hasOwnProperty.call(BaseOutboundAdapter.prototype, prop)
        ) {
          return raw;
        }

        // Check the descriptor to skip getters (they already returned above via Reflect.get)
        const descriptor =
          Object.getOwnPropertyDescriptor(obj, prop) ??
          (() => {
            let p: object | null = Object.getPrototypeOf(obj);
            while (p && p !== Object.prototype) {
              const d = Object.getOwnPropertyDescriptor(p, prop);
              if (d) return d;
              p = Object.getPrototypeOf(p);
            }
            return undefined;
          })();

        if (descriptor?.get || descriptor?.set) {
          return raw;
        }

        // Return memoised wrapper if already built
        if (wrapCache.has(prop)) {
          return wrapCache.get(prop) as UnknownFn;
        }

        // Build the wrapper
        const methodName = prop;
        const wrapped: UnknownFn = (...args: unknown[]) => {
          let result: unknown;
          try {
            result = Reflect.apply(raw as UnknownFn, receiver, args);
          } catch (error) {
            if (error instanceof CodedError) throw error;
            throw (receiver as BaseOutboundAdapter).createInfraError(error, methodName);
          }

          // AsyncGenerator: has Symbol.asyncIterator
          if (
            result !== null &&
            result !== undefined &&
            typeof (result as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] ===
              'function' &&
            typeof (result as { next?: unknown }).next === 'function'
          ) {
            return wrapAsyncGenerator(result as AsyncGenerator<unknown>, (error) =>
              (receiver as BaseOutboundAdapter).createInfraError(error, methodName),
            );
          }

          // SyncGenerator: has Symbol.iterator AND a .next() but is not itself a Promise
          if (
            result !== null &&
            result !== undefined &&
            typeof (result as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function' &&
            typeof (result as { next?: unknown }).next === 'function' &&
            typeof (result as { then?: unknown }).then !== 'function'
          ) {
            return wrapSyncGenerator(result as Generator<unknown>, (error) =>
              (receiver as BaseOutboundAdapter).createInfraError(error, methodName),
            );
          }

          // Thenable (duck-typed, broader than instanceof Promise).
          // Use Promise.resolve() to normalise any thenable (custom or native)
          // before attaching .catch() — avoids assuming the value has .catch().
          if (
            result !== null &&
            result !== undefined &&
            typeof (result as { then?: unknown }).then === 'function'
          ) {
            return Promise.resolve(result as PromiseLike<unknown>).catch((error: unknown) => {
              if (error instanceof CodedError) throw error;
              throw (receiver as BaseOutboundAdapter).createInfraError(error, methodName);
            });
          }

          return result;
        };

        // Install on the instance so future direct-property access also gets the wrapper,
        // and so that Object.defineProperty(instance, prop, ...) from spies works.
        Object.defineProperty(obj, prop, {
          value: wrapped,
          writable: true,
          enumerable: false,
          configurable: true,
        });

        wrapCache.set(prop, wrapped);
        return wrapped;
      },
    });

    return proxy;
  }

  /**
   * Factory method for creating infrastructure errors.
   *
   * Called only for errors that are not already a `CodedError`; known coded
   * errors thrown inside an adapter method are re-thrown unchanged.
   *
   * Override this in subclasses to return specific error types
   * (e.g., `DbError`, `NetworkError`, `ExternalServiceError`).
   *
   * @param error - The original error that was caught
   * @param methodName - Name of the method where the error occurred (for debugging)
   * @returns An InfraError instance wrapping the original error
   */
  protected createInfraError(error: unknown, methodName: string): InfraError {
    return new InfraError({
      message: `Outbound adapter error in ${methodName}`,
      cause: error,
    });
  }
}

/**
 * @internal Wraps an AsyncGenerator so any non-`CodedError` thrown during iteration is converted
 * to an InfraError (known `CodedError`s pass through).
 * Implemented as a delegating generator (`yield*`) so the full async-iterator protocol
 * (next-args, return, throw, return value) is preserved and the result is a real AsyncGenerator.
 */
async function* wrapAsyncGenerator(
  gen: AsyncGenerator<unknown>,
  makeInfraError: (error: unknown) => InfraError,
): AsyncGenerator<unknown> {
  try {
    return yield* gen;
  } catch (error) {
    if (error instanceof CodedError) throw error;
    throw makeInfraError(error);
  }
}

/**
 * @internal Wraps a sync Generator so any non-`CodedError` thrown during iteration is converted
 * to an InfraError (known `CodedError`s pass through).
 * Delegates via `yield*` to preserve the full iterator protocol and produce a real Generator.
 */
function* wrapSyncGenerator(
  gen: Generator<unknown>,
  makeInfraError: (error: unknown) => InfraError,
): Generator<unknown> {
  try {
    return yield* gen;
  } catch (error) {
    if (error instanceof CodedError) throw error;
    throw makeInfraError(error);
  }
}
