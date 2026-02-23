/**
 * Shared account types used across server and client.
 *
 * These types define the shape of account-related API responses
 * and error codes for consistent handling across the stack.
 */

export type KeyExportStatus = {
  confirmed: boolean;
  confirmedAt?: Date;
};

export type AccountStatus = {
  userId: string;
  email: string;
  keyExportConfirmed: boolean;
};

/**
 * Error codes returned by auth and account API endpoints.
 *
 * Clients should match on these codes (not messages) to determine
 * the appropriate user-facing action — e.g. redirecting to the
 * key export flow when `KEY_EXPORT_REQUIRED` is received.
 */
export const AUTH_ERROR_CODES = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  KEY_EXPORT_REQUIRED: 'KEY_EXPORT_REQUIRED',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  INVALID_REQUEST: 'INVALID_REQUEST',
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];
