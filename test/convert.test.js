import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAiCompletion } from '@gladysassistant/integration-sdk';
import {
  createSignatureStore,
  hasImages,
  SKIP_SIGNATURE,
  textOf,
  toGeminiContents,
  toGeminiToolConfig,
  toGeminiTools,
  toOpenAiCompletion,
  toOpenAiUsage,
} from '../src/convert.js';

test('the messages of a tool-calling turn of the core convert to Gemini turns', () => {
  const { systemInstruction, contents } = toGeminiContents([
    { role: 'system', content: 'You are Gladys.' },
    { role: 'user', content: 'Allume le salon' },
    {
      role: 'assistant',
      content: 'Je regarde.',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'device_set_value', arguments: '{"room":"salon"}' },
        },
        {
          id: 'call_2',
          type: 'function',
          function: { name: 'device_get_state', arguments: { room: 'salon' } },
        },
      ],
    },
    { role: 'tool', tool_call_id: 'call_1', content: 'ok' },
    { role: 'tool', tool_call_id: 'call_2', content: [{ type: 'text', text: '{"on":true}' }] },
    { role: 'tool', tool_call_id: 'unknown', content: 'Unknown tool: x' },
    { role: 'user', content: 'Merci' },
    { role: 'function', content: 'legacy' },
  ]);
  assert.deepEqual(systemInstruction, { parts: [{ text: 'You are Gladys.' }] });
  assert.equal(contents.length, 3, 'the tool results and the next user text form one user turn');
  assert.deepEqual(contents[0], { role: 'user', parts: [{ text: 'Allume le salon' }] });
  assert.deepEqual(contents[1].parts, [
    { text: 'Je regarde.' },
    {
      functionCall: { id: 'call_1', name: 'device_set_value', args: { room: 'salon' } },
      thoughtSignature: SKIP_SIGNATURE,
    },
    { functionCall: { id: 'call_2', name: 'device_get_state', args: { room: 'salon' } } },
  ]);
  assert.equal(contents[2].role, 'user');
  assert.deepEqual(contents[2].parts, [
    { functionResponse: { id: 'call_1', name: 'device_set_value', response: { result: 'ok' } } },
    {
      functionResponse: {
        id: 'call_2',
        name: 'device_get_state',
        response: { result: '{"on":true}' },
      },
    },
    { functionResponse: { name: 'unknown_tool', response: { result: 'Unknown tool: x' } } },
    { text: 'Merci' },
  ]);
});

test('images: data URLs become inline data, an empty message no turn', () => {
  const { contents } = toGeminiContents([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Qui est à la porte ?' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/AA==' } },
        { type: 'image_url', image_url: 'https://example.com/a.jpg' },
      ],
    },
    { role: 'user', content: '' },
  ]);
  assert.deepEqual(contents, [
    {
      role: 'user',
      parts: [
        { text: 'Qui est à la porte ?' },
        { inlineData: { mimeType: 'image/jpeg', data: '/9j/AA==' } },
        { text: '[Image: https://example.com/a.jpg]' },
      ],
    },
  ]);
  assert.equal(hasImages([{ role: 'user', content: [{ type: 'image_url' }] }]), true);
  assert.equal(hasImages([{ role: 'user', content: 'x' }]), false);
});

test('unreadable tool arguments become an empty object, never a crash', () => {
  const { contents } = toGeminiContents([
    { role: 'user', content: 'x' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c', type: 'function', function: { name: 'a', arguments: '{oops' } }],
    },
  ]);
  assert.deepEqual(contents[1].parts[0].functionCall.args, {});
});

test('signatures: remembered from an answer, put back on the same call and text', () => {
  const signatures = createSignatureStore();
  const completion = toOpenAiCompletion(
    {
      candidates: [
        {
          content: {
            parts: [
              { text: 'reasoning', thought: true },
              { text: 'Je lance.', thoughtSignature: 'SIG-TEXT' },
              { functionCall: { name: 'a', args: {} }, thoughtSignature: 'SIG-1' },
              { functionCall: { name: 'b', args: { x: 2 } } },
            ],
          },
          finishReason: 'STOP',
        },
      ],
      responseId: 'r-1',
    },
    { signatures },
  );
  const message = completion.choices[0].message;
  assert.equal(message.content, 'Je lance.');
  assert.equal(message.tool_calls.length, 2);
  assert.match(
    message.tool_calls[0].id,
    /^call_[0-9a-f]{24}$/,
    'an id is made when Gemini gives none',
  );
  assert.notEqual(message.tool_calls[0].id, message.tool_calls[1].id);
  assert.deepEqual(validateAiCompletion(completion), []);

  const { contents } = toGeminiContents(
    [
      { role: 'user', content: 'x' },
      { role: 'assistant', ...message },
    ],
    signatures,
  );
  assert.deepEqual(
    contents[1].parts.map((part) => part.thoughtSignature),
    ['SIG-TEXT', 'SIG-1', undefined],
  );
});

test('the signature store is bounded and forgets old entries', () => {
  let now = 0;
  const store = createSignatureStore({ max: 2, ttlMs: 1000, now: () => now });
  store.remember('a', 'A');
  store.remember('b', 'B');
  store.remember('c', 'C');
  assert.equal(store.size(), 2);
  assert.equal(store.recall('a'), undefined);
  assert.equal(store.recall('c'), 'C');
  store.remember('d', undefined);
  assert.equal(store.size(), 2);
  now = 2000;
  assert.equal(store.recall('c'), undefined);
});

test('tools: JSON Schema kept as parametersJsonSchema, a description always set', () => {
  const schema = {
    type: 'object',
    properties: { room: { type: 'string', enum: ['salon'] } },
    required: ['room'],
    additionalProperties: false,
  };
  assert.deepEqual(
    toGeminiTools([
      { type: 'function', function: { name: 'a', description: 'Do A', parameters: schema } },
      { type: 'function', function: { name: 'b' } },
      { type: 'other' },
    ]),
    [
      {
        functionDeclarations: [
          { name: 'a', description: 'Do A', parametersJsonSchema: schema },
          { name: 'b', description: 'b' },
        ],
      },
    ],
  );
  assert.deepEqual(toGeminiTools([]), []);
  assert.deepEqual(toGeminiTools(undefined), []);
});

test('tool_choice: required is ANY, a named function is allowed alone', () => {
  assert.deepEqual(toGeminiToolConfig('required'), { functionCallingConfig: { mode: 'ANY' } });
  assert.deepEqual(toGeminiToolConfig('auto'), { functionCallingConfig: { mode: 'AUTO' } });
  assert.deepEqual(toGeminiToolConfig('none'), { functionCallingConfig: { mode: 'NONE' } });
  assert.deepEqual(toGeminiToolConfig({ type: 'function', function: { name: 'x' } }), {
    functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['x'] },
  });
  assert.equal(toGeminiToolConfig(undefined), undefined);
});

test('answers: finish reasons, bounds of the core, usage with thinking as output', () => {
  const many = Array.from({ length: 25 }, (_, i) => ({
    functionCall: { id: `id-${i}`, name: i === 0 ? 'bad name!' : 'tool', args: {} },
  }));
  const completion = toOpenAiCompletion({
    candidates: [{ content: { parts: many }, finishReason: 'STOP' }],
    usageMetadata: {
      promptTokenCount: 100,
      toolUsePromptTokenCount: 10,
      candidatesTokenCount: 20,
      thoughtsTokenCount: 30,
      totalTokenCount: 160,
    },
  });
  assert.equal(completion.choices[0].message.tool_calls.length, 20);
  assert.equal(completion.choices[0].message.content, null);
  assert.deepEqual(validateAiCompletion(completion), []);
  assert.deepEqual(completion.usage, {
    prompt_tokens: 110,
    completion_tokens: 50,
    total_tokens: 160,
  });

  const cut = toOpenAiCompletion({
    candidates: [{ content: { parts: [{ text: 'a' }] }, finishReason: 'MAX_TOKENS' }],
  });
  assert.equal(cut.choices[0].finish_reason, 'length');
  const filtered = toOpenAiCompletion({ candidates: [{ finishReason: 'RECITATION' }] });
  assert.equal(filtered.choices[0].finish_reason, 'content_filter');
  assert.equal(filtered.choices[0].message.content, '');
  assert.equal(filtered.gemini_finish, 'RECITATION');
  assert.throws(() => toOpenAiCompletion({}), /no answer/);
  assert.throws(
    () => toOpenAiCompletion({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }),
    /prompt blocked: PROHIBITED_CONTENT/,
  );
  assert.deepEqual(toOpenAiUsage(undefined), {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  });
});

test('textOf reads strings and text parts', () => {
  assert.equal(textOf('a'), 'a');
  assert.equal(textOf([{ type: 'text', text: 'a' }, 'b', { type: 'image_url' }]), 'ab');
  assert.equal(textOf(null), '');
});
