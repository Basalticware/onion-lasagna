import { describe, it, expect, vi } from 'vitest';
import { BaseOutboundAdapter } from '../base-outbound-adapter.class';
import { InfraError } from '../../exceptions/infra.error';
import { DbError } from '../../exceptions/db.error';
import { ConflictError } from '../../../app/exceptions/conflict.error';
import { UnprocessableError } from '../../../app/exceptions/unprocessable.error';
import { NotFoundError } from '../../../app/exceptions/not-found.error';

// Module-scope classes — no per-test factory workaround needed since the
// prototype-dedup bug has been fixed (each instance is independently wrapped).

class TestRepository extends BaseOutboundAdapter {
  async findById(id: string): Promise<{ id: string; name: string } | null> {
    if (id === 'not-found') return null;
    return { id, name: 'Test Entity' };
  }

  async findAll(): Promise<{ id: string }[]> {
    return [{ id: '1' }, { id: '2' }];
  }

  syncMethod(value: string): string {
    return `processed: ${value}`;
  }

  async failingMethod(): Promise<void> {
    throw new Error('Database connection lost');
  }

  syncFailingMethod(): string {
    throw new Error('Sync operation failed');
  }
}

class CustomErrorRepository extends BaseOutboundAdapter {
  protected override createInfraError(error: unknown, methodName: string): InfraError {
    return new DbError({
      message: `Database error in ${methodName}`,
      cause: error,
    });
  }

  async query(): Promise<void> {
    throw new Error('Query failed');
  }
}

class RepositoryWithGetter extends BaseOutboundAdapter {
  private _data = 'initial';

  get data(): string {
    return this._data;
  }

  set data(value: string) {
    this._data = value;
  }

  async fetchData(): Promise<string> {
    return this._data;
  }
}

// Used for multi-instance regression tests at module scope.
class BoomRepo extends BaseOutboundAdapter {
  async boom(): Promise<void> {
    throw new Error('raw');
  }

  syncBoom(): string {
    throw new Error('raw sync');
  }
}

class BoomRepoCustomError extends BaseOutboundAdapter {
  protected override createInfraError(error: unknown, methodName: string): InfraError {
    return new DbError({ message: `Database error in ${methodName}`, cause: error });
  }

  async boom(): Promise<void> {
    throw new Error('raw');
  }
}

describe('BaseOutboundAdapter', () => {
  describe('successful operations', () => {
    it('should execute async methods successfully', async () => {
      const repo = new TestRepository();

      const result = await repo.findById('123');

      expect(result).toEqual({ id: '123', name: 'Test Entity' });
    });

    it('should execute sync methods successfully', () => {
      const repo = new TestRepository();

      const result = repo.syncMethod('input');

      expect(result).toBe('processed: input');
    });

    it('should return null from async methods', async () => {
      const repo = new TestRepository();

      const result = await repo.findById('not-found');

      expect(result).toBeNull();
    });

    it('should return arrays from async methods', async () => {
      const repo = new TestRepository();

      const result = await repo.findAll();

      expect(result).toHaveLength(2);
    });
  });

  describe('error wrapping', () => {
    it('should wrap async errors in InfraError', async () => {
      const repo = new TestRepository();

      await expect(repo.failingMethod()).rejects.toThrow(InfraError);
    });

    it('should wrap sync errors in InfraError', () => {
      const repo = new TestRepository();

      expect(() => repo.syncFailingMethod()).toThrow(InfraError);
    });

    it('should preserve original error as cause', async () => {
      const repo = new TestRepository();

      try {
        await repo.failingMethod();
      } catch (error) {
        expect(error).toBeInstanceOf(InfraError);
        expect((error as InfraError).cause).toBeInstanceOf(Error);
        expect(((error as InfraError).cause as Error).message).toBe('Database connection lost');
      }
    });

    it('should include method name in error message', async () => {
      const repo = new TestRepository();

      try {
        await repo.failingMethod();
      } catch (error) {
        expect((error as InfraError).message).toContain('failingMethod');
      }
    });
  });

  describe('custom error factory', () => {
    it('should use custom createInfraError when overridden', async () => {
      const repo = new CustomErrorRepository();

      await expect(repo.query()).rejects.toThrow(DbError);
    });

    it('should include method name in custom error', async () => {
      const repo = new CustomErrorRepository();

      try {
        await repo.query();
      } catch (error) {
        expect(error).toBeInstanceOf(DbError);
        expect((error as DbError).message).toContain('query');
      }
    });
  });

  describe('getters and setters', () => {
    it('should not wrap getters', () => {
      const repo = new RepositoryWithGetter();

      // Should work without throwing
      expect(repo.data).toBe('initial');
    });

    it('should not wrap setters', () => {
      const repo = new RepositoryWithGetter();

      // Should work without throwing
      repo.data = 'updated';
      expect(repo.data).toBe('updated');
    });

    it('should wrap regular methods alongside getters', async () => {
      const repo = new RepositoryWithGetter();
      repo.data = 'test data';

      const result = await repo.fetchData();

      expect(result).toBe('test data');
    });
  });

  describe('promise handling', () => {
    it('should handle rejected promises', async () => {
      class RejectingRepo extends BaseOutboundAdapter {
        async rejectingMethod(): Promise<string> {
          return Promise.reject(new Error('Rejected'));
        }
      }

      const repo = new RejectingRepo();

      await expect(repo.rejectingMethod()).rejects.toThrow(InfraError);
    });

    it('should handle promise that resolves then throws', async () => {
      class DelayedErrorRepo extends BaseOutboundAdapter {
        async delayedError(): Promise<string> {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error('Delayed error');
        }
      }

      const repo = new DelayedErrorRepo();

      await expect(repo.delayedError()).rejects.toThrow(InfraError);
    });
  });

  describe('multi-instance regression — prototype-dedup bug fix', () => {
    it('second instance of a module-scope class wraps async errors in InfraError', async () => {
      // First instance (would have triggered prototype-dedup in the buggy version)
      const _first = new BoomRepo();
      const second = new BoomRepo();

      const err = await second.boom().catch((e: unknown) => e);

      expect(err).toBeInstanceOf(InfraError);
      expect((err as InfraError).cause).toBeInstanceOf(Error);
      expect(((err as InfraError).cause as Error).message).toBe('raw');
    });

    it('five instances all wrap async errors in InfraError', async () => {
      const instances = Array.from({ length: 5 }, () => new BoomRepo());

      for (const inst of instances) {
        const err = await inst.boom().catch((e: unknown) => e);
        expect(err).toBeInstanceOf(InfraError);
      }
    });

    it('second instance wraps sync errors in InfraError', () => {
      const _first = new BoomRepo();
      const second = new BoomRepo();

      expect(() => second.syncBoom()).toThrow(InfraError);
    });

    it('custom createInfraError override applies on the second instance', async () => {
      const _first = new BoomRepoCustomError();
      const second = new BoomRepoCustomError();

      const err = await second.boom().catch((e: unknown) => e);

      expect(err).toBeInstanceOf(DbError);
    });
  });
});

// ---------------------------------------------------------------------------
// C03-1: Arrow-function class-field methods (own properties, post-super)
// ---------------------------------------------------------------------------
describe('C03-1 — arrow-function class-field methods are wrapped', () => {
  class ArrowRepo extends BaseOutboundAdapter {
    // Arrow fields are own-property function values assigned AFTER super()
    asyncArrow = async (): Promise<void> => {
      throw new Error('arrow async failure');
    };

    syncArrow = (): string => {
      throw new Error('arrow sync failure');
    };

    arrowSuccess = async (): Promise<string> => {
      return 'ok';
    };
  }

  it('wraps async arrow-field errors into InfraError', async () => {
    const repo = new ArrowRepo();
    const err = await repo.asyncArrow().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InfraError);
    expect(((err as InfraError).cause as Error).message).toBe('arrow async failure');
  });

  it('wraps sync arrow-field errors into InfraError', () => {
    const repo = new ArrowRepo();
    expect(() => repo.syncArrow()).toThrow(InfraError);
  });

  it('passes through successful arrow-field return values', async () => {
    const repo = new ArrowRepo();
    await expect(repo.arrowSuccess()).resolves.toBe('ok');
  });

  it('allows test spies to be installed on arrow fields', () => {
    const repo = new ArrowRepo();
    // If configurable:true, vi.spyOn is able to replace the property
    const spy = vi.spyOn(repo, 'syncArrow').mockReturnValue('mocked');
    expect(repo.syncArrow()).toBe('mocked');
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// C03-2: Non-native thenables bypass wrapping
// ---------------------------------------------------------------------------
describe('C03-2 — non-native thenables (duck-typed) are wrapped', () => {
  class ThenableRepo extends BaseOutboundAdapter {
    customThenable(): { then: (res: (v: string) => void, rej: (e: unknown) => void) => void } {
      return {
        then(_res, rej) {
          rej(new Error('thenable rejection'));
        },
      };
    }
  }

  it('wraps errors from duck-typed thenables into InfraError', async () => {
    const repo = new ThenableRepo();
    // Cast to a thenable so the caller can await it
    const result = repo.customThenable() as unknown as Promise<string>;
    const err = await result.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InfraError);
  });
});

// ---------------------------------------------------------------------------
// C03-3: Async/sync generator returns are wrapped
// ---------------------------------------------------------------------------
describe('C03-3 — async generator errors are wrapped', () => {
  class GeneratorRepo extends BaseOutboundAdapter {
    async *asyncGenerator(): AsyncGenerator<number> {
      yield 1;
      throw new Error('generator failure');
    }

    *syncGenerator(): Generator<number> {
      yield 1;
      throw new Error('sync generator failure');
    }
  }

  it('wraps errors from async generators into InfraError', async () => {
    const repo = new GeneratorRepo();
    const gen = repo.asyncGenerator();
    // First yield succeeds
    const first = await gen.next();
    expect(first.value).toBe(1);
    // Second call throws — should be an InfraError
    const err = await gen.next().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InfraError);
  });

  it('wraps errors from sync generators into InfraError', () => {
    const repo = new GeneratorRepo();
    const gen = repo.syncGenerator();
    gen.next(); // yield 1
    expect(() => gen.next()).toThrow(InfraError);
  });
});

// ---------------------------------------------------------------------------
// C03-4: Wrapped methods must be configurable (allow test spying/rebind)
// ---------------------------------------------------------------------------
describe('C03-4 — wrapped prototype methods are configurable (spy-friendly)', () => {
  class SpyRepo extends BaseOutboundAdapter {
    async fetchSomething(): Promise<string> {
      return 'real';
    }

    syncThing(): string {
      return 'real sync';
    }
  }

  it('allows vi.spyOn on wrapped async methods', async () => {
    const repo = new SpyRepo();
    const spy = vi.spyOn(repo, 'fetchSomething').mockResolvedValue('mocked');
    await expect(repo.fetchSomething()).resolves.toBe('mocked');
    spy.mockRestore();
  });

  it('allows vi.spyOn on wrapped sync methods', () => {
    const repo = new SpyRepo();
    const spy = vi.spyOn(repo, 'syncThing').mockReturnValue('mocked sync');
    expect(repo.syncThing()).toBe('mocked sync');
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// C03-5: createInfraError must NOT double-wrap already-typed InfraErrors
// ---------------------------------------------------------------------------
describe('C03-5 — already-typed InfraErrors are not double-wrapped', () => {
  class AlreadyWrappedRepo extends BaseOutboundAdapter {
    async throwsInfraError(): Promise<void> {
      throw new InfraError({ message: 'already an infra error' });
    }

    async throwsDbError(): Promise<void> {
      throw new DbError({ message: 'already a db error' });
    }

    syncThrowsInfraError(): void {
      throw new InfraError({ message: 'sync already infra' });
    }
  }

  it('passes through async InfraError without re-wrapping', async () => {
    const repo = new AlreadyWrappedRepo();
    const err = await repo.throwsInfraError().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InfraError);
    expect((err as InfraError).message).toBe('already an infra error');
    // Must NOT be wrapped in another InfraError
    expect((err as InfraError).cause).toBeUndefined();
  });

  it('passes through async DbError (InfraError subtype) without re-wrapping', async () => {
    const repo = new AlreadyWrappedRepo();
    const err = await repo.throwsDbError().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DbError);
    expect((err as DbError).message).toBe('already a db error');
    expect((err as DbError).cause).toBeUndefined();
  });

  it('passes through sync InfraError without re-wrapping', () => {
    const repo = new AlreadyWrappedRepo();
    try {
      repo.syncThrowsInfraError();
    } catch (err) {
      expect(err).toBeInstanceOf(InfraError);
      expect((err as InfraError).message).toBe('sync already infra');
      expect((err as InfraError).cause).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Known errors pass through: any CodedError thrown inside an adapter method
// keeps its subtype and code. Only unknown errors are wrapped.
// ---------------------------------------------------------------------------
describe('known CodedErrors pass through unwrapped', () => {
  class CodedErrorRepo extends BaseOutboundAdapter {
    async throwsConflict(): Promise<void> {
      throw new ConflictError({ message: 'email taken', code: 'EMAIL_TAKEN' });
    }

    syncThrowsConflict(): void {
      throw new ConflictError({ message: 'sync conflict' });
    }

    async throwsUnprocessable(): Promise<void> {
      throw new UnprocessableError({ message: 'cannot process' });
    }

    throwsNotFoundThenable(): {
      then: (res: (v: void) => void, rej: (e: unknown) => void) => void;
    } {
      return {
        then(_res, rej) {
          rej(new NotFoundError({ message: 'missing' }));
        },
      };
    }

    async *asyncGeneratorThrowsConflict(): AsyncGenerator<number> {
      yield 1;
      throw new ConflictError({ message: 'async generator conflict' });
    }

    *syncGeneratorThrowsUnprocessable(): Generator<number> {
      yield 1;
      throw new UnprocessableError({ message: 'sync generator unprocessable' });
    }

    async throwsPlainError(): Promise<void> {
      throw new Error('driver blew up');
    }

    syncThrowsPlainError(): void {
      throw new Error('sync driver blew up');
    }
  }

  class CustomFactoryCodedErrorRepo extends BaseOutboundAdapter {
    protected override createInfraError(error: unknown, methodName: string): InfraError {
      return new DbError({ message: `Database error in ${methodName}`, cause: error });
    }

    async throwsConflict(): Promise<void> {
      throw new ConflictError({ message: 'duplicate key' });
    }

    async throwsPlainError(): Promise<void> {
      throw new Error('connection reset');
    }
  }

  it('keeps an async ConflictError as a ConflictError with its code', async () => {
    const err = await new CodedErrorRepo().throwsConflict().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err).not.toBeInstanceOf(InfraError);
    expect((err as ConflictError).code).toBe('EMAIL_TAKEN');
    expect((err as ConflictError).message).toBe('email taken');
  });

  it('keeps a sync ConflictError as a ConflictError with its default code', () => {
    const repo = new CodedErrorRepo();
    let err: unknown;
    try {
      repo.syncThrowsConflict();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).code).toBe('CONFLICT');
  });

  it('keeps an UnprocessableError as itself', async () => {
    const err = await new CodedErrorRepo().throwsUnprocessable().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnprocessableError);
    expect(err).not.toBeInstanceOf(InfraError);
    expect((err as UnprocessableError).code).toBe('UNPROCESSABLE');
  });

  it('keeps a NotFoundError rejected by a duck-typed thenable as itself', async () => {
    const result = new CodedErrorRepo().throwsNotFoundThenable() as unknown as Promise<void>;
    const err = await result.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).code).toBe('NOT_FOUND');
  });

  it('keeps a ConflictError thrown from an async generator as itself', async () => {
    const gen = new CodedErrorRepo().asyncGeneratorThrowsConflict();
    await gen.next();
    const err = await gen.next().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
  });

  it('keeps an UnprocessableError thrown from a sync generator as itself', () => {
    const gen = new CodedErrorRepo().syncGeneratorThrowsUnprocessable();
    gen.next();
    expect(() => gen.next()).toThrow(UnprocessableError);
  });

  it('still wraps a plain async Error as InfraError', async () => {
    const err = await new CodedErrorRepo().throwsPlainError().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InfraError);
    expect((err as InfraError).message).toBe('Outbound adapter error in throwsPlainError');
    expect((err as InfraError).cause).toBeInstanceOf(Error);
  });

  it('still wraps a plain sync Error as InfraError', () => {
    expect(() => new CodedErrorRepo().syncThrowsPlainError()).toThrow(InfraError);
  });

  it('still wraps a plain Error with the createInfraError override, but not a ConflictError', async () => {
    const repo = new CustomFactoryCodedErrorRepo();
    const plain = await repo.throwsPlainError().catch((e: unknown) => e);
    expect(plain).toBeInstanceOf(DbError);
    expect((plain as DbError).message).toBe('Database error in throwsPlainError');

    const conflict = await repo.throwsConflict().catch((e: unknown) => e);
    expect(conflict).toBeInstanceOf(ConflictError);
    expect(conflict).not.toBeInstanceOf(DbError);
  });
});
