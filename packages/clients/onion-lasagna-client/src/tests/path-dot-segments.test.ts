/**
 * @fileoverview F6 (research 11, probe P6): `createClient` refuses a `.` or `..`
 * path value before it sends any request.
 *
 * A dot-segment value collapses under URL parsing: route `/users/:id/profile`
 * with `id: '..'` and base URL `http://h/api` would go to `http://h/api/profile`.
 */

import { describe, it, expect } from 'vitest';
import { InvalidRequestError } from '@cosmneo/onion-lasagna';
import { defineRoute, defineRouter } from '@cosmneo/onion-lasagna/http/route';
import { createClient } from '../create-client';

const profileRoute = defineRoute({
  method: 'GET',
  path: '/users/:id/profile',
  responses: { 200: { description: 'Success' } },
});

const router = defineRouter({ profile: profileRoute });

/** An injected fetch that records every request it receives and answers 200. */
function recordingFetch(): { fetch: typeof fetch; sent: string[] } {
  const sent: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    sent.push(input instanceof Request ? input.url : String(input));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetch: fetchFn, sent };
}

async function refusalOf(call: () => Promise<unknown>): Promise<InvalidRequestError> {
  try {
    await call();
  } catch (error) {
    if (error instanceof InvalidRequestError) return error;
    throw error;
  }
  throw new Error('expected the call to be refused');
}

describe('createClient path values (F6)', () => {
  it.each(['..', '.'])('refuses %j as a path value and sends no request (P6)', async (id) => {
    const transport = recordingFetch();
    const client = createClient(router, {
      baseUrl: 'http://h/api',
      fetch: transport.fetch,
      retry: { attempts: 2, delayFn: () => 0 },
    });

    const error = await refusalOf(() => client.profile({ pathParams: { id } }));

    expect(error.code).toBe('INVALID_REQUEST');
    expect(error.validationErrors.map((v) => v.field)).toEqual(['pathParams.id']);
    expect(transport.sent).toEqual([]);
  });

  it.each([
    ['a.b', 'http://h/api/users/a.b/profile'],
    ['..a', 'http://h/api/users/..a/profile'],
  ])('still sends a value that merely contains dots (%j)', async (id, url) => {
    const transport = recordingFetch();
    const client = createClient(router, { baseUrl: 'http://h/api', fetch: transport.fetch });

    await client.profile({ pathParams: { id } });

    expect(transport.sent).toEqual([url]);
  });
});
