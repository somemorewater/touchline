/**
 * Central REST client for the TOUCHLINE backend.
 *
 * - One place defines the API origin.
 * - The backend envelope (`{ success, data, meta? }`) is unwrapped here.
 * - Access tokens live in memory only; refresh tokens remain in the backend's
 *   httpOnly cookie, so no credential is ever written to browser storage.
 * - A single-flight refresh retries one request after a 401.
 * - A failed refresh emits `touchline:auth-expired` so the auth provider can
 *   clear the session and the query cache.
 */

export interface ApiErrorDetail {
  field?: string;
  message: string;
}

interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    statusCode: number;
    requestId?: string;
    details?: ApiErrorDetail[];
  };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorDetail[];
  readonly requestId?: string;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { details?: ApiErrorDetail[]; requestId?: string } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = options.details ?? [];
    this.requestId = options.requestId;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }

  get isValidation(): boolean {
    return this.status === 400 || this.status === 422;
  }
}

const DEFAULT_API_BASE = 'http://localhost:4000/api/v1';

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || DEFAULT_API_BASE
).replace(/\/+$/, '');

export const WS_BASE_URL = (
  process.env.NEXT_PUBLIC_WS_BASE_URL?.trim() ||
  `${API_BASE_URL.replace(/^http/, 'ws').replace(/\/api\/v1$/, '')}`
).replace(/\/+$/, '');

type QueryValue = string | number | boolean | null | undefined;

export type Query = Record<string, QueryValue>;

let accessToken: string | null = null;
let refreshInFlight: Promise<string | null> | null = null;
let expiredHandler: (() => void) | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** Register the auth provider's session-expiry callback. */
export function onAuthExpired(handler: () => void): () => void {
  expiredHandler = handler;
  return () => {
    if (expiredHandler === handler) expiredHandler = null;
  };
}

function notifyExpired(): void {
  accessToken = null;
  expiredHandler?.();
}

function buildUrl(path: string, query?: Query): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${API_BASE_URL}${normalized}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function errorFromBody(status: number, body: unknown, fallback: string): ApiError {
  const parsed = body as Partial<ApiErrorBody> | undefined;
  if (parsed && typeof parsed === 'object' && parsed.error) {
    return new ApiError(status, parsed.error.code ?? 'REQUEST_FAILED', parsed.error.message ?? fallback, {
      details: parsed.error.details,
      requestId: parsed.error.requestId,
    });
  }
  return new ApiError(status, 'REQUEST_FAILED', fallback);
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** Refresh the short-lived access token using the httpOnly refresh cookie. */
export async function refreshSession(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const response = await fetch(buildUrl('/auth/refresh'), {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      const body = await readBody(response);
      if (!response.ok) {
        accessToken = null;
        return null;
      }
      const envelope = body as { success: true; data: { accessToken: string } };
      accessToken = envelope.data.accessToken;
      return accessToken;
    } catch {
      accessToken = null;
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
  /** Send the Bearer token when available. Defaults to true. */
  auth?: boolean;
  /** Retry once through the refresh endpoint on 401. Defaults to true. */
  retryOn401?: boolean;
  /** Ask the backend to de-duplicate a mutating request. */
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

export interface ApiResult<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export async function requestResult<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const { method = 'GET', body, query, signal, auth = true, retryOn401 = true } = options;

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
    if (auth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

    return fetch(buildUrl(path, query), {
      method,
      credentials: 'include',
      signal,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  };

  let response: Response;
  try {
    response = await send();
    if (response.status === 401 && auth && retryOn401) {
      const refreshed = await refreshSession();
      if (refreshed) {
        response = await send();
      }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'The server could not be reached. Check your connection and try again.');
  }

  const payload = await readBody(response);

  if (!response.ok) {
    const apiError = errorFromBody(response.status, payload, response.statusText || 'Request failed.');
    if (apiError.status === 401 && auth) notifyExpired();
    throw apiError;
  }

  if (response.status === 204 || payload === undefined) {
    return { data: undefined as T };
  }

  const envelope = payload as { success?: boolean; data?: T; meta?: Record<string, unknown> };
  if (envelope && typeof envelope === 'object' && envelope.success === true) {
    return { data: envelope.data as T, meta: envelope.meta };
  }
  // A non-enveloped success is not part of the backend contract, but never
  // silently turn it into a typed value the caller did not ask for.
  throw new ApiError(response.status, 'INVALID_RESPONSE', 'The server returned an unexpected response.');
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return (await requestResult<T>(path, options)).data;
}

export async function requestWithMeta<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T; meta?: Record<string, unknown> }> {
  return requestResult<T>(path, options);
}

/** Upload a raw binary body (evidence files use a non-multipart contract). */
export async function uploadBinary(path: string, file: File): Promise<unknown> {
  const safeName = file.name.replace(/[^\w.\-() ]+/g, '_');
  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': file.type,
      'x-file-name': safeName,
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return fetch(buildUrl(path), { method: 'POST', credentials: 'include', headers, body: file });
  };

  let response = await send();
  if (response.status === 401 && (await refreshSession())) response = await send();
  const payload = await readBody(response);
  if (!response.ok) {
    const error = errorFromBody(response.status, payload, 'Upload failed.');
    if (error.status === 401) notifyExpired();
    throw error;
  }
  return (payload as { success?: boolean; data?: unknown } | undefined)?.data;
}

/** Download an authenticated private file as a blob. */
export async function downloadAuthenticated(path: string): Promise<Blob> {
  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { Accept: '*/*' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    return fetch(buildUrl(path), { credentials: 'include', headers });
  };

  let response = await send();
  if (response.status === 401 && (await refreshSession())) response = await send();
  if (!response.ok) {
    const payload = await readBody(response);
    const error = errorFromBody(response.status, payload, 'Download failed.');
    if (error.status === 401) notifyExpired();
    throw error;
  }
  return response.blob();
}

/** Human message for any thrown value, including validation field details. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.details.length > 0) {
      return `${error.message} (${error.details.map((detail) => detail.message).join('; ')})`;
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}
