// -----------------------------------------------------------------------------
// A fake Gemini API on 127.0.0.1, for the tests: real HTTP, no network.
//
// Every request is recorded (`requests`); the answer of each route comes from
// a queue of handlers (`reply(route, handler)`), or a default one. A handler
// returns `{ status, body, headers }`. The fixtures follow the REST reference
// of generateContent and models.get (aistudio.google.com/api-reference,
// checked 2026-11-02): they are not captured from the real API.
//
// `node --test` also runs this file: nothing starts on import.
// -----------------------------------------------------------------------------

import { createServer } from 'node:http';

export const API_KEY = 'AIzaTestGeminiKey0123456789abcdefghij';

/**
 * @description A GenerateContentResponse.
 * @param {Array<object>} [parts] - The parts of the answer.
 * @param {object} [extra] - `{ finishReason, usageMetadata, promptFeedback }`.
 * @returns {object} The body.
 */
export function generated(parts = [{ text: 'Bonjour !' }], extra = {}) {
  const body = {
    candidates: [
      {
        index: 0,
        content: { role: 'model', parts },
        finishReason: extra.finishReason ?? 'STOP',
      },
    ],
    usageMetadata: extra.usageMetadata ?? {
      promptTokenCount: 1200,
      candidatesTokenCount: 50,
      thoughtsTokenCount: 30,
      totalTokenCount: 1280,
    },
    modelVersion: 'gemini-3.8-flash',
    responseId: extra.responseId ?? 'resp-0193',
  };
  if (extra.promptFeedback) {
    body.promptFeedback = extra.promptFeedback;
    delete body.candidates;
  }
  return body;
}

/**
 * @description A Google error body.
 * @param {number} code - The HTTP status.
 * @param {string} status - `INVALID_ARGUMENT`, `RESOURCE_EXHAUSTED`…
 * @param {string} message - The message.
 * @param {Array<object>} [details] - The details.
 * @returns {object} The body.
 */
export function googleError(code, status, message, details = []) {
  return { error: { code, message, status, details } };
}

const MODEL_CARD = (id) => ({
  name: `models/${id}`,
  baseModelId: id,
  version: '001',
  displayName: id,
  inputTokenLimit: 1048576,
  outputTokenLimit: 65536,
  supportedGenerationMethods: ['generateContent', 'countTokens'],
  thinking: true,
});

/**
 * @description Start the fake API.
 * @returns {Promise<object>} `{ url, requests, reply, close }`.
 */
export async function startFakeGemini() {
  const requests = [];
  const queues = new Map();
  const defaults = {
    'POST generateContent': () => ({ status: 200, body: generated() }),
    'GET model': (request) => ({ status: 200, body: MODEL_CARD(request.model) }),
  };

  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const path = decodeURIComponent(req.url);
      const match = /^\/v1beta\/models\/([^/:]+)(:generateContent)?$/.exec(path);
      const route = match
        ? `${req.method} ${match[2] ? 'generateContent' : 'model'}`
        : `${req.method} ${path}`;
      const request = {
        route,
        path,
        model: match?.[1],
        apiKey: req.headers['x-goog-api-key'],
        body: raw ? JSON.parse(raw) : null,
      };
      requests.push(request);
      let answer;
      if (request.apiKey !== API_KEY) {
        answer = {
          status: 400,
          body: googleError(
            400,
            'INVALID_ARGUMENT',
            'API key not valid. Please pass a valid API key.',
            [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }],
          ),
        };
      } else {
        const queue = queues.get(route);
        const handler = queue?.length ? queue.shift() : defaults[route];
        answer = handler
          ? handler(request)
          : { status: 404, body: googleError(404, 'NOT_FOUND', 'Not found') };
      }
      res.writeHead(answer.status, {
        'Content-Type': 'application/json',
        ...(answer.headers ?? {}),
      });
      res.end(typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}/v1beta`,
    requests,
    /**
     * @description Queue the answer of the next request of a route.
     * @param {string} route - "POST generateContent" or "GET model".
     * @param {Function|object} handler - `(request) => answer`, or the answer.
     */
    reply(route, handler) {
      if (!queues.has(route)) {
        queues.set(route, []);
      }
      queues.get(route).push(typeof handler === 'function' ? handler : () => handler);
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
