import { hc } from 'hono/client';

import type { ApiAppType } from './app.js';

/**
 * Creates a typed Hono RPC client for the API.
 *
 * Usage in apps/web:
 * ```ts
 * import { createApiClient } from '../../server/src/api/client.js'
 * const api = createApiClient('http://localhost:3001/api')
 * ```
 */
export const createApiClient = (baseUrl: string) => {
  return hc<ApiAppType>(baseUrl);
};

export type ApiClient = ReturnType<typeof createApiClient>;
