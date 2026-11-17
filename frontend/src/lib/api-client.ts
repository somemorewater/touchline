/**
 * Compatibility re-export. The single implementation now lives in
 * `src/lib/api/client.ts`, which unwraps the backend envelope, attaches the
 * in-memory access token and handles refresh.
 */
export { ApiError, errorMessage, request as apiRequest } from './api/client';
export type { ApiResult } from './api/client';
