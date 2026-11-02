import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  modelName,
  normalizeConfig,
  resolveModel,
  thinkingLevelFor,
} from '../src/config.js';

test('defaults fill an empty or broken configuration', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
  const config = normalizeConfig({
    api_key: '  abc  ',
    model: 'gpt-5',
    fast_model: 'custom',
    custom_model: 'bad id with spaces',
    thinking: 'max',
    max_tokens: '999999',
  });
  assert.equal(config.api_key, 'abc');
  assert.equal(config.model, 'gemini-3.8-flash', 'an unknown model falls back');
  assert.equal(config.fast_model, 'custom');
  assert.equal(config.custom_model, '', 'an id that cannot be a model id is ignored');
  assert.equal(config.thinking, 'medium');
  assert.equal(config.max_tokens, 65536);
  assert.equal(normalizeConfig({ max_tokens: 'x' }).max_tokens, 16000);
  assert.equal(normalizeConfig({ max_tokens: 10 }).max_tokens, 2048);
});

test('a select set to "custom" calls the custom id, null when it is empty', () => {
  const config = normalizeConfig({
    model: 'custom',
    custom_model: 'models/gemini-3.1-pro-preview',
  });
  assert.equal(
    resolveModel(config, 'model'),
    'gemini-3.1-pro-preview',
    'the resource prefix is dropped',
  );
  assert.equal(resolveModel(config, 'fast_model'), 'gemini-3.5-flash-lite');
  assert.equal(resolveModel(normalizeConfig({ model: 'custom' }), 'model'), null);
  assert.equal(modelName('gemini-3.8-flash'), 'Gemini 3.8 Flash');
  assert.equal(modelName('gemini-3.1-pro-preview'), 'gemini-3.1-pro-preview');
});

test('thinkingLevel: only values each model accepts, in the casing of the API', () => {
  // 3.8 Flash and 4 Argon: low / medium / high, minimal refused.
  for (const id of ['gemini-3.8-flash', 'gemini-4-argon']) {
    assert.deepEqual(
      ['minimal', 'low', 'medium', 'high'].map((level) => thinkingLevelFor(id, level)),
      ['LOW', 'LOW', 'MEDIUM', 'HIGH'],
      id,
    );
  }
  // 3.6 Flash and the Flash-Lite models: all four.
  for (const id of ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']) {
    assert.deepEqual(
      ['minimal', 'low', 'medium', 'high'].map((level) => thinkingLevelFor(id, level)),
      ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'],
      id,
    );
  }
  // Custom: as asked, except minimal which is not sent.
  assert.equal(thinkingLevelFor('gemini-3.1-pro-preview', 'medium'), 'MEDIUM');
  assert.equal(thinkingLevelFor('gemini-3.1-pro-preview', 'minimal'), undefined);
});
