/**
 * @fileoverview Tests for path parameter utilities.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import type { ExtractPathParamNames } from '../types/path-params.type';
import { InvalidRequestError } from '../../../exceptions/invalid-request.error';
import {
  pathToRegex,
  getPathParamNames,
  hasPathParams,
  buildPath,
  normalizePath,
} from '../types/path-params.type';

describe('path-params', () => {
  describe('pathToRegex', () => {
    it('creates regex for simple path without params', () => {
      const regex = pathToRegex('/users');
      expect(regex.test('/users')).toBe(true);
      expect(regex.test('/users/')).toBe(true);
      expect(regex.test('/users/123')).toBe(false);
    });

    it('creates regex for path with colon params', () => {
      const regex = pathToRegex('/users/:userId');
      expect(regex.test('/users/123')).toBe(true);
      expect(regex.test('/users/abc-def')).toBe(true);
      expect(regex.test('/users/')).toBe(false);
      expect(regex.test('/users')).toBe(false);
    });

    it('creates regex for path with brace params', () => {
      const regex = pathToRegex('/users/{userId}');
      expect(regex.test('/users/123')).toBe(true);
      expect(regex.test('/users/abc')).toBe(true);
    });

    it('creates regex for multiple params', () => {
      const regex = pathToRegex('/users/:userId/posts/:postId');
      expect(regex.test('/users/1/posts/2')).toBe(true);
      expect(regex.test('/users/abc/posts/def')).toBe(true);
      expect(regex.test('/users/1/posts')).toBe(false);
    });

    it('captures param values', () => {
      const regex = pathToRegex('/users/:userId/posts/:postId');
      const match = '/users/123/posts/456'.match(regex);
      expect(match).toBeTruthy();
      expect(match![1]).toBe('123');
      expect(match![2]).toBe('456');
    });

    it('handles special regex characters in path', () => {
      const regex = pathToRegex('/api/v1.0/users');
      expect(regex.test('/api/v1.0/users')).toBe(true);
      expect(regex.test('/api/v1X0/users')).toBe(false);
    });
  });

  describe('getPathParamNames', () => {
    it('extracts colon-style params', () => {
      const names = getPathParamNames('/users/:userId/posts/:postId');
      expect(names).toEqual(['userId', 'postId']);
    });

    it('extracts brace-style params', () => {
      const names = getPathParamNames('/users/{userId}/posts/{postId}');
      expect(names).toEqual(['userId', 'postId']);
    });

    it('extracts mixed-style params', () => {
      const names = getPathParamNames('/users/:userId/posts/{postId}');
      expect(names).toEqual(['userId', 'postId']);
    });

    it('returns empty array for paths without params', () => {
      const names = getPathParamNames('/users');
      expect(names).toEqual([]);
    });

    it('handles single param', () => {
      const names = getPathParamNames('/users/:id');
      expect(names).toEqual(['id']);
    });

    it('handles params with underscores', () => {
      const names = getPathParamNames('/users/:user_id/posts/:post_id');
      expect(names).toEqual(['user_id', 'post_id']);
    });

    it('handles params with numbers', () => {
      const names = getPathParamNames('/api/v1/:resourceId2');
      expect(names).toEqual(['resourceId2']);
    });
  });

  describe('hasPathParams', () => {
    it('returns true for paths with colon params', () => {
      expect(hasPathParams('/users/:id')).toBe(true);
      expect(hasPathParams('/users/:userId/posts/:postId')).toBe(true);
    });

    it('returns true for paths with brace params', () => {
      expect(hasPathParams('/users/{id}')).toBe(true);
      expect(hasPathParams('/users/{userId}/posts/{postId}')).toBe(true);
    });

    it('returns false for paths without params', () => {
      expect(hasPathParams('/users')).toBe(false);
      expect(hasPathParams('/users/posts')).toBe(false);
      expect(hasPathParams('/')).toBe(false);
    });

    it('returns false for paths with colon in different context', () => {
      // Colon not followed by valid identifier
      expect(hasPathParams('/time/12:30')).toBe(false);
    });
  });

  describe('buildPath', () => {
    it('replaces colon-style params', () => {
      const result = buildPath('/users/:userId', { userId: '123' });
      expect(result).toBe('/users/123');
    });

    it('replaces brace-style params', () => {
      const result = buildPath('/users/{userId}', { userId: '123' });
      expect(result).toBe('/users/123');
    });

    it('replaces multiple params', () => {
      const result = buildPath('/users/:userId/posts/:postId', {
        userId: '1',
        postId: '2',
      });
      expect(result).toBe('/users/1/posts/2');
    });

    it('encodes special characters', () => {
      const result = buildPath('/users/:name', { name: 'John Doe' });
      expect(result).toBe('/users/John%20Doe');
    });

    it('encodes slashes in param values', () => {
      const result = buildPath('/files/:path', { path: 'a/b/c' });
      expect(result).toBe('/files/a%2Fb%2Fc');
    });

    it('handles empty params object', () => {
      const result = buildPath('/users', {});
      expect(result).toBe('/users');
    });

    it('replaces mixed param styles', () => {
      const result = buildPath('/users/:userId/posts/{postId}', {
        userId: '1',
        postId: '2',
      });
      expect(result).toBe('/users/1/posts/2');
    });

    // C12-1: shorter param name must not corrupt a longer param name that shares a prefix.
    // Bug: String.replace(':user', 'alice') is NOT word-boundary-aware, so it will match
    // ':user' inside ':userId'. If 'user' is an extra key in params (not in the template
    // but sharing a prefix with 'userId'), it corrupts ':userId' -> 'aliceId'.
    it('does not corrupt a colon param when a prefix-key exists in params but not in path (C12-1)', () => {
      // 'user' is NOT in the path but 'userId' is; 'user' key comes first in iteration order.
      const params: Record<string, string> = {};
      params['user'] = 'alice'; // extra key, not a placeholder in this template
      params['userId'] = 'bob';
      const result = buildPath('/profile/:userId', params);
      // Bug produces '/profile/aliceId'; correct result is '/profile/bob'.
      expect(result).toBe('/profile/bob');
    });

    it('brace syntax is not susceptible to prefix corruption (C12-1 sanity check)', () => {
      // {user} is not a substring of {userId} so no corruption even before fix.
      // This test documents the safe behaviour is preserved post-fix.
      const params: Record<string, string> = {};
      params['user'] = 'alice';
      params['userId'] = 'bob';
      const result = buildPath('/profile/{userId}', params);
      expect(result).toBe('/profile/bob');
    });

    // C12-2: repeated placeholder must be replaced everywhere
    it('replaces all occurrences of a repeated colon param (C12-2)', () => {
      const result = buildPath('/a/:id/b/:id', { id: '7' });
      expect(result).toBe('/a/7/b/7');
    });

    it('replaces all occurrences of a repeated brace param (C12-2)', () => {
      const result = buildPath('/a/{id}/b/{id}', { id: '7' });
      expect(result).toBe('/a/7/b/7');
    });

    // F6 (research 11, probe P6): a `.` or `..` value would become a dot segment,
    // which URL parsing collapses, so the value could retarget the route.
    describe('refuses a dot-segment value (F6)', () => {
      function refusalOf(build: () => string): InvalidRequestError {
        try {
          build();
        } catch (error) {
          if (error instanceof InvalidRequestError) return error;
          throw error;
        }
        throw new Error('expected buildPath to refuse the value');
      }

      it('refuses `..` in a colon param (P6)', () => {
        const error = refusalOf(() => buildPath('http://h/api/users/:id/profile', { id: '..' }));
        expect(error.code).toBe('INVALID_REQUEST');
        expect(error.validationErrors).toEqual([
          { field: 'pathParams.id', message: 'Path value must not be "." or ".."' },
        ]);
      });

      it('refuses `.` in a colon param', () => {
        const error = refusalOf(() => buildPath('/users/:id/profile', { id: '.' }));
        expect(error.validationErrors).toEqual([
          { field: 'pathParams.id', message: 'Path value must not be "." or ".."' },
        ]);
      });

      it('refuses `..` and `.` in a brace param', () => {
        expect(() => buildPath('/users/{id}/profile', { id: '..' })).toThrow(InvalidRequestError);
        expect(() => buildPath('/users/{id}/profile', { id: '.' })).toThrow(InvalidRequestError);
      });

      it('still builds values that merely contain dots', () => {
        expect(buildPath('/users/:id/profile', { id: 'a.b' })).toBe('/users/a.b/profile');
        expect(buildPath('/users/:id/profile', { id: '..a' })).toBe('/users/..a/profile');
        expect(buildPath('/users/:id/profile', { id: '...' })).toBe('/users/.../profile');
        expect(buildPath('/users/{id}/profile', { id: 'a..' })).toBe('/users/a../profile');
      });

      it('builds a percent-encoded dot value, which encoding turns into a literal', () => {
        expect(buildPath('/users/:id', { id: '%2e%2e' })).toBe('/users/%252e%252e');
      });

      it('ignores a dot value whose key is not a placeholder in the template', () => {
        expect(buildPath('/users/:id', { id: '1', other: '..' })).toBe('/users/1');
      });
    });
  });

  // MISSED: type-level parser should reject non-identifier tokens after ':'
  describe('ExtractPathParamNames type-level (MISSED)', () => {
    it('does not extract non-identifier text after colon (e.g. time segment 12:30)', () => {
      // The type must resolve to `never` for a path like '/time/12:30'
      // because '30' is not an identifier-shaped param (it starts with a digit).
      expectTypeOf<ExtractPathParamNames<'/time/12:30'>>().toEqualTypeOf<never>();
    });

    it('still extracts valid identifier params', () => {
      expectTypeOf<ExtractPathParamNames<'/users/:id'>>().toEqualTypeOf<'id'>();
    });

    it('extracts underscore-prefixed identifiers', () => {
      expectTypeOf<ExtractPathParamNames<'/users/:_id'>>().toEqualTypeOf<'_id'>();
    });

    it('does not extract a param starting with a digit', () => {
      expectTypeOf<ExtractPathParamNames<'/:123bad'>>().toEqualTypeOf<never>();
    });
  });

  describe('normalizePath', () => {
    it('converts brace params to colon params', () => {
      const result = normalizePath('/users/{userId}');
      expect(result).toBe('/users/:userId');
    });

    it('converts multiple brace params', () => {
      const result = normalizePath('/users/{userId}/posts/{postId}');
      expect(result).toBe('/users/:userId/posts/:postId');
    });

    it('leaves colon params unchanged', () => {
      const result = normalizePath('/users/:userId');
      expect(result).toBe('/users/:userId');
    });

    it('leaves paths without params unchanged', () => {
      const result = normalizePath('/users');
      expect(result).toBe('/users');
    });

    it('handles mixed styles', () => {
      const result = normalizePath('/users/:userId/posts/{postId}');
      expect(result).toBe('/users/:userId/posts/:postId');
    });

    it('handles params with underscores', () => {
      const result = normalizePath('/users/{user_id}');
      expect(result).toBe('/users/:user_id');
    });
  });
});
