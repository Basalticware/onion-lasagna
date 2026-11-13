import type { BaseInboundPort } from '../interfaces/ports/base-inbound.port';
import { CodedError } from '../../global/exceptions/coded-error.error';
import { wrapErrorUnlessAsync } from '../../global/utils/wrap-error.util';
import { InfraError } from '../../infra/exceptions/infra.error';

/**
 * Abstract base class for use case handlers (inbound adapters).
 *
 * Implements the {@link BaseInboundPort} interface and provides:
 * - Two-phase execution: `authorize()` runs before `handle()`
 * - Typed context passing from authorization to business logic
 * - Pass-through for every known error: any {@link CodedError} (UseCaseError and
 *   its subclasses, DomainError, InfraError, ObjectValidationError,
 *   AccessDeniedError, InvalidRequestError, your own coded errors) is re-thrown
 *   unchanged, keeping its class and code
 * - Wrapping of unexpected exceptions (anything that is not a `CodedError`) in an
 *   {@link InfraError}, which the presentation layer masks as a 500 /
 *   `INTERNAL_ERROR`; the original is kept as `cause`
 *
 * Subclasses can override `authorize()` to add authorization checks that run
 * before `handle()`. The authorization phase can return a typed context that
 * is passed to `handle()`, enabling entity caching and avoiding duplicate lookups.
 *
 * @remarks
 * **IMPORTANT — `TAuthContext` override requirement:**
 * When `TAuthContext` is anything other than `void` (the default), the subclass
 * **MUST** override `authorize()`. The base implementation returns
 * `undefined as TAuthContext`, which TypeScript accepts at compile time but will
 * deliver `undefined` to `handle()` at runtime, causing a `TypeError` on any
 * property access. There is no compile-time guard for this footgun.
 *
 * Safe pattern — always override when `TAuthContext` is not `void`:
 * ```typescript
 * // WRONG — compiles clean, crashes at runtime when handle() accesses ctx.userId
 * class BadUseCase extends BaseInboundAdapter<Input, Output, { userId: string }> {
 *   // authorize() not overridden — handle() receives undefined!
 *   protected async handle(input: Input, ctx: { userId: string }): Promise<Output> {
 *     return { id: ctx.userId }; // TypeError: Cannot read properties of undefined
 *   }
 * }
 *
 * // CORRECT — override authorize() whenever TAuthContext is non-void
 * class GoodUseCase extends BaseInboundAdapter<Input, Output, { userId: string }> {
 *   protected async authorize(input: Input): Promise<{ userId: string }> {
 *     return { userId: input.requesterId };
 *   }
 *   protected async handle(input: Input, ctx: { userId: string }): Promise<Output> {
 *     return { id: ctx.userId };
 *   }
 * }
 * ```
 *
 * @typeParam TInput - Input type (plain object)
 * @typeParam TOutput - Output type (plain object)
 * @typeParam TAuthContext - Authorization context type passed from authorize() to handle() (default: void)
 *
 * @example Basic use case without authorization
 * ```typescript
 * class CreateUserUseCase extends BaseInboundAdapter<CreateUserInput, CreateUserOutput> {
 *   protected async handle(input: CreateUserInput): Promise<CreateUserOutput> {
 *     const user = await this.userRepo.create(input);
 *     return { userId: user.id };
 *   }
 * }
 * ```
 *
 * @example Use case with authorization and context passing
 * ```typescript
 * interface UpdateActivityAuthContext {
 *   activity: Activity;
 *   organization: Organization;
 * }
 *
 * class UpdateActivityUseCase extends BaseInboundAdapter<
 *   UpdateActivityInput,
 *   UpdateActivityOutput,
 *   UpdateActivityAuthContext
 * > {
 *   protected async authorize(input: UpdateActivityInput): Promise<UpdateActivityAuthContext> {
 *     const activity = await this.activityRepo.findById(input.activityId);
 *     if (!activity) {
 *       throw new NotFoundError({ message: 'Activity not found' });
 *     }
 *
 *     const organization = await this.orgRepo.findById(input.organizationId);
 *     if (activity.organizationId !== organization.id) {
 *       throw new ForbiddenError({ message: 'Not authorized to update this activity' });
 *     }
 *
 *     return { activity, organization };
 *   }
 *
 *   protected async handle(
 *     input: UpdateActivityInput,
 *     { activity, organization }: UpdateActivityAuthContext
 *   ): Promise<UpdateActivityOutput> {
 *     // Use pre-loaded entities - no duplicate lookups!
 *     activity.update(input);
 *     await this.activityRepo.save(activity);
 *     return { activityId: activity.id.value };
 *   }
 * }
 * ```
 */
export abstract class BaseInboundAdapter<
  TInput,
  TOutput,
  TAuthContext = void,
> implements BaseInboundPort<TInput, TOutput> {
  /**
   * Authorization check that runs before handle().
   *
   * Override this method to add authorization logic. The returned context
   * is passed to `handle()`, enabling you to cache entities and avoid
   * duplicate database lookups.
   *
   * Default implementation returns `undefined` (no authorization, no context).
   *
   * @remarks
   * **You MUST override this method if `TAuthContext` is not `void`.**
   *
   * The default implementation casts `undefined` to `TAuthContext`. TypeScript
   * permits this cast at compile time, so forgetting to override when
   * `TAuthContext` is a real type will compile without errors but cause a
   * runtime `TypeError` the moment `handle()` accesses any property of the
   * context parameter.
   *
   * @param input - Input data
   * @returns Promise resolving to the authorization context (passed to handle)
   * @throws {ForbiddenError} When the user lacks permission for this operation
   * @throws {UnauthorizedError} When the user is not authenticated
   * @throws {NotFoundError} When a required resource doesn't exist
   * @throws {UseCaseError} For other authorization failures
   */
  protected async authorize(_input: TInput): Promise<TAuthContext> {
    return undefined as TAuthContext;
  }

  /**
   * Implements the use case logic. Override this method in subclasses.
   *
   * @param input - Input data
   * @param authContext - Authorization context returned from authorize()
   * @returns Promise resolving to the output
   */
  protected abstract handle(input: TInput, authContext: TAuthContext): Promise<TOutput>;

  /**
   * Executes the use case with authorization and error boundary protection.
   *
   * Execution flow:
   * 1. `authorize(input)` - Runs authorization checks, returns context
   * 2. `handle(input, authContext)` - Runs business logic with the context
   *
   * Known errors pass through; unknown errors are wrapped:
   * - Any {@link CodedError} is re-thrown as-is, so its class and code reach the
   *   presentation layer (e.g. `AccessDeniedError` → 403, `InvalidRequestError`
   *   → 400 with its own code, `NotFoundError` → 404).
   * - Anything else (a bare `Error`, `TypeError`, `RangeError`, a thrown string)
   *   is an unexpected failure, not a client mistake. It is wrapped in an
   *   {@link InfraError} (message `'Unexpected use case handler error'`, original
   *   kept as `cause`), which the HTTP and GraphQL mappers mask as a 500 /
   *   `INTERNAL_ERROR` and the event / schedule mappers treat as retryable,
   *   exactly like an unwrapped unknown error. It is deliberately NOT a
   *   `UseCaseError`, which would surface as a 400 `BAD_REQUEST`.
   *
   * @param input - Input data
   * @returns Promise resolving to the output
   * @throws {ObjectValidationError} For validation failures (propagated to controller)
   * @throws {UseCaseError} For use case failures (and subclasses: Forbidden, NotFound, ...)
   * @throws {AccessDeniedError} When access is denied
   * @throws {DomainError} For domain invariant violations
   * @throws {InfraError} For infrastructure failures, or wrapping an unknown error
   * @throws {CodedError} Any other coded error thrown by `authorize()` or `handle()`
   */
  public async execute(...args: TInput extends void ? [] : [input: TInput]): Promise<TOutput> {
    const input = args[0] as TInput;
    return wrapErrorUnlessAsync(
      async () => {
        const authContext = await this.authorize(input);
        return this.handle(input, authContext);
      },
      (cause) => new InfraError({ message: 'Unexpected use case handler error', cause }),
      [CodedError],
    );
  }
}
