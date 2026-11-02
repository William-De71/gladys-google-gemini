import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AI_CHAT_PURPOSES, validateAiCompletion } from '@gladysassistant/integration-sdk';
import { buildRequest, createChatHandler, useOf } from '../src/chat.js';
import { normalizeConfig } from '../src/config.js';
import { createSignatureStore, SKIP_SIGNATURE } from '../src/convert.js';
import { createGeminiClient, ERROR_KINDS } from '../src/gemini-api.js';
import { API_KEY, generated, googleError, startFakeGemini } from './helpers/fake-gemini.js';

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'device_set_value',
      description: 'Set a value',
      parameters: { type: 'object', properties: {} },
    },
  },
];

const setup = async (t, raw = {}) => {
  const api = await startFakeGemini();
  t.after(api.close);
  const config = normalizeConfig({ api_key: API_KEY, ...raw });
  const client = createGeminiClient({
    getApiKey: () => config.api_key,
    baseUrl: api.url,
    sleep: async () => {},
  });
  const recorded = { success: [], error: [], failures: [], successes: 0 };
  const usage = {
    recordSuccess: (entry) => recorded.success.push(entry),
    recordError: (entry) => recorded.error.push(entry),
  };
  const signatures = createSignatureStore();
  const handler = createChatHandler({
    client,
    getConfig: () => config,
    usage,
    signatures,
    onFailure: (err, context) => recorded.failures.push({ kind: err.kind, ...context }),
    onSuccess: () => {
      recorded.successes += 1;
    },
  });
  return { api, handler, recorded, config, signatures };
};

test('the router gets the fast model at minimal thinking; the chat the main model with tools', async (t) => {
  const { api, handler, recorded } = await setup(t);
  await handler({
    messages: [
      { role: 'system', content: 'Classify' },
      { role: 'user', content: 'Allume' },
    ],
    purpose: AI_CHAT_PURPOSES.INTENT_CLASSIFICATION,
  });
  const router = api.requests[0];
  assert.equal(router.model, 'gemini-3.5-flash-lite');
  assert.deepEqual(router.body.generationConfig.thinkingConfig, { thinkingLevel: 'MINIMAL' });
  assert.equal(router.body.tools, undefined);
  assert.deepEqual(router.body.systemInstruction, { parts: [{ text: 'Classify' }] });
  assert.equal(router.body.store, false);

  const answer = await handler({
    messages: [{ role: 'user', content: 'Allume le salon' }],
    tools: TOOLS,
    tool_choice: 'required',
    max_tokens: 2000,
    purpose: AI_CHAT_PURPOSES.CHAT,
    categories: ['devices'],
  });
  const chat = api.requests[1];
  assert.equal(chat.model, 'gemini-3.8-flash');
  assert.deepEqual(chat.body.generationConfig.thinkingConfig, { thinkingLevel: 'MEDIUM' });
  assert.deepEqual(chat.body.toolConfig, { functionCallingConfig: { mode: 'ANY' } });
  assert.equal(chat.body.tools[0].functionDeclarations[0].name, 'device_set_value');
  assert.equal(chat.body.generationConfig.maxOutputTokens, 16000, 'the configured budget');
  assert.equal(chat.body.purpose, undefined);
  assert.equal(chat.body.categories, undefined);
  assert.equal(chat.body.model, undefined, 'the model is in the URL');
  assert.deepEqual(validateAiCompletion(answer), []);
  assert.equal(answer.gemini_finish, undefined, 'internal fields stay inside');
  assert.deepEqual(
    recorded.success.map((entry) => entry.use),
    ['router', 'chat'],
  );
  assert.equal(recorded.successes, 2);
});

test('a router on 3.8 Flash gets low thinking, which it accepts (never minimal)', () => {
  const { body } = buildRequest(
    { messages: [{ role: 'user', content: 'x' }], purpose: AI_CHAT_PURPOSES.INTENT_CLASSIFICATION },
    normalizeConfig({ api_key: 'k', fast_model: 'gemini-3.8-flash' }),
  );
  assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingLevel: 'LOW' });
});

test('the purposes are counted as router, digest or chat', () => {
  assert.equal(useOf(AI_CHAT_PURPOSES.INTENT_CLASSIFICATION), 'router');
  assert.equal(useOf(AI_CHAT_PURPOSES.WEEKLY_DIGEST), 'digest');
  assert.equal(useOf(AI_CHAT_PURPOSES.CHAT), 'chat');
  assert.equal(useOf(undefined), 'chat');
});

test('no tools: neither tools nor toolConfig is sent; no message at all is refused', () => {
  const { body } = buildRequest(
    { messages: [{ role: 'user', content: 'x' }], tools: [], tool_choice: 'auto' },
    normalizeConfig({ api_key: 'k' }),
  );
  assert.equal(body.tools, undefined);
  assert.equal(body.toolConfig, undefined);
  assert.throws(
    () => buildRequest({ messages: [] }, normalizeConfig({ api_key: 'k' })),
    (err) => err.kind === ERROR_KINDS.REQUEST,
  );
});

test('the signature of a tool call comes back when the core sends the turn again', async (t) => {
  const { api, handler } = await setup(t);
  api.reply('POST generateContent', {
    status: 200,
    body: generated(
      [
        {
          functionCall: { id: 'fc-1', name: 'device_set_value', args: { value: 1 } },
          thoughtSignature: 'SIG-A',
        },
      ],
      { finishReason: 'STOP' },
    ),
  });
  const first = await handler({
    messages: [{ role: 'user', content: 'Allume' }],
    tools: TOOLS,
    purpose: 'chat',
  });
  const call = first.choices[0].message.tool_calls[0];
  assert.equal(call.id, 'fc-1');
  assert.equal(call.function.arguments, '{"value":1}');
  assert.equal(first.choices[0].finish_reason, 'tool_calls');

  await handler({
    messages: [
      { role: 'user', content: 'Allume' },
      { role: 'assistant', content: null, tool_calls: [call] },
      { role: 'tool', tool_call_id: 'fc-1', content: 'done' },
    ],
    tools: TOOLS,
    purpose: 'chat',
  });
  const { contents } = api.requests[1].body;
  assert.deepEqual(contents[1], {
    role: 'model',
    parts: [
      {
        functionCall: { id: 'fc-1', name: 'device_set_value', args: { value: 1 } },
        thoughtSignature: 'SIG-A',
      },
    ],
  });
  assert.deepEqual(contents[2].parts[0].functionResponse, {
    id: 'fc-1',
    name: 'device_set_value',
    response: { result: 'done' },
  });
});

test('a tool call the integration never saw gets the documented skip signature', async (t) => {
  const { api, handler } = await setup(t);
  await handler({
    messages: [
      { role: 'user', content: 'Allume' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'other-provider-1', type: 'function', function: { name: 'a', arguments: '{}' } },
          { id: 'other-provider-2', type: 'function', function: { name: 'b', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'other-provider-1', content: 'ok' },
      { role: 'tool', tool_call_id: 'other-provider-2', content: 'ok' },
    ],
    purpose: 'chat',
  });
  const [, model, results] = api.requests[0].body.contents;
  assert.equal(model.parts[0].thoughtSignature, SKIP_SIGNATURE);
  assert.equal(model.parts[1].thoughtSignature, undefined, 'only the first call is signed');
  assert.deepEqual(
    results.parts.map((part) => part.functionResponse.name),
    ['a', 'b'],
  );
});

test('a custom model that refuses the thinking level is asked again without it, then never', async (t) => {
  const { api, handler } = await setup(t, { model: 'custom', custom_model: 'gemma-4-27b-it' });
  api.reply('POST generateContent', {
    status: 400,
    body: googleError(400, 'INVALID_ARGUMENT', 'Thinking is not supported for this model.'),
  });
  const answer = await handler({
    messages: [{ role: 'user', content: 'Bonjour' }],
    purpose: 'chat',
  });
  assert.equal(answer.choices[0].message.content, 'Bonjour !');
  assert.deepEqual(api.requests[0].body.generationConfig.thinkingConfig, {
    thinkingLevel: 'MEDIUM',
  });
  assert.equal(api.requests[1].body.generationConfig.thinkingConfig, undefined);
  await handler({ messages: [{ role: 'user', content: 'Encore' }], purpose: 'chat' });
  assert.equal(api.requests[2].body.generationConfig.thinkingConfig, undefined);
});

test('a malformed function call is asked again once', async (t) => {
  const { api, handler } = await setup(t);
  api.reply('POST generateContent', {
    status: 200,
    body: generated([], { finishReason: 'MALFORMED_FUNCTION_CALL' }),
  });
  const answer = await handler({ messages: [{ role: 'user', content: 'x' }], purpose: 'chat' });
  assert.equal(answer.choices[0].message.content, 'Bonjour !');
  assert.equal(api.requests.length, 2);

  for (let i = 0; i < 2; i += 1) {
    api.reply('POST generateContent', {
      status: 200,
      body: generated([], { finishReason: 'MALFORMED_FUNCTION_CALL' }),
    });
  }
  await assert.rejects(
    handler({ messages: [{ role: 'user', content: 'x' }], purpose: 'chat' }),
    (err) => err.kind === ERROR_KINDS.REQUEST && /MALFORMED_FUNCTION_CALL/.test(err.message),
  );
});

test('failures are thrown (the core names them), counted and reported once each', async (t) => {
  const { api, handler, recorded } = await setup(t);
  api.reply('POST generateContent', {
    status: 429,
    body: googleError(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded', [{ retryDelay: '60s' }]),
  });
  await assert.rejects(
    handler({ messages: [{ role: 'user', content: 'x' }], purpose: 'chat' }),
    (err) => err.kind === ERROR_KINDS.RATE_LIMIT,
  );
  assert.deepEqual(recorded.failures, [
    { kind: 'rate_limit', use: 'chat', model: 'gemini-3.8-flash' },
  ]);
  assert.equal(recorded.error[0].kind, 'rate_limit');

  api.reply('POST generateContent', {
    status: 200,
    body: generated([], { promptFeedback: { blockReason: 'SAFETY' } }),
  });
  await assert.rejects(
    handler({
      messages: [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA' } }],
        },
      ],
      purpose: 'chat',
    }),
    /prompt blocked: SAFETY.*carried an image/,
  );
});

test('an answer cut before any text fails clearly; a cut text is still returned', async (t) => {
  const { api, handler } = await setup(t);
  api.reply('POST generateContent', {
    status: 200,
    body: generated([{ text: 'thinking…', thought: true }], { finishReason: 'MAX_TOKENS' }),
  });
  await assert.rejects(
    handler({ messages: [{ role: 'user', content: 'x' }], purpose: 'chat' }),
    /cut at max_tokens/,
  );
  api.reply('POST generateContent', {
    status: 200,
    body: generated([{ text: 'Le début' }], { finishReason: 'MAX_TOKENS' }),
  });
  const answer = await handler({ messages: [{ role: 'user', content: 'x' }], purpose: 'chat' });
  assert.equal(answer.choices[0].message.content, 'Le début');
  assert.equal(answer.choices[0].finish_reason, 'length');
});

test('an answer stopped by the safety filters is a refused request', async (t) => {
  const { api, handler, recorded } = await setup(t);
  api.reply('POST generateContent', {
    status: 200,
    body: generated([], { finishReason: 'SAFETY' }),
  });
  await assert.rejects(
    handler({ messages: [{ role: 'user', content: 'x' }], purpose: 'chat' }),
    (err) => err.kind === ERROR_KINDS.REQUEST && /SAFETY/.test(err.message),
  );
  assert.equal(recorded.failures[0].kind, 'request');
});

test('a custom model without id fails without calling Gemini', async (t) => {
  const { api, handler } = await setup(t, { fast_model: 'custom' });
  await assert.rejects(
    handler({
      messages: [{ role: 'user', content: 'x' }],
      purpose: AI_CHAT_PURPOSES.INTENT_CLASSIFICATION,
    }),
    (err) => err.kind === ERROR_KINDS.MODEL,
  );
  assert.equal(api.requests.length, 0);
});
