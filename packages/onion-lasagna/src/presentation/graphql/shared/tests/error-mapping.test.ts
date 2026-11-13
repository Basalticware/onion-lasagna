/**
 * @fileoverview Tests for GraphQL error mapping.
 */

import { describe, it, expect } from 'vitest';
import {
  mapErrorToGraphQLError,
  getGraphQLErrorCode,
  shouldMaskGraphQLError,
} from '../error-mapping';
import { ObjectValidationError } from '../../../../global/exceptions/object-validation.error';
import { UseCaseError } from '../../../../app/exceptions/use-case.error';
import { NotFoundError } from '../../../../app/exceptions/not-found.error';
import { ConflictError } from '../../../../app/exceptions/conflict.error';
import { UnprocessableError } from '../../../../app/exceptions/unprocessable.error';
import { ForbiddenError } from '../../../../app/exceptions/forbidden.error';
import { UnauthorizedError } from '../../../../app/exceptions/unauthorized.error';
import { DomainError } from '../../../../domain/exceptions/domain.error';
import { PartialLoadError } from '../../../../domain/exceptions/partial-load.error';
import { InfraError } from '../../../../infra/exceptions/infra.error';
import { DbError } from '../../../../infra/exceptions/db.error';
import { TimeoutError } from '../../../../infra/exceptions/timeout.error';
import { AccessDeniedError } from '../../../exceptions/access-denied.error';
import { OutputValidationError } from '../../../exceptions/output-validation.error';
import { InvalidRequestError } from '../../../exceptions/invalid-request.error';

describe('getGraphQLErrorCode', () => {
  it('maps ObjectValidationError to VALIDATION_ERROR', () => {
    const error = new ObjectValidationError({
      message: 'Invalid',
      validationErrors: [{ field: 'name', message: 'required' }],
    });
    expect(getGraphQLErrorCode(error)).toBe('VALIDATION_ERROR');
  });

  // C06-8 / P01-5 — UnauthorizedError must map to UNAUTHENTICATED (HTTP 401), not FORBIDDEN
  it('maps UnauthorizedError to UNAUTHENTICATED (distinct from FORBIDDEN)', () => {
    expect(getGraphQLErrorCode(new UnauthorizedError({ message: 'No auth' }))).toBe(
      'UNAUTHENTICATED',
    );
  });

  it('maps ForbiddenError to FORBIDDEN', () => {
    expect(getGraphQLErrorCode(new ForbiddenError({ message: 'No access' }))).toBe('FORBIDDEN');
  });

  it('maps AccessDeniedError to FORBIDDEN', () => {
    expect(getGraphQLErrorCode(new AccessDeniedError({ message: 'Denied' }))).toBe('FORBIDDEN');
  });

  // C06-8 — UNAUTHENTICATED and FORBIDDEN must be distinct
  it('UnauthorizedError and ForbiddenError produce different codes', () => {
    const unauthCode = getGraphQLErrorCode(new UnauthorizedError({ message: 'No token' }));
    const forbiddenCode = getGraphQLErrorCode(new ForbiddenError({ message: 'No permission' }));
    expect(unauthCode).not.toBe(forbiddenCode);
    expect(unauthCode).toBe('UNAUTHENTICATED');
    expect(forbiddenCode).toBe('FORBIDDEN');
  });

  // C04-2 / C15-1 — DbError must map to INTERNAL_ERROR
  it('maps DbError to INTERNAL_ERROR', () => {
    expect(getGraphQLErrorCode(new DbError({ message: 'query failed' }))).toBe('INTERNAL_ERROR');
  });

  it('maps TimeoutError to INTERNAL_ERROR', () => {
    expect(getGraphQLErrorCode(new TimeoutError({ message: 'timed out' }))).toBe('INTERNAL_ERROR');
  });

  it('maps PartialLoadError to INTERNAL_ERROR', () => {
    expect(getGraphQLErrorCode(new PartialLoadError({ message: 'not loaded' }))).toBe(
      'INTERNAL_ERROR',
    );
  });

  it('maps NotFoundError to NOT_FOUND', () => {
    expect(getGraphQLErrorCode(new NotFoundError({ message: 'Missing' }))).toBe('NOT_FOUND');
  });

  it('maps ConflictError to CONFLICT', () => {
    expect(getGraphQLErrorCode(new ConflictError({ message: 'Duplicate' }))).toBe('CONFLICT');
  });

  it('maps UnprocessableError to UNPROCESSABLE', () => {
    expect(getGraphQLErrorCode(new UnprocessableError({ message: 'Cannot process' }))).toBe(
      'UNPROCESSABLE',
    );
  });

  it('maps UseCaseError to BAD_REQUEST', () => {
    expect(getGraphQLErrorCode(new UseCaseError({ message: 'Bad' }))).toBe('BAD_REQUEST');
  });

  it('maps unknown errors to INTERNAL_ERROR', () => {
    expect(getGraphQLErrorCode(new Error('unknown'))).toBe('INTERNAL_ERROR');
  });
});

describe('shouldMaskGraphQLError', () => {
  it('masks DomainError', () => {
    expect(shouldMaskGraphQLError(new DomainError({ message: 'internal' }))).toBe(true);
  });

  it('masks InfraError', () => {
    expect(shouldMaskGraphQLError(new InfraError({ message: 'db failed' }))).toBe(true);
  });

  // C04-2 / C15-1 — InfraError subclasses must be masked
  it('masks DbError (InfraError subclass)', () => {
    expect(shouldMaskGraphQLError(new DbError({ message: 'SELECT failed' }))).toBe(true);
  });

  it('masks TimeoutError (InfraError subclass)', () => {
    expect(shouldMaskGraphQLError(new TimeoutError({ message: 'timed out' }))).toBe(true);
  });

  it('masks PartialLoadError (DomainError subclass)', () => {
    expect(shouldMaskGraphQLError(new PartialLoadError({ message: 'not loaded' }))).toBe(true);
  });

  // C04-2 — cross-realm: mangled constructor.name must still be masked
  it('masks DbError with mangled constructor name (_DbError)', () => {
    const error = new DbError({ message: 'raw driver text' });
    Object.defineProperty(error.constructor, 'name', { value: '_DbError' });
    expect(shouldMaskGraphQLError(error)).toBe(true);
  });

  it('masks OutputValidationError (extends ControllerError)', () => {
    expect(
      shouldMaskGraphQLError(
        new OutputValidationError({ message: 'output.internalField: Expected string' }),
      ),
    ).toBe(true);
  });

  it('does not mask UseCaseError', () => {
    expect(shouldMaskGraphQLError(new UseCaseError({ message: 'bad request' }))).toBe(false);
  });

  it('does not mask NotFoundError', () => {
    expect(shouldMaskGraphQLError(new NotFoundError({ message: 'missing' }))).toBe(false);
  });
});

describe('mapErrorToGraphQLError', () => {
  it('maps ObjectValidationError with field details', () => {
    const error = new ObjectValidationError({
      message: 'Validation failed',
      validationErrors: [
        { field: 'input.name', message: 'Required' },
        { field: 'input.email', message: 'Invalid format' },
      ],
    });

    const result = mapErrorToGraphQLError(error);

    expect(result.message).toBe('Validation failed');
    expect(result.extensions.code).toBe('VALIDATION_ERROR');
    expect(result.extensions.validationErrors).toEqual([
      { field: 'input.name', message: 'Required' },
      { field: 'input.email', message: 'Invalid format' },
    ]);
  });

  it('maps InvalidRequestError to VALIDATION_ERROR with its own code and field details (mirrors HTTP 400)', () => {
    const error = new InvalidRequestError({
      message: 'Bad filter',
      code: 'BAD_FILTER',
      validationErrors: [{ field: 'filter.from', message: 'must be a date' }],
    });

    expect(getGraphQLErrorCode(error)).toBe('VALIDATION_ERROR');
    expect(shouldMaskGraphQLError(error)).toBe(false);
    expect(mapErrorToGraphQLError(error)).toEqual({
      message: 'Bad filter',
      extensions: {
        code: 'VALIDATION_ERROR',
        originalCode: 'BAD_FILTER',
        validationErrors: [{ field: 'filter.from', message: 'must be a date' }],
      },
    });
  });

  it('maps InvalidRequestError by (mangled) name for bundled code', () => {
    class _InvalidRequestError extends Error {
      code = 'INVALID_REQUEST';
      validationErrors = [{ field: 'q', message: 'required' }];
    }

    expect(mapErrorToGraphQLError(new _InvalidRequestError('Bad'))).toEqual({
      message: 'Bad',
      extensions: {
        code: 'VALIDATION_ERROR',
        originalCode: 'INVALID_REQUEST',
        validationErrors: [{ field: 'q', message: 'required' }],
      },
    });
  });

  it('maps UseCaseError with message', () => {
    const result = mapErrorToGraphQLError(new UseCaseError({ message: 'Business rule violated' }));

    expect(result.message).toBe('Business rule violated');
    expect(result.extensions.code).toBe('BAD_REQUEST');
  });

  it('masks DomainError', () => {
    const result = mapErrorToGraphQLError(new DomainError({ message: 'secret internal info' }));

    expect(result.message).toBe('An unexpected error occurred');
    expect(result.extensions.code).toBe('INTERNAL_ERROR');
    expect(result.extensions.validationErrors).toBeUndefined();
  });

  it('masks InfraError', () => {
    const result = mapErrorToGraphQLError(new InfraError({ message: 'db connection string' }));

    expect(result.message).toBe('An unexpected error occurred');
    expect(result.extensions.code).toBe('INTERNAL_ERROR');
  });

  it('masks unknown errors', () => {
    const result = mapErrorToGraphQLError(new Error('something broke'));

    expect(result.message).toBe('An unexpected error occurred');
    expect(result.extensions.code).toBe('INTERNAL_ERROR');
  });

  it('masks OutputValidationError and hides internal field paths', () => {
    const error = new OutputValidationError({
      message:
        'Output validation failed for field "getUser": output.internalSecretField: Expected string',
    });
    const result = mapErrorToGraphQLError(error);

    expect(result.message).toBe('An unexpected error occurred');
    expect(result.extensions.code).toBe('INTERNAL_ERROR');
    // Must NOT contain the internal field path
    expect(result.extensions.validationErrors).toBeUndefined();
  });

  it('maps NotFoundError with message', () => {
    const result = mapErrorToGraphQLError(new NotFoundError({ message: 'User not found' }));

    expect(result.message).toBe('User not found');
    expect(result.extensions.code).toBe('NOT_FOUND');
  });

  // C04-2 / C15-1 — DbError message must not leak in GraphQL response
  it('masks DbError — raw DB driver text does not appear in GraphQL response', () => {
    const error = new DbError({
      message: 'FATAL: password authentication failed for user "app"',
    });
    const result = mapErrorToGraphQLError(error);
    expect(result.message).toBe('An unexpected error occurred');
    expect(result.extensions.code).toBe('INTERNAL_ERROR');
    expect(result.message).not.toContain('password');
  });

  it('masks TimeoutError in GraphQL response', () => {
    const error = new TimeoutError({ message: 'query timed out on host db-primary' });
    const result = mapErrorToGraphQLError(error);
    expect(result.message).toBe('An unexpected error occurred');
    expect(result.message).not.toContain('db-primary');
  });

  it('masks PartialLoadError in GraphQL response', () => {
    const error = new PartialLoadError({ message: 'user.roles not loaded from private repo' });
    const result = mapErrorToGraphQLError(error);
    expect(result.message).toBe('An unexpected error occurred');
    expect(result.message).not.toContain('roles');
  });

  // C06-8 / P01-5 — UnauthorizedError must surface as UNAUTHENTICATED in GraphQL
  it('maps UnauthorizedError to UNAUTHENTICATED extension code', () => {
    const result = mapErrorToGraphQLError(new UnauthorizedError({ message: 'Token expired' }));
    expect(result.extensions.code).toBe('UNAUTHENTICATED');
    expect(result.message).toBe('Token expired');
  });

  it('maps ForbiddenError to FORBIDDEN extension code (not UNAUTHENTICATED)', () => {
    const result = mapErrorToGraphQLError(new ForbiddenError({ message: 'Insufficient role' }));
    expect(result.extensions.code).toBe('FORBIDDEN');
    expect(result.extensions.code).not.toBe('UNAUTHENTICATED');
  });

  // C04 nit — mutable singleton: mutating one masked GraphQL error must not affect the next
  it('does not share state between masked GraphQL error objects (mutable singleton fix)', () => {
    const result1 = mapErrorToGraphQLError(new DbError({ message: 'db error 1' }));
    // Mutate the returned object
    (result1 as Record<string, unknown>)['message'] = 'POISONED';

    const result2 = mapErrorToGraphQLError(new TimeoutError({ message: 'timeout 2' }));
    expect(result2.message).toBe('An unexpected error occurred');
    expect(result2.message).not.toBe('POISONED');
  });

  // C13-3 — stable brand: mangled constructor.name must not bypass masking
  it('C13-3: masks DbError with mangled constructor.name (_DbError) via brand — message hidden', () => {
    const err = new DbError({ message: 'FATAL: password auth failed' });
    Object.defineProperty(err.constructor, 'name', { value: '_DbError', configurable: true });
    const result = mapErrorToGraphQLError(err);
    expect(result.message).toBe('An unexpected error occurred');
    expect(result.extensions.code).toBe('INTERNAL_ERROR');
    expect(result.message).not.toContain('password');
  });

  it('C13-3: masks DomainError with fully mangled constructor.name — brand ensures masking', () => {
    const err = new DomainError({ message: 'internal domain detail' });
    Object.defineProperty(err.constructor, 'name', { value: 'a', configurable: true });
    const result = mapErrorToGraphQLError(err);
    expect(result.message).toBe('An unexpected error occurred');
    expect(result.extensions.code).toBe('INTERNAL_ERROR');
  });
});
