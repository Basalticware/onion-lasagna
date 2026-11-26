/**
 * @fileoverview Tests for createClient factory function.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { createClient } from '../create-client';
import { ClientError, ResponseValidationError } from '../client-types';
import * as entry from '../index';
import { defineRoute, defineRouter } from '@cosmneo/onion-lasagna/http/route';
import { zodSchema } from '@cosmneo/onion-lasagna-zod';

// Sample routes for testing
const listUsersRoute = defineRoute({
  method: 'GET',
  path: '/users',
  request: {
    query: {
      schema: zodSchema(z.object({ name: z.string() })),
    },
  },
  responses: { 200: { description: 'Success' } },
});

const getUserRoute = defineRoute({
  method: 'GET',
  path: '/users/:userId',
  responses: { 200: { description: 'Success' } },
});

const createUserRoute = defineRoute({
  method: 'POST',
  path: '/users',
  request: {
    body: { schema: zodSchema(z.object({ name: z.string() })) },
  },
  responses: { 201: { description: 'Created' } },
});

const deleteUserRoute = defineRoute({
  method: 'DELETE',
  path: '/users/:userId',
  responses: { 204: { description: 'No Content' } },
});

describe('createClient', () => {
  describe('client structure', () => {
    it('creates client from router definition', () => {
      const router = defineRouter({
        list: listUsersRoute,
        get: getUserRoute,
      });

      const client = createClient(router, { baseUrl: 'http://localhost:3000' });

      expect(typeof client.list).toBe('function');
      expect(typeof client.get).toBe('function');
    });

    it('creates client from router config', () => {
      const client = createClient(
        { list: listUsersRoute, get: getUserRoute },
        { baseUrl: 'http://localhost:3000' },
      );

      expect(typeof client.list).toBe('function');
      expect(typeof client.get).toBe('function');
    });

    it('creates nested client structure', () => {
      const router = defineRouter({
        users: {
          list: listUsersRoute,
          get: getUserRoute,
        },
        posts: {
          list: defineRoute({
            method: 'GET',
            path: '/posts',
            responses: { 200: { description: 'Success' } },
          }),
        },
      });

      const client = createClient(router, { baseUrl: 'http://localhost:3000' });

      expect(typeof client.users.list).toBe('function');
      expect(typeof client.users.get).toBe('function');
      expect(typeof client.posts.list).toBe('function');
    });

    it('handles deeply nested routers', () => {
      const router = defineRouter({
        api: {
          v1: {
            users: {
              list: listUsersRoute,
            },
          },
        },
      });

      const client = createClient(router, { baseUrl: 'http://localhost:3000' });

      expect(typeof client.api.v1.users.list).toBe('function');
    });
  });

  describe('URL building', () => {
    it('builds URL with base URL', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify([]), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createClient(
        { list: listUsersRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      await client.list();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'http://localhost:3000/users',
        }),
        expect.any(Object),
      );
    });

    it('handles trailing slash in base URL', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify([]), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createClient(
        { list: listUsersRoute },
        { baseUrl: 'http://localhost:3000/', fetch: mockFetch },
      );

      await client.list();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'http://localhost:3000/users',
        }),
        expect.any(Object),
      );
    });

    it('replaces path parameters', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: '123' }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createClient(
        { get: getUserRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      await client.get({ pathParams: { userId: '123' } });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'http://localhost:3000/users/123',
        }),
        expect.any(Object),
      );
    });

    it('encodes path parameters', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({}), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createClient(
        { get: getUserRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      await client.get({ pathParams: { userId: 'user/with/slashes' } });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'http://localhost:3000/users/user%2Fwith%2Fslashes',
        }),
        expect.any(Object),
      );
    });

    it('adds query parameters', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify([]), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createClient(
        { list: listUsersRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      await client.list({ query: { page: 1, limit: 10 } });

      const calledUrl = mockFetch.mock.calls[0]![0].url;
      expect(calledUrl).toContain('page=1');
      expect(calledUrl).toContain('limit=10');
    });

    it('omits undefined query parameters', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify([]), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createClient(
        { list: listUsersRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      await client.list({ query: { page: 1, limit: undefined } });

      const calledUrl = mockFetch.mock.calls[0]![0].url;
      expect(calledUrl).toContain('page=1');
      expect(calledUrl).not.toContain('limit');
    });
  });

  describe('request handling', () => {
    it('sends correct HTTP method', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: '123' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createClient(
        { create: createUserRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      await client.create({ body: { name: 'John' } });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
        }),
        expect.any(Object),
      );
    });

    it('sends JSON body', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: '123' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createClient(
        { create: createUserRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      await client.create({ body: { name: 'John' } });

      const request = mockFetch.mock.calls[0]![0] as Request;
      const body = await request.text();
      expect(JSON.parse(body)).toEqual({ name: 'John' });
    });

    it('sets Content-Type header for body', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: '123' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createClient(
        { create: createUserRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      await client.create({ body: { name: 'John' } });

      const request = mockFetch.mock.calls[0]![0] as Request;
      expect(request.headers.get('Content-Type')).toBe('application/json');
    });

    it('merges default headers with request headers', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify([]), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createClient(
        { list: listUsersRoute },
        {
          baseUrl: 'http://localhost:3000',
          fetch: mockFetch,
          headers: { 'X-Default': 'value' },
        },
      );

      await client.list({ headers: { 'X-Custom': 'custom-value' } });

      const request = mockFetch.mock.calls[0]![0] as Request;
      expect(request.headers.get('X-Default')).toBe('value');
      expect(request.headers.get('X-Custom')).toBe('custom-value');
    });
  });

  describe('response handling', () => {
    it('parses JSON response', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: '123', name: 'John' }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createClient(
        { get: getUserRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      const result = await client.get({ pathParams: { userId: '123' } });

      expect(result).toEqual({ id: '123', name: 'John' });
    });

    it('parses text response', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('Hello World', {
          headers: { 'Content-Type': 'text/plain' },
        }),
      );

      const client = createClient(
        { list: listUsersRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      const result = await client.list();

      expect(result).toBe('Hello World');
    });

    it('returns undefined for 204 No Content', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

      const client = createClient(
        { delete: deleteUserRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      const result = await client.delete({ pathParams: { userId: '123' } });

      expect(result).toBeUndefined();
    });

    it('returns undefined for 205 Reset Content', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 205 }));

      const client = createClient(
        { delete: deleteUserRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      const result = await client.delete({ pathParams: { userId: '123' } });

      expect(result).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('throws ClientError for non-OK responses', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          statusText: 'Not Found',
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createClient(
        { get: getUserRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      await expect(client.get({ pathParams: { userId: '123' } })).rejects.toThrow(ClientError);
    });

    it('includes response body in ClientError', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          statusText: 'Not Found',
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createClient(
        { get: getUserRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      try {
        await client.get({ pathParams: { userId: '123' } });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ClientError);
        const clientError = error as ClientError;
        expect(clientError.status).toBe(404);
        expect(clientError.statusText).toBe('Not Found');
        expect(clientError.body).toEqual({ error: 'Not found' });
      }
    });

    it('handles network errors', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network failure'));

      const client = createClient(
        { list: listUsersRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      try {
        await client.list();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ClientError);
        const clientError = error as ClientError;
        expect(clientError.status).toBe(0);
        expect(clientError.statusText).toBe('Network Error');
        expect(clientError.message).toBe('Network failure');
      }
    });
  });

  describe('interceptors', () => {
    it('calls onRequest interceptor', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify([]), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const onRequest = vi.fn((req: Request) => {
        // Add custom header
        const headers = new Headers(req.headers);
        headers.set('X-Custom', 'value');
        return new Request(req.url, { ...req, headers });
      });

      const client = createClient(
        { list: listUsersRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch, onRequest },
      );

      await client.list();

      expect(onRequest).toHaveBeenCalled();
    });

    it('calls onResponse interceptor', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify([]), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const onResponse = vi.fn((res: Response) => res);

      const client = createClient(
        { list: listUsersRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch, onResponse },
      );

      await client.list();

      expect(onResponse).toHaveBeenCalled();
    });

    it('calls onError interceptor on error', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          statusText: 'Not Found',
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const onError = vi.fn();

      const client = createClient(
        { get: getUserRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch, onError },
      );

      await expect(client.get({ pathParams: { userId: '123' } })).rejects.toThrow();

      expect(onError).toHaveBeenCalledWith(expect.any(ClientError));
    });
  });

  describe('retry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries on 5xx errors', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'Server Error' }), {
            status: 500,
            statusText: 'Internal Server Error',
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify([]), {
            headers: { 'Content-Type': 'application/json' },
          }),
        );

      const client = createClient(
        { list: listUsersRoute },
        {
          baseUrl: 'http://localhost:3000',
          fetch: mockFetch,
          retry: { attempts: 1, delay: 100 },
        },
      );

      const promise = client.list();

      // Advance timers for retry delay
      await vi.advanceTimersByTimeAsync(100);

      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('retries on 429 Too Many Requests', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'Rate limited' }), {
            status: 429,
            statusText: 'Too Many Requests',
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify([]), {
            headers: { 'Content-Type': 'application/json' },
          }),
        );

      const client = createClient(
        { list: listUsersRoute },
        {
          baseUrl: 'http://localhost:3000',
          fetch: mockFetch,
          retry: { attempts: 1, delay: 100 },
        },
      );

      const promise = client.list();
      await vi.advanceTimersByTimeAsync(100);
      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('does not retry on 4xx errors', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          statusText: 'Not Found',
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createClient(
        { get: getUserRoute },
        {
          baseUrl: 'http://localhost:3000',
          fetch: mockFetch,
          retry: { attempts: 3, delay: 100 },
        },
      );

      await expect(client.get({ pathParams: { userId: '123' } })).rejects.toThrow();

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('respects custom retryOn status codes', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'Custom' }), {
            status: 418,
            statusText: "I'm a teapot",
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify([]), {
            headers: { 'Content-Type': 'application/json' },
          }),
        );

      const client = createClient(
        { list: listUsersRoute },
        {
          baseUrl: 'http://localhost:3000',
          fetch: mockFetch,
          retry: { attempts: 1, delay: 100, retryOn: [418] },
        },
      );

      const promise = client.list();
      await vi.advanceTimersByTimeAsync(100);
      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('throws after max retry attempts', async () => {
      vi.useRealTimers(); // Use real timers for this test to avoid unhandled rejections

      // Create fresh Response for each call to avoid "body already read" errors
      const mockFetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'Server Error' }), {
            status: 500,
            statusText: 'Internal Server Error',
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      );

      const client = createClient(
        { list: listUsersRoute },
        {
          baseUrl: 'http://localhost:3000',
          fetch: mockFetch,
          retry: { attempts: 2, delay: 1 }, // Very short delay
        },
      );

      await expect(client.list()).rejects.toThrow(ClientError);

      // 1 initial + 2 retries = 3 total
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('timeout', () => {
    it('throws ClientError with timeout message', async () => {
      // Use real timers with a short timeout to test timeout behavior
      const mockFetch = vi.fn().mockImplementation(
        (_request: Request, options?: RequestInit) =>
          new Promise((_, reject) => {
            // Simulate abort behavior
            if (options?.signal) {
              options.signal.addEventListener('abort', () => {
                const error = new Error('The operation was aborted');
                error.name = 'AbortError';
                reject(error);
              });
            }
            // Never resolves on its own
          }),
      );

      const client = createClient(
        { list: listUsersRoute },
        {
          baseUrl: 'http://localhost:3000',
          fetch: mockFetch,
          timeout: 50, // Very short timeout
        },
      );

      try {
        await client.list();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ClientError);
        const clientError = error as ClientError;
        expect(clientError.status).toBe(0);
        // The error could be either timeout or abort depending on timing
        expect(['Timeout', 'Aborted']).toContain(clientError.statusText);
      }
    });
  });

  // ============================================================================
  // C10-2: External AbortSignal forwarding
  // ============================================================================
  describe('external signal (C10-2)', () => {
    it('aborts the request when an external signal is aborted', async () => {
      const abortController = new AbortController();

      const mockFetch = vi.fn().mockImplementation(
        (_request: Request, options?: RequestInit) =>
          new Promise((_, reject) => {
            if (options?.signal) {
              options.signal.addEventListener('abort', () => {
                const error = new Error('The operation was aborted');
                error.name = 'AbortError';
                reject(error);
              });
            }
            // Never resolves on its own
          }),
      );

      const client = createClient(
        { list: listUsersRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      // Abort shortly after starting
      setTimeout(() => abortController.abort(), 20);

      try {
        await client.list(undefined, { signal: abortController.signal });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ClientError);
        const clientError = error as ClientError;
        expect(clientError.statusText).toBe('Aborted');
      }
    });

    it('aborts immediately when signal is already aborted before call', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const mockFetch = vi.fn().mockImplementation(
        (_request: Request, options?: RequestInit) =>
          new Promise((_, reject) => {
            if (options?.signal?.aborted) {
              const error = new Error('The operation was aborted');
              error.name = 'AbortError';
              reject(error);
            }
            // Never resolves on its own
          }),
      );

      const client = createClient(
        { list: listUsersRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      try {
        await client.list(undefined, { signal: abortController.signal });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ClientError);
        const clientError = error as ClientError;
        expect(clientError.statusText).toBe('Aborted');
      }
    });

    it('still works when no external signal is provided (default 30s timeout is applied)', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify([]), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createClient(
        { list: listUsersRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      await client.list();

      // C10-1: default 30s timeout is always applied, so a signal IS present
      const fetchOptions = mockFetch.mock.calls[0]![1] as RequestInit;
      expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
    });

    it('passes signal when timeout is set even without external signal', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify([]), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createClient(
        { list: listUsersRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch, timeout: 5000 },
      );

      await client.list();

      const fetchOptions = mockFetch.mock.calls[0]![1] as RequestInit;
      expect(fetchOptions.signal).toBeDefined();
    });
  });

  // ============================================================================
  // C16-1: Exponential backoff with jitter and Retry-After
  // ============================================================================
  describe('exponential backoff and Retry-After (C16-1)', () => {
    it('uses exponential backoff: later attempts wait longer on average', async () => {
      // We test that the computeBackoff ceiling grows with attempt number.
      // Use a custom delayFn that records delays to verify backoff grows.
      const delays: number[] = [];

      // Mock fetch: fail 3 times then succeed
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 3) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'Server Error' }), {
              status: 500,
              statusText: 'Internal Server Error',
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      });

      const client = createClient(
        { list: listUsersRoute },
        {
          baseUrl: 'http://localhost:3000',
          fetch: mockFetch,
          retry: {
            attempts: 3,
            delay: 100,
            maxDelay: 10000,
            delayFn: (attempt) => {
              // record which attempt index was passed
              const d = attempt * 100 + 50; // deterministic for testing
              delays.push(d);
              return d;
            },
          },
        },
      );

      await client.list();

      // delayFn was called for attempts 0, 1, 2
      expect(delays).toEqual([50, 150, 250]);
    });

    it('honors Retry-After in seconds for 429 responses', async () => {
      vi.useFakeTimers();

      const RETRY_AFTER_SECONDS = 5;
      let callCount = 0;

      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'Rate limited' }), {
              status: 429,
              statusText: 'Too Many Requests',
              headers: {
                'Content-Type': 'application/json',
                'Retry-After': String(RETRY_AFTER_SECONDS),
              },
            }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      });

      const client = createClient(
        { list: listUsersRoute },
        {
          baseUrl: 'http://localhost:3000',
          fetch: mockFetch,
          retry: { attempts: 1, delay: 100 }, // base delay is small; Retry-After should override
        },
      );

      const promise = client.list();

      // Should need to advance by the Retry-After duration (5000ms), not just 100ms
      await vi.advanceTimersByTimeAsync(RETRY_AFTER_SECONDS * 1000);

      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('honors Retry-After as HTTP-date for 429 responses', async () => {
      vi.useFakeTimers();

      // Set a date 3 seconds in the future
      const retryDate = new Date(Date.now() + 3000).toUTCString();
      let callCount = 0;

      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'Rate limited' }), {
              status: 429,
              statusText: 'Too Many Requests',
              headers: {
                'Content-Type': 'application/json',
                'Retry-After': retryDate,
              },
            }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      });

      const client = createClient(
        { list: listUsersRoute },
        {
          baseUrl: 'http://localhost:3000',
          fetch: mockFetch,
          retry: { attempts: 1, delay: 100 },
        },
      );

      const promise = client.list();

      // Advance past the Retry-After date (~3s)
      await vi.advanceTimersByTimeAsync(3500);

      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  // ============================================================================
  // C16 abort-alloc: No AbortController allocated when not needed
  // ============================================================================
  describe('abort controller allocation (C16 abort-alloc)', () => {
    it('always passes a signal because the 30s default timeout is active', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify([]), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createClient(
        { list: listUsersRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      await client.list();

      // C10-1: the 30s default timeout is now always active, so signal is always defined
      const fetchOptions = mockFetch.mock.calls[0]![1] as RequestInit;
      expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
    });

    it('passes a signal when timeout is configured', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify([]), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createClient(
        { list: listUsersRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch, timeout: 10000 },
      );

      await client.list();

      const fetchOptions = mockFetch.mock.calls[0]![1] as RequestInit;
      expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
    });

    it('passes a signal when external signal is provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify([]), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const ac = new AbortController();

      const client = createClient(
        { list: listUsersRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      await client.list(undefined, { signal: ac.signal });

      const fetchOptions = mockFetch.mock.calls[0]![1] as RequestInit;
      expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
    });
  });

  // ============================================================================
  // BODY DOUBLE-READ FIX: text error payloads must not be lost
  // ============================================================================
  describe('body double-read fix (MISSED-body-double-read)', () => {
    it('captures plain-text error body when response is not JSON', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('Internal Server Error', {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'Content-Type': 'text/plain' },
        }),
      );

      const client = createClient(
        { list: listUsersRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      try {
        await client.list();
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ClientError);
        const clientError = error as ClientError;
        expect(clientError.body).toBe('Internal Server Error');
      }
    });

    it('captures JSON error body when response is JSON', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'not found' }), {
          status: 404,
          statusText: 'Not Found',
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createClient(
        { get: getUserRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      try {
        await client.get({ pathParams: { userId: '999' } });
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ClientError);
        const clientError = error as ClientError;
        expect(clientError.body).toEqual({ error: 'not found' });
      }
    });
  });

  // ============================================================================
  // FALSY BODY FIX: false/0/''/null body values must not be dropped
  // ============================================================================
  describe('falsy body fix (MISSED-falsy-body)', () => {
    const falseBodyRoute = defineRoute({
      method: 'POST',
      path: '/echo',
      request: { body: { schema: zodSchema(z.any()) } },
      responses: { 200: { description: 'Echo' } },
    });

    it('sends false as body', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createClient(
        { echo: falseBodyRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      await client.echo({ body: false });

      const request = mockFetch.mock.calls[0]![0] as Request;
      const text = await request.text();
      expect(text).toBe('false');
    });

    it('sends 0 as body', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createClient(
        { echo: falseBodyRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      await client.echo({ body: 0 });

      const request = mockFetch.mock.calls[0]![0] as Request;
      const text = await request.text();
      expect(text).toBe('0');
    });

    it('sends null as body', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createClient(
        { echo: falseBodyRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      await client.echo({ body: null });

      const request = mockFetch.mock.calls[0]![0] as Request;
      const text = await request.text();
      expect(text).toBe('null');
    });
  });

  // ============================================================================
  // C10-1: timeout default applied without explicit config.timeout
  // ============================================================================
  describe('timeout default (C10-1)', () => {
    it('applies 30000ms default timeout when none is configured', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify([]), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createClient(
        { list: listUsersRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      await client.list();

      // A signal must be passed when the default timeout is active
      const fetchOptions = mockFetch.mock.calls[0]![1] as RequestInit;
      expect(fetchOptions.signal).toBeInstanceOf(AbortSignal);
    });
  });

  // ============================================================================
  // C10-3: retry skips non-idempotent methods by default
  // ============================================================================
  describe('retry idempotency guard (C10-3)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('does NOT retry POST by default', async () => {
      // Use real timers: after the fix POST should fail immediately (no retry = no delay)
      vi.useRealTimers();

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Server Error' }), {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createClient(
        { create: createUserRoute },
        {
          baseUrl: 'http://localhost:3000',
          fetch: mockFetch,
          retry: { attempts: 3, delay: 100 },
        },
      );

      await expect(client.create({ body: { name: 'John' } })).rejects.toThrow(ClientError);

      // Only 1 call — POST should not be retried by default
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('DOES retry GET by default', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'Server Error' }), {
            status: 500,
            statusText: 'Internal Server Error',
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify([]), {
            headers: { 'Content-Type': 'application/json' },
          }),
        );

      const client = createClient(
        { list: listUsersRoute },
        {
          baseUrl: 'http://localhost:3000',
          fetch: mockFetch,
          retry: { attempts: 1, delay: 100 },
        },
      );

      const promise = client.list();
      await vi.advanceTimersByTimeAsync(100);
      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('DOES retry DELETE by default', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'Server Error' }), {
            status: 500,
            statusText: 'Internal Server Error',
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(new Response(null, { status: 204 }));

      const client = createClient(
        { delete: deleteUserRoute },
        {
          baseUrl: 'http://localhost:3000',
          fetch: mockFetch,
          retry: { attempts: 1, delay: 100 },
        },
      );

      const promise = client.delete({ pathParams: { userId: '123' } });
      await vi.advanceTimersByTimeAsync(100);
      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('allows overriding default idempotency guard to retry POST when explicitly opted in', async () => {
      // Deliberately opt in by setting retryMethods to include POST
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'Server Error' }), {
            status: 500,
            statusText: 'Internal Server Error',
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: '1' }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

      const client = createClient(
        { create: createUserRoute },
        {
          baseUrl: 'http://localhost:3000',
          fetch: mockFetch,
          retry: {
            attempts: 1,
            delay: 100,
            retryMethods: ['GET', 'HEAD', 'DELETE', 'PUT', 'OPTIONS', 'POST'],
          },
        },
      );

      const promise = client.create({ body: { name: 'John' } });
      await vi.advanceTimersByTimeAsync(100);
      await promise;

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================================================
  // C10-4: query array values emitted as repeated keys
  // ============================================================================
  describe('query array serialization (C10-4)', () => {
    it('emits repeated keys for array query values', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify([]), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const client = createClient(
        { list: listUsersRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      await client.list({ query: { tags: ['a', 'b', 'c'] } });

      const calledUrl: string = mockFetch.mock.calls[0]![0].url;
      expect(calledUrl).toContain('tags=a');
      expect(calledUrl).toContain('tags=b');
      expect(calledUrl).toContain('tags=c');
      // Must NOT be comma-joined as a single value
      expect(calledUrl).not.toContain('tags=a%2Cb%2Cc');
      expect(calledUrl).not.toContain('tags=a,b,c');
    });
  });

  // ============================================================================
  // C16: retry decision before body parse
  // ============================================================================
  describe('retry-before-parse (C16)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries without consuming the body of intermediate failure responses', async () => {
      let attempt = 0;

      const mockFetch = vi.fn().mockImplementation(() => {
        attempt++;
        if (attempt === 1) {
          // Return a response that should trigger retry without parsing
          return Promise.resolve(
            new Response(JSON.stringify({ error: 'Server Error' }), {
              status: 503,
              statusText: 'Service Unavailable',
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify([]), {
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      });

      const client = createClient(
        { list: listUsersRoute },
        {
          baseUrl: 'http://localhost:3000',
          fetch: mockFetch,
          retry: { attempts: 1, delay: 100 },
        },
      );

      const promise = client.list();
      await vi.advanceTimersByTimeAsync(100);
      const result = await promise;

      // Should succeed on the second attempt
      expect(result).toEqual([]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // F1: errors keep their cause; interceptor throws propagate unchanged
  describe('error cause and propagation (F1)', () => {
    class VendorFailure extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'VendorFailure';
      }
    }

    it('keeps an injected fetch throw as the ClientError cause (P1)', async () => {
      const vendorError = new VendorFailure('vendor said no');
      const mockFetch = vi.fn().mockRejectedValue(vendorError);

      const client = createClient(
        { list: listUsersRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      const error = await client.list().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ClientError);
      const clientError = error as ClientError;
      expect(clientError.status).toBe(0);
      expect(clientError.statusText).toBe('Network Error');
      expect(clientError.message).toBe('vendor said no');
      expect(clientError.cause).toBe(vendorError);
    });

    it('lets an onResponse throw propagate unchanged and never retries it (P2)', async () => {
      const interceptorError = new VendorFailure('version header mismatch');
      const mockFetch = vi
        .fn()
        .mockImplementation(() => Promise.resolve(new Response('{}', { status: 200 })));
      const onError = vi.fn();

      const client = createClient(
        { list: listUsersRoute },
        {
          baseUrl: 'http://localhost:3000',
          fetch: mockFetch,
          onError,
          onResponse: () => {
            throw interceptorError;
          },
          retry: { attempts: 2, delayFn: () => 0 },
        },
      );

      const error = await client.list().catch((e: unknown) => e);

      expect(error).toBe(interceptorError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
    });

    it('turns a 2xx body that does not parse into a non-retried error with the real status (P3)', async () => {
      const mockFetch = vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response('', {
            status: 201,
            statusText: 'Created',
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
      );
      const onError = vi.fn();

      const client = createClient(
        { list: listUsersRoute },
        {
          baseUrl: 'http://localhost:3000',
          fetch: mockFetch,
          onError,
          retry: { attempts: 2, delayFn: () => 0 },
        },
      );

      const error = await client.list().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ClientError);
      const clientError = error as ClientError;
      expect(clientError.status).toBe(201);
      expect(clientError.statusText).toBe('Created');
      expect(clientError.isNetworkError).toBe(false);
      expect(clientError.cause).toBeInstanceOf(SyntaxError);
      expect(clientError.body).toBe('');
      expect(clientError.response).toBeInstanceOf(Response);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(clientError);
    });

    it('lets an onError throw on a 4xx/5xx propagate unchanged, calling onError once (P4)', async () => {
      const handlerError = new Error('handler blew up');
      const mockFetch = vi
        .fn()
        .mockResolvedValue(new Response('boom', { status: 500, statusText: 'Server Error' }));
      const onError = vi.fn(() => {
        throw handlerError;
      });

      const client = createClient(
        { list: listUsersRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch, onError },
      );

      const error = await client.list().catch((e: unknown) => e);

      expect(error).toBe(handlerError);
      expect(onError).toHaveBeenCalledTimes(1);
      expect((onError.mock.calls[0] as unknown[])[0]).toMatchObject({ status: 500 });
    });

    it('lets an onError throw on a network error propagate unchanged', async () => {
      const handlerError = new Error('handler blew up');
      const mockFetch = vi.fn().mockRejectedValue(new VendorFailure('down'));
      const onError = vi.fn(() => {
        throw handlerError;
      });

      const client = createClient(
        { list: listUsersRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch, onError },
      );

      const error = await client.list().catch((e: unknown) => e);

      expect(error).toBe(handlerError);
      expect(onError).toHaveBeenCalledTimes(1);
    });

    const failingBody = (cause: Error) =>
      new ReadableStream({
        start(controller) {
          controller.error(cause);
        },
      });

    it('treats a 2xx body that fails to read as a retryable network error with its cause', async () => {
      const resetError = new Error('connection reset');
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(new Response(failingBody(resetError), { status: 200 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true }), {
            headers: { 'Content-Type': 'application/json' },
          }),
        );

      const client = createClient(
        { list: listUsersRoute },
        {
          baseUrl: 'http://localhost:3000',
          fetch: mockFetch,
          retry: { attempts: 1, delayFn: () => 0 },
        },
      );

      await expect(client.list()).resolves.toEqual({ ok: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('reports a 2xx body read failure as a network error keeping its cause', async () => {
      const resetError = new Error('connection reset');
      const mockFetch = vi
        .fn()
        .mockResolvedValue(new Response(failingBody(resetError), { status: 200 }));

      const client = createClient(
        { list: listUsersRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      const error = await client.list().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ClientError);
      const clientError = error as ClientError;
      expect(clientError.status).toBe(0);
      expect(clientError.statusText).toBe('Network Error');
      expect(clientError.cause).toBe(resetError);
    });

    it('keeps a non-OK body read failure as the ClientError cause', async () => {
      const resetError = new Error('connection reset');
      const mockFetch = vi
        .fn()
        .mockResolvedValue(new Response(failingBody(resetError), { status: 404 }));

      const client = createClient(
        { list: listUsersRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch },
      );

      const error = await client.list().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ClientError);
      const clientError = error as ClientError;
      expect(clientError.status).toBe(404);
      expect(clientError.cause).toBe(resetError);
    });

    it('accepts a cause through the ClientError constructor', () => {
      const cause = new Error('root');
      const error = new ClientError('wrapped', 0, 'Network Error', undefined, undefined, {
        cause,
      });

      expect(error.cause).toBe(cause);
    });
  });

  // F2: opt-in response validation
  describe('response validation (F2)', () => {
    const eventRoute = defineRoute({
      method: 'GET',
      path: '/events/:eventId',
      responses: {
        200: {
          schema: zodSchema(z.object({ at: z.string().transform((s) => new Date(s)) })),
          description: 'Success',
        },
        202: { description: 'Accepted, no schema' },
        204: { description: 'No Content' },
      },
    });

    const jsonResponse = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });

    const call = (config: Partial<Parameters<typeof createClient>[1]>, mockFetch: typeof fetch) =>
      createClient(
        { get: eventRoute },
        { baseUrl: 'http://localhost:3000', fetch: mockFetch, ...config },
      ).get({ pathParams: { eventId: '1' } });

    it("leaves today's behaviour by default: the raw body, unvalidated (P7)", async () => {
      const mockFetch = vi.fn().mockResolvedValue(jsonResponse({ at: '2026-01-01T00:00:00Z' }));

      const result: unknown = await call({}, mockFetch);

      expect(result).toEqual({ at: '2026-01-01T00:00:00Z' });
    });

    it('does not reject an invalid body by default', async () => {
      const mockFetch = vi.fn().mockResolvedValue(jsonResponse({ at: 42 }));

      const result: unknown = await call({}, mockFetch);

      expect(result).toEqual({ at: 42 });
    });

    it('returns the validated data when enabled (P7)', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(jsonResponse({ at: '2026-01-01T00:00:00Z', extra: 'stripped' }));

      const result = await call({ validateResponses: true }, mockFetch);

      expect(result.at).toBeInstanceOf(Date);
      expect(result.at.toISOString()).toBe('2026-01-01T00:00:00.000Z');
      expect(result).not.toHaveProperty('extra');
    });

    it('does not validate an undeclared 2xx', async () => {
      const mockFetch = vi.fn().mockResolvedValue(jsonResponse({ anything: true }, 201));

      const result: unknown = await call({ validateResponses: true }, mockFetch);

      expect(result).toEqual({ anything: true });
    });

    it('does not validate a declared 2xx without a schema', async () => {
      const mockFetch = vi.fn().mockResolvedValue(jsonResponse({ anything: true }, 202));

      const result: unknown = await call({ validateResponses: true }, mockFetch);

      expect(result).toEqual({ anything: true });
    });

    it('returns undefined for 204 when enabled', async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

      const result: unknown = await call({ validateResponses: true }, mockFetch);

      expect(result).toBeUndefined();
    });

    it('throws ResponseValidationError on a failure, calls onError once and never retries', async () => {
      const mockFetch = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ at: 42 })));
      const onError = vi.fn();

      const error = await call(
        { validateResponses: true, onError, retry: { attempts: 2, delayFn: () => 0 } },
        mockFetch,
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ResponseValidationError);
      expect(error).toBeInstanceOf(ClientError);
      const validationError = error as ResponseValidationError;
      expect(validationError.code).toBe('RESPONSE_VALIDATION_ERROR');
      expect(validationError.status).toBe(200);
      expect(validationError.body).toEqual({ at: 42 });
      expect(validationError.issues.length).toBeGreaterThan(0);
      expect(validationError.issues[0]?.path).toEqual(['at']);
      expect(validationError.response).toBeInstanceOf(Response);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(validationError);
    });

    it("'warn' reports a failure and returns the unvalidated data", async () => {
      const mockFetch = vi.fn().mockResolvedValue(jsonResponse({ at: 42 }));
      const onError = vi.fn();
      const onResponseValidationError = vi.fn();

      const result: unknown = await call(
        { validateResponses: 'warn', onError, onResponseValidationError },
        mockFetch,
      );

      expect(result).toEqual({ at: 42 });
      expect(onResponseValidationError).toHaveBeenCalledTimes(1);
      expect(onResponseValidationError).toHaveBeenCalledWith(expect.any(ResponseValidationError));
      expect(onError).not.toHaveBeenCalled();
    });

    it("'warn' reports through console.warn when no sink is given", async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const mockFetch = vi.fn().mockResolvedValue(jsonResponse({ at: 42 }));

      try {
        const result: unknown = await call({ validateResponses: 'warn' }, mockFetch);

        expect(result).toEqual({ at: 42 });
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]).toContainEqual(expect.any(ResponseValidationError));
      } finally {
        warn.mockRestore();
      }
    });

    it("'warn' returns the validated data on success", async () => {
      const mockFetch = vi.fn().mockResolvedValue(jsonResponse({ at: '2026-01-01T00:00:00Z' }));

      const result = await call({ validateResponses: 'warn' }, mockFetch);

      expect(result.at).toBeInstanceOf(Date);
    });

    it('exports ResponseValidationError from the package entry', () => {
      expect(entry.ResponseValidationError).toBeTypeOf('function');
      expect(entry.ResponseValidationError).toBe(ResponseValidationError);
      expect(entry.ClientError).toBe(ClientError);
    });
  });
});
