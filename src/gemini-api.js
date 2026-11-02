// -----------------------------------------------------------------------------
// Client of the Gemini API (Google AI Studio keys,
// https://generativelanguage.googleapis.com/v1beta).
//
// Plain fetch, no SDK: two endpoints only —
//   - POST /v1beta/models/{id}:generateContent   the assistant (convert.js)
//   - GET  /v1beta/models/{id}                   the connection check (no token)
//
// The key travels in the `x-goog-api-key` header, never in the URL (an URL
// ends up in logs). Every call runs under a deadline. A 429 (rate limit of
// the tier, spend limit) or a 5xx is retried while the deadline leaves room
// for it, honouring Retry-After and the `RetryInfo` detail of Google errors;
// anything else fails at once with a GeminiError that says what went wrong
// without echoing the key.
// -----------------------------------------------------------------------------

export const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/** The error kinds, also the `kind` variable of the `error` scene trigger. */
export const ERROR_KINDS = {
  AUTH: 'auth',
  BILLING: 'billing',
  MODEL: 'model',
  RATE_LIMIT: 'rate_limit',
  REQUEST: 'request',
  SERVER: 'server',
  UNREACHABLE: 'unreachable',
  TIMEOUT: 'timeout',
};

const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 8000;
const MAX_ATTEMPTS = 3;

export class GeminiError extends Error {
  /**
   * @param {string} kind - One of ERROR_KINDS.
   * @param {string} message - What went wrong (never the key).
   * @param {object} [details] - `{ status, retryAfterMs }`.
   */
  constructor(kind, message, { status = null, retryAfterMs = null } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * @description The `reason` of the ErrorInfo detail of a Google error body.
 * @param {unknown} body - The parsed body.
 * @returns {string} `API_KEY_INVALID`…, or ''.
 */
function reasonOf(body) {
  const details = Array.isArray(body?.error?.details) ? body.error.details : [];
  const info = details.find((detail) => typeof detail?.reason === 'string');
  return info?.reason ?? '';
}

/**
 * @description The kind of an HTTP failure. Google answers a wrong key with a
 * 400 (`INVALID_ARGUMENT`, reason `API_KEY_INVALID`), not a 401.
 * @param {number} status - The HTTP status.
 * @param {unknown} [body] - The parsed body.
 * @returns {string} One of ERROR_KINDS.
 */
export function kindOfStatus(status, body = null) {
  const reason = reasonOf(body);
  const message = String(body?.error?.message ?? '');
  if (
    status === 401 ||
    reason === 'API_KEY_INVALID' ||
    reason === 'API_KEY_SERVICE_BLOCKED' ||
    /API key (not valid|expired|was reported as leaked)/i.test(message)
  ) {
    return ERROR_KINDS.AUTH;
  }
  if (status === 402 || /billing|payment|prepay|free tier is not available/i.test(message)) {
    return ERROR_KINDS.BILLING;
  }
  if (status === 403) {
    return ERROR_KINDS.AUTH;
  }
  if (status === 404) {
    return ERROR_KINDS.MODEL;
  }
  if (status === 429) {
    return ERROR_KINDS.RATE_LIMIT;
  }
  if (status >= 500) {
    return ERROR_KINDS.SERVER;
  }
  return ERROR_KINDS.REQUEST;
}

/**
 * @description The message of an error body, short and without secrets.
 * @param {unknown} body - The parsed body, or the raw text.
 * @returns {string} The message.
 */
export function errorMessageOf(body) {
  let message = '';
  if (typeof body === 'string') {
    message = body;
  } else if (body && typeof body === 'object') {
    const candidate = body.error?.message ?? body.message ?? body.error;
    if (typeof candidate === 'string') {
      message = candidate;
    } else if (candidate !== undefined) {
      message = JSON.stringify(candidate);
    }
  }
  return message
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '***')
    .replace(/([?&]key=)[^&\s]+/gi, '$1***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/**
 * @description Milliseconds asked by a Retry-After header.
 * @param {string|null} value - The header.
 * @param {number} now - Now (ms).
 * @returns {number|null} Milliseconds, null when absent or unreadable.
 */
export function parseRetryAfter(value, now = Date.now()) {
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/**
 * @description Milliseconds asked by the RetryInfo detail of a Google error
 * (`"retryDelay": "37s"` or `"0.5s"`).
 * @param {unknown} body - The parsed body.
 * @returns {number|null} Milliseconds, null when absent.
 */
export function retryDelayOf(body) {
  const details = Array.isArray(body?.error?.details) ? body.error.details : [];
  for (const detail of details) {
    const match = /^(\d+(?:\.\d+)?)s$/.exec(String(detail?.retryDelay ?? ''));
    if (match) {
      return Math.round(Number(match[1]) * 1000);
    }
  }
  return null;
}

/**
 * @description Build a client.
 * @param {object} options - Options.
 * @param {() => string} options.getApiKey - The current API key.
 * @param {string} [options.baseUrl] - The API root (tests point it to a fake).
 * @param {typeof fetch} [options.fetchImpl] - fetch.
 * @param {(ms: number) => Promise<void>} [options.sleep] - Waiting (tests skip it).
 * @param {() => number} [options.now] - Clock.
 * @returns {object} `{ generateContent, getModel }`.
 */
export function createGeminiClient({
  getApiKey,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
}) {
  const root = baseUrl.replace(/\/+$/, '');

  /**
   * @description One HTTP call, retried on 429 / 5xx / network while the
   * deadline allows.
   * @param {string} method - GET or POST.
   * @param {string} path - Path under /v1beta.
   * @param {object} [options] - `{ body, timeoutMs, retries }`.
   * @returns {Promise<object>} The parsed JSON body.
   */
  async function request(method, path, { body, timeoutMs = 30_000, retries = true } = {}) {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new GeminiError(ERROR_KINDS.AUTH, 'No Gemini API key in the configuration');
    }
    const deadline = now() + timeoutMs;
    let lastError = null;
    for (let attempt = 1; attempt <= (retries ? MAX_ATTEMPTS : 1); attempt += 1) {
      const remaining = deadline - now();
      if (remaining <= 0) {
        break;
      }
      try {
        return await once(method, path, body, apiKey, remaining);
      } catch (err) {
        lastError = err;
        const retryable =
          err.kind === ERROR_KINDS.RATE_LIMIT ||
          err.kind === ERROR_KINDS.SERVER ||
          err.kind === ERROR_KINDS.UNREACHABLE;
        if (!retryable || !retries || attempt === MAX_ATTEMPTS) {
          throw err;
        }
        const wait = err.retryAfterMs ?? RETRY_BASE_MS * 2 ** (attempt - 1);
        // A long wait asked by Google (a daily quota spent, a minute window
        // full), or no room left for the wait and a useful answer: fail now,
        // with the real reason, rather than later with a timeout.
        if (wait > RETRY_MAX_MS || now() + wait + 1000 >= deadline) {
          throw err;
        }
        await sleep(wait);
      }
    }
    throw (
      lastError ??
      new GeminiError(ERROR_KINDS.TIMEOUT, `No answer within ${Math.round(timeoutMs / 1000)} s`)
    );
  }

  async function once(method, path, body, apiKey, timeoutMs) {
    let response;
    try {
      response = await fetchImpl(`${root}${path}`, {
        method,
        headers: {
          'x-goog-api-key': apiKey,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new GeminiError(
          ERROR_KINDS.TIMEOUT,
          `No answer within ${Math.round(timeoutMs / 1000)} s`,
        );
      }
      throw new GeminiError(
        ERROR_KINDS.UNREACHABLE,
        `Cannot reach the Gemini API (${err?.cause?.code ?? err?.message ?? 'network error'})`,
      );
    }
    const text = await response.text().catch(() => '');
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!response.ok) {
      const message = errorMessageOf(parsed ?? text) || response.statusText || 'error';
      throw new GeminiError(
        kindOfStatus(response.status, parsed),
        `HTTP ${response.status}: ${message}`,
        {
          status: response.status,
          retryAfterMs:
            parseRetryAfter(response.headers.get('retry-after'), now()) ?? retryDelayOf(parsed),
        },
      );
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new GeminiError(
        ERROR_KINDS.SERVER,
        'The Gemini API answered something that is not JSON',
        { status: response.status },
      );
    }
    return parsed;
  }

  return {
    /**
     * @description POST /v1beta/models/{model}:generateContent.
     * @param {string} model - The model id.
     * @param {object} body - A GenerateContentRequest (without `model`).
     * @param {object} [options] - `{ timeoutMs, retries }`.
     * @returns {Promise<object>} The GenerateContentResponse.
     */
    generateContent(model, body, options) {
      return request('POST', `/models/${encodeURIComponent(model)}:generateContent`, {
        ...options,
        body,
      });
    },
    /**
     * @description GET /v1beta/models/{model}: is this model open to the key?
     * It does not prove that generation is allowed (a project without the
     * free tier or with a billing problem still reads model cards).
     * @param {string} model - The model id.
     * @param {object} [options] - `{ timeoutMs }`.
     * @returns {Promise<object>} The model card.
     */
    getModel(model, options) {
      return request('GET', `/models/${encodeURIComponent(model)}`, {
        timeoutMs: 15_000,
        ...options,
        retries: false,
      });
    },
  };
}
