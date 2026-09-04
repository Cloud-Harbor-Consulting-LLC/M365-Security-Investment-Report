/**
 * The single chokepoint for all Microsoft Graph traffic in the browser.
 *
 * Read-only by construction, exactly as Invoke-CHSIGraphRequest is in PowerShell: this
 * module exposes no way to specify an HTTP method, so there is no code path through
 * which a caller can issue anything but a GET. Auditing the browser's read-only
 * guarantee means auditing this one file, and a test fails the build if any other
 * source file calls fetch() against Graph.
 */

const GRAPH_ORIGIN = 'https://graph.microsoft.com';

export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    readonly uri: string,
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

export interface GraphGetOptions {
  /** Follow @odata.nextLink and return the accumulated `value` array. */
  all?: boolean;
  maxRetry?: number;
  maxPages?: number;
  signal?: AbortSignal;
}

interface GraphPage {
  value?: unknown[];
  '@odata.nextLink'?: string;
  [key: string]: unknown;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

function absolute(uri: string): string {
  if (uri.startsWith('https://')) {
    if (!uri.startsWith(`${GRAPH_ORIGIN}/`)) {
      // Refuse to send a Graph token anywhere else, even if a nextLink says so.
      throw new GraphError(`Refusing to call a non-Graph origin: ${uri}`, 0, 'NonGraphOrigin', uri);
    }
    return uri;
  }
  return `${GRAPH_ORIGIN}${uri.startsWith('/') ? '' : '/'}${uri}`;
}

/**
 * Issues a GET against Microsoft Graph.
 *
 * Handles paging, throttling (429 / 503 with Retry-After) and transient failures with
 * exponential backoff. A 403 is thrown rather than retried, because it means an
 * entitlement is missing — the caller decides whether that degrades the report or ends
 * it, which is how the Entra ID P1 sign-in-activity case is handled.
 */
export async function graphGet<T = unknown>(
  uri: string,
  accessToken: string,
  options: GraphGetOptions = {},
): Promise<T> {
  const { all = false, maxRetry = 5, maxPages = 1000, signal } = options;

  let next: string | null = absolute(uri);
  const collected: unknown[] = [];
  let page = 0;
  let lastBody: GraphPage | null = null;

  while (next) {
    page += 1;
    if (page > maxPages) break;

    let attempt = 0;
    let body: GraphPage;

    for (;;) {
      const response = await fetch(next, {
        // Hardcoded. Do not parameterise: the read-only guarantee is the product.
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          ConsistencyLevel: 'eventual',
        },
        signal,
      });

      if (response.ok) {
        body = (await response.json()) as GraphPage;
        break;
      }

      const transient = response.status === 429 || response.status >= 500;
      if (!transient || attempt >= maxRetry) {
        throw await toGraphError(response, next);
      }

      const retryAfter = Number(response.headers.get('Retry-After'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 300_000)
        : Math.min(2 ** (attempt + 1) * 1000, 60_000);

      attempt += 1;
      await sleep(delay, signal);
    }

    lastBody = body;
    if (!all) return body as T;

    if (Array.isArray(body.value)) collected.push(...body.value);
    next = typeof body['@odata.nextLink'] === 'string' ? absolute(body['@odata.nextLink']) : null;
  }

  return (all ? collected : lastBody) as T;
}

async function toGraphError(response: Response, uri: string): Promise<GraphError> {
  let code: string | null = null;
  let message = response.statusText;

  try {
    const payload = (await response.json()) as { error?: { code?: string; message?: string } };
    code = payload.error?.code ?? null;
    message = payload.error?.message ?? message;
  } catch {
    // A non-JSON error body is not worth failing over; the status carries the meaning.
  }

  return new GraphError(`Graph GET failed with HTTP ${response.status}: ${message}`, response.status, code, uri);
}
