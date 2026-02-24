/**
 * Shared API response types used across all API routes.
 */

/** Structured error response returned by all API error handlers. */
export type ApiError = {
  error: string;
  code: string;
  details?: unknown;
};

/** Wrapper for successful single-value responses. */
export type ApiResponse<T> = {
  data: T;
};

/** Wrapper for paginated list responses. */
export type PaginatedResponse<T> = {
  data: T[];
  total: number;
  offset: number;
  limit: number;
};
