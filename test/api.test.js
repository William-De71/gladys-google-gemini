import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGeminiClient,
  ERROR_KINDS,
  errorMessageOf,
  GeminiError,
  kindOfStatus,
  parseRetryAfter,
  retryDelayOf,
} from '../src/gemini-api.js';
import { API_KEY, googleError, startFakeGemini } from './helpers/fake-gemini.js';

const client = (api, options = {}) => {
  const waits = [];
  const instance = createGeminiClient({
    getApiKey: () => options.key ?? API_KEY,
    baseUrl: api.url,
    sleep: async (ms) => {
      waits.push(ms);
    },
    ...options,
  });
  return { instance, waits };
};

const HI = { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] };

test('sends the key in the x-goog-api-key header, never in the URL', async (t) => {
  const api = await startFakeGemini();
  t.after(api.close);
  const { instance } = client(api);
  const body = await instance.generateContent('gemini-3.8-flash', HI);
  assert.equal(body.candidates[0].content.parts[0].text, 'Bonjour !');
  assert.equal(api.requests[0].apiKey, API_KEY);
  assert.equal(api.requests[0].path, '/v1beta/models/gemini-3.8-flash:generateContent');
  assert.ok(!api.requests[0].path.includes(API_KEY));
  const card = await instance.getModel('gemini-3.5-flash-lite');
  assert.equal(card.name, 'models/gemini-3.5-flash-lite');
  assert.equal(api.requests[1].path, '/v1beta/models/gemini-3.5-flash-lite');
});

test('no key: fails before any request', async (t) => {
  const api = await startFakeGemini();
  t.after(api.close);
  const { instance } = client(api, { key: '' });
  await assert.rejects(
    instance.generateContent('m', HI),
    (err) => err instanceof GeminiError && err.kind === ERROR_KINDS.AUTH,
  );
  assert.equal(api.requests.length, 0);
});

test('HTTP failures become error kinds, the key never in the message', async (t) => {
  const api = await startFakeGemini();
  t.after(api.close);
  const { instance } = client(api, { key: 'AIzaWrongKey0123456789abcdefghijkl' });
  // Google answers a wrong key with a 400, not a 401.
  await assert.rejects(
    instance.generateContent('m', HI),
    (err) =>
      err.kind === ERROR_KINDS.AUTH &&
      /HTTP 400: API key not valid/.test(err.message) &&
      !err.message.includes('AIzaWrong'),
  );
  const good = client(api).instance;
  api.reply('GET model', {
    status: 404,
    body: googleError(404, 'NOT_FOUND', 'models/x is not found'),
  });
  await assert.rejects(good.getModel('x'), (err) => err.kind === ERROR_KINDS.MODEL);
  api.reply('POST generateContent', {
    status: 400,
    body: googleError(400, 'INVALID_ARGUMENT', 'Thinking level MINIMAL is not supported'),
  });
  await assert.rejects(
    good.generateContent('m', HI),
    (err) => err.kind === ERROR_KINDS.REQUEST && /Thinking level/.test(err.message),
  );
  api.reply('POST generateContent', {
    status: 403,
    body: googleError(403, 'PERMISSION_DENIED', 'The free tier is not available for this project'),
  });
  await assert.rejects(good.generateContent('m', HI), (err) => err.kind === ERROR_KINDS.BILLING);
  api.reply('POST generateContent', { status: 200, body: 'not json' });
  await assert.rejects(
    good.generateContent('m', HI, { retries: false }),
    (err) => err.kind === ERROR_KINDS.SERVER,
  );
});

test('429 and 5xx are retried with Retry-After, RetryInfo or backoff, then give up', async (t) => {
  const api = await startFakeGemini();
  t.after(api.close);
  const { instance, waits } = client(api);
  api.reply('POST generateContent', {
    status: 429,
    body: googleError(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded', [
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '2s' },
    ]),
  });
  api.reply('POST generateContent', {
    status: 503,
    body: googleError(503, 'UNAVAILABLE', 'The model is overloaded'),
  });
  const body = await instance.generateContent('m', HI);
  assert.equal(body.candidates[0].content.parts[0].text, 'Bonjour !');
  assert.deepEqual(waits, [2000, 2000]);
  for (let i = 0; i < 3; i += 1) {
    api.reply('POST generateContent', {
      status: 429,
      body: googleError(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded'),
    });
  }
  await assert.rejects(
    instance.generateContent('m', HI),
    (err) => err.kind === ERROR_KINDS.RATE_LIMIT,
  );
  assert.equal(api.requests.length, 6);
  // The connection check never retries.
  api.reply('GET model', { status: 503, body: googleError(503, 'UNAVAILABLE', 'busy') });
  await assert.rejects(instance.getModel('x'), (err) => err.kind === ERROR_KINDS.SERVER);
  assert.equal(api.requests.length, 7);
});

test('a wait that would not fit in the deadline fails at once with the real reason', async (t) => {
  const api = await startFakeGemini();
  t.after(api.close);
  const { instance, waits } = client(api);
  api.reply('POST generateContent', {
    status: 429,
    body: googleError(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded for requests per day', [
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37s' },
    ]),
  });
  await assert.rejects(
    instance.generateContent('m', HI, { timeoutMs: 18_000 }),
    (err) => err.kind === ERROR_KINDS.RATE_LIMIT,
  );
  assert.deepEqual(waits, []);
});

test('an unreachable API and a timeout are named as such', async () => {
  const unreachable = createGeminiClient({
    getApiKey: () => 'k',
    baseUrl: 'http://127.0.0.1:9/v1beta',
    sleep: async () => {},
  });
  await assert.rejects(
    unreachable.generateContent('m', HI, { retries: false }),
    (err) => err.kind === ERROR_KINDS.UNREACHABLE,
  );
  const slow = createGeminiClient({
    getApiKey: () => 'k',
    fetchImpl: (url, { signal }) =>
      new Promise((resolve, reject) =>
        signal.addEventListener('abort', () => reject(signal.reason)),
      ),
  });
  // AbortSignal.timeout does not keep the process alive: this timer does.
  const hold = setTimeout(() => {}, 1000);
  await assert.rejects(
    slow.generateContent('m', HI, { timeoutMs: 50, retries: false }),
    (err) => err.kind === ERROR_KINDS.TIMEOUT,
  );
  clearTimeout(hold);
});

test('error bodies, Retry-After and RetryInfo are read safely', () => {
  assert.equal(
    errorMessageOf({ error: { message: 'key AIzaSyA0123456789abcdefghijklmnop refused' } }),
    'key *** refused',
  );
  assert.equal(
    errorMessageOf({ error: { message: 'GET /x?key=secret&y=1' } }),
    'GET /x?key=***&y=1',
  );
  assert.equal(errorMessageOf('x'.repeat(500)).length, 300);
  assert.equal(parseRetryAfter('3'), 3000);
  assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 4000), 6000);
  assert.equal(parseRetryAfter('soon'), null);
  assert.equal(retryDelayOf({ error: { details: [{ retryDelay: '0.5s' }] } }), 500);
  assert.equal(retryDelayOf({ error: {} }), null);
  assert.equal(kindOfStatus(402), ERROR_KINDS.BILLING);
  assert.equal(
    kindOfStatus(403, googleError(403, 'PERMISSION_DENIED', 'denied')),
    ERROR_KINDS.AUTH,
  );
  assert.equal(kindOfStatus(429), ERROR_KINDS.RATE_LIMIT);
  assert.equal(kindOfStatus(500), ERROR_KINDS.SERVER);
});
