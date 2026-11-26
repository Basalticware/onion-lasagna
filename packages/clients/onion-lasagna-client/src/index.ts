/**
 * @fileoverview Standalone HTTP client and test utilities for onion-lasagna.
 *
 * Provides the type-safe HTTP client (`createClient`) and test utilities
 * (`createMockClient`, `mockSequence`) for onion-lasagna routers.
 *
 * @module unified/client
 *
 * @example HTTP client
 * ```typescript
 * import { createClient } from '@cosmneo/onion-lasagna-client';
 *
 * const client = createClient(api, { baseUrl: 'http://localhost:3000' });
 * const users = await client.users.list();
 * ```
 *
 * @example Mock client for tests
 * ```typescript
 * import { createMockClient, mockSequence } from '@cosmneo/onion-lasagna-client';
 *
 * const { client, calls, callsFor, reset } = createMockClient(api, {
 *   users: {
 *     list: () => ({ items: [], total: 0 }),
 *   },
 * });
 *
 * const result = await client.users.list();
 * expect(callsFor('users.list')).toHaveLength(1);
 * ```
 */

// HTTP client
export { createClient } from './create-client';
export type {
  ClientConfig,
  ClientCallOptions,
  ClientRequestInput,
  ClientResponse,
  ClientMethod,
  InferClient,
} from './client-types';
export { ClientError, ResponseValidationError } from './client-types';

// Mock client
export { createMockClient, mockSequence } from './create-mock-client';
export type {
  MockRequestInput,
  MockResponse,
  MockHandler,
  MockHandlers,
  MockClientMethod,
  InferMockClient,
  MockCall,
  MockClientResult,
  MockSequenceOptions,
} from './types';
