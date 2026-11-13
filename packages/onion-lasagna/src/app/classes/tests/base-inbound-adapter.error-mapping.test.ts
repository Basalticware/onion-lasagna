/**
 * End-to-end error contract of `BaseInboundAdapter.execute`: what a use case
 * throws must reach the presentation mappers with the right class, so the
 * client sees the right status. Known (coded) errors keep their class and
 * code; unknown errors are masked as an internal error, never a 400.
 */
import { describe, it, expect } from 'vitest';
import { BaseInboundAdapter } from '../base-inbound-adapter.class';
import { CodedError } from '../../../global/exceptions/coded-error.error';
import { ConflictError } from '../../exceptions/conflict.error';
import { ForbiddenError } from '../../exceptions/forbidden.error';
import { NotFoundError } from '../../exceptions/not-found.error';
import { UseCaseError } from '../../exceptions/use-case.error';
import { InfraError } from '../../../infra/exceptions/infra.error';
import { AccessDeniedError } from '../../../presentation/exceptions/access-denied.error';
import { InvalidRequestError } from '../../../presentation/exceptions/invalid-request.error';
import { mapErrorToGraphQLError } from '../../../presentation/graphql/shared/error-mapping';
import { mapErrorToHttpResponse } from '../../../presentation/http/shared/error-mapping';

interface Input {
  name: string;
}

class AuthorizeThrows extends BaseInboundAdapter<Input, string> {
  constructor(private readonly error: unknown) {
    super();
  }

  protected override async authorize(_input: Input): Promise<void> {
    throw this.error;
  }

  protected async handle(): Promise<string> {
    return 'unreachable';
  }
}

class HandleThrows extends BaseInboundAdapter<Input, string> {
  constructor(private readonly error: unknown) {
    super();
  }

  protected async handle(): Promise<string> {
    throw this.error;
  }
}

/** A consumer-defined coded error the library knows nothing about. */
class QuotaExceededError extends CodedError {
  constructor() {
    super({ message: 'Quota exceeded', code: 'QUOTA_EXCEEDED' });
  }
}

async function caught(useCase: BaseInboundAdapter<Input, string>): Promise<unknown> {
  try {
    await useCase.execute({ name: 'x' });
  } catch (error) {
    return error;
  }
  throw new Error('expected execute() to reject');
}

describe('BaseInboundAdapter.execute error contract', () => {
  describe('coded errors pass through unchanged', () => {
    it('AccessDeniedError from authorize() keeps its class and maps to FORBIDDEN / 403', async () => {
      const original = new AccessDeniedError({ message: 'No access to this tenant' });

      const error = await caught(new AuthorizeThrows(original));

      expect(error).toBe(original);
      expect(mapErrorToGraphQLError(error)).toEqual({
        message: 'No access to this tenant',
        extensions: { code: 'FORBIDDEN', originalCode: 'ACCESS_DENIED' },
      });
      expect(mapErrorToHttpResponse(error)).toEqual({
        status: 403,
        body: { message: 'No access to this tenant', errorCode: 'ACCESS_DENIED' },
      });
    });

    it('InvalidRequestError keeps its class, code and field errors', async () => {
      const original = new InvalidRequestError({
        message: 'Bad filter',
        code: 'BAD_FILTER',
        validationErrors: [{ field: 'filter.from', message: 'must be a date' }],
      });

      const error = await caught(new HandleThrows(original));

      expect(error).toBe(original);
      expect((error as InvalidRequestError).code).toBe('BAD_FILTER');
      expect(mapErrorToHttpResponse(error)).toEqual({
        status: 400,
        body: {
          message: 'Bad filter',
          errorCode: 'BAD_FILTER',
          errorItems: [{ item: 'filter.from', message: 'must be a date' }],
        },
      });
      expect(mapErrorToGraphQLError(error).extensions.originalCode).toBe('BAD_FILTER');
    });

    it.each([
      ['ConflictError', new ConflictError({ message: 'Already exists' }), 'CONFLICT', 409],
      ['NotFoundError', new NotFoundError({ message: 'Missing' }), 'NOT_FOUND', 404],
      ['ForbiddenError', new ForbiddenError({ message: 'Not yours' }), 'FORBIDDEN', 403],
    ] as const)('%s still passes through', async (_name, original, gqlCode, status) => {
      for (const useCase of [new AuthorizeThrows(original), new HandleThrows(original)]) {
        const error = await caught(useCase);

        expect(error).toBe(original);
        expect(mapErrorToGraphQLError(error).extensions.code).toBe(gqlCode);
        expect(mapErrorToHttpResponse(error).status).toBe(status);
      }
    });

    it('a consumer-defined CodedError passes through with its own code', async () => {
      const original = new QuotaExceededError();

      const error = await caught(new HandleThrows(original));

      expect(error).toBe(original);
      expect((error as QuotaExceededError).code).toBe('QUOTA_EXCEEDED');
    });
  });

  describe('unknown errors are masked as an internal error, not a 400', () => {
    it.each([
      ['Error', new Error('db driver exploded')],
      ['RangeError', new RangeError('Invalid array length')],
      ['TypeError', new TypeError("Cannot read properties of undefined (reading 'id')")],
      ['a thrown string', 'boom'],
    ] as const)('%s → InfraError (cause kept) → INTERNAL_ERROR / 500', async (_name, original) => {
      for (const useCase of [new AuthorizeThrows(original), new HandleThrows(original)]) {
        const error = await caught(useCase);

        expect(error).toBeInstanceOf(InfraError);
        expect(error).not.toBeInstanceOf(UseCaseError);
        expect((error as InfraError).cause).toBe(original);

        const gql = mapErrorToGraphQLError(error);
        expect(gql).toEqual({
          message: 'An unexpected error occurred',
          extensions: { code: 'INTERNAL_ERROR' },
        });
        expect(gql.extensions.code).not.toBe('BAD_REQUEST');

        expect(mapErrorToHttpResponse(error)).toEqual({
          status: 500,
          body: { message: 'An unexpected error occurred', errorCode: 'INTERNAL_ERROR' },
        });
      }
    });
  });
});
