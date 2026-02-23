import { hc } from 'hono/client';

import type { ApiAppType } from '@enclave/server/api/app.js';

const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3001';

let _client: ReturnType<typeof hc<ApiAppType>> | null = null;

export const getApiClient = () => {
  if (!_client) {
    _client = hc<ApiAppType>(API_URL);
  }
  return _client;
};

export type { ApiAppType };
export type ApiClient = ReturnType<typeof getApiClient>;
