import { ApiError, type ApiFieldError } from '../errors/api-error';

/** Orval's hook for the error type of the generated hooks: every failure is an ApiError. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Orval passes the error body type.
export type ErrorType<_Body> = ApiError;

export interface ApiClientConfig {
  /** Prepended to every path; empty for same-origin requests. */
  readonly baseUrl: string;
  readonly credentials: RequestCredentials;
  /** Read for every request, so a token or a forwarded header is always current. */
  readonly getHeaders: () => HeadersInit | Promise<HeadersInit>;
  readonly timeoutMs: number;
  readonly fetch: typeof globalThis.fetch;
}

const DEFAULT_CONFIG: ApiClientConfig = {
  baseUrl: '',
  credentials: 'same-origin',
  getHeaders: () => ({}),
  timeoutMs: 20_000,
  // Looked up per call: test tools and polyfills replace the global after this module loads.
  fetch: (input, init) => globalThis.fetch(input, init),
};

let config = DEFAULT_CONFIG;

/** Set once at app start. Options left out go back to their defaults. */
export function configureApiClient(options: Partial<ApiClientConfig>): void {
  config = { ...DEFAULT_CONFIG, ...options };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function fieldErrorsOf(value: unknown): ApiFieldError[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown): ApiFieldError[] => {
    if (!isRecord(item) || typeof item.field !== 'string' || typeof item.code !== 'string') {
      return [];
    }
    const { field, code, params } = item as { field: string; code: string; params?: unknown };
    return [isRecord(params) ? { field, code, params } : { field, code }];
  });
}

/** Any other body than a problem document is not the API talking: a proxy, for example. */
function errorOf(response: Response, text: string): ApiError {
  const requestIdHeader = response.headers.get('x-request-id') ?? undefined;
  const unexpected = new ApiError({
    status: response.status,
    code: 'UNEXPECTED_RESPONSE',
    requestId: requestIdHeader,
  });
  if (!response.headers.get('content-type')?.includes('application/problem+json')) {
    return unexpected;
  }
  let problem: unknown;
  try {
    problem = JSON.parse(text);
  } catch {
    return unexpected;
  }
  if (!isRecord(problem) || typeof problem.code !== 'string') return unexpected;
  const { code, requestId, params, errors } = problem;
  return new ApiError({
    status: response.status,
    code,
    requestId: typeof requestId === 'string' ? requestId : requestIdHeader,
    params: isRecord(params) ? params : undefined,
    fieldErrors: fieldErrorsOf(errors),
  });
}

async function readResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!response.ok) throw errorOf(response, text);
  if (text === '') return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new ApiError({
      status: response.status,
      code: 'UNEXPECTED_RESPONSE',
      requestId: response.headers.get('x-request-id') ?? undefined,
      cause,
    });
  }
}

/**
 * The mutator of the generated client. Resolves with the parsed body, or undefined for an empty
 * one, and throws an ApiError on any failure (05 §1.6). A cancel by the caller stays an abort, so
 * TanStack Query recognises it.
 */
export async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const { baseUrl, credentials, getHeaders, timeoutMs, fetch } = config;
  const headers = new Headers(await getHeaders());
  new Headers(init.headers).forEach((value, name) => {
    headers.set(name, value);
  });

  const controller = new AbortController();
  const timeout = new Error(`The API call took longer than ${String(timeoutMs)} ms`);
  const timer = setTimeout(() => {
    controller.abort(timeout);
  }, timeoutMs);
  const { signal: callerSignal } = init;
  const followCaller = (): void => {
    controller.abort(callerSignal?.reason);
  };
  if (callerSignal?.aborted === true) followCaller();
  callerSignal?.addEventListener('abort', followCaller, { once: true });

  try {
    const response = await fetch(`${baseUrl}${url}`, {
      credentials,
      ...init,
      headers,
      signal: controller.signal,
    });
    return await readResponse<T>(response);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.reason === timeout) {
      throw new ApiError({ status: 0, code: 'TIMEOUT', cause: error });
    }
    if (callerSignal?.aborted === true) throw error;
    throw new ApiError({ status: 0, code: 'NETWORK_ERROR', cause: error });
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', followCaller);
  }
}
