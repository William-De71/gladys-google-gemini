import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { TRIGGERS } from '../src/events.js';
import { ACTIONS } from '../src/app.js';
import { WIDGETS } from '../src/widgets.js';
import {
  CUSTOM_MODEL,
  DEFAULT_CONFIG,
  MAX_TOKENS_MAX,
  MAX_TOKENS_MIN,
  MODELS,
  THINKING_LEVELS,
} from '../src/config.js';
import { ERROR_KINDS } from '../src/gemini-api.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const manifest = read('../gladys-assistant-integration.json');
const pkg = read('../package.json');
const byKey = (list) => new Map(list.map((entry) => [entry.key, entry]));
const values = (field) => field.options.map((option) => option.value);
const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const REPO = 'William-De71/gladys-google-gemini';

test('an AI provider, in lockstep with package.json, at 0.x until 1.0.0 is decided', () => {
  assert.equal(manifest.type, 'ai');
  assert.equal(manifest.name, 'Google Gemini');
  assert.equal(manifest.version, pkg.version);
  assert.match(pkg.version, /^0\./);
  assert.equal(manifest.docker_image, `ghcr.io/william-de71/gladys-google-gemini:${pkg.version}`);
  assert.equal(manifest.cover_image, `https://raw.githubusercontent.com/${REPO}/main/cover.jpg`);
  assert.equal(pkg.license, 'Apache-2.0');
  assert.equal(pkg.name, 'gladys-google-gemini');
  assert.deepEqual(Object.keys(pkg.dependencies), ['@gladysassistant/integration-sdk']);
});

test('declares the cloud transport: the Gemini API only, one module talks to it', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.match(
    source('../src/gemini-api.js'),
    /https:\/\/generativelanguage\.googleapis\.com\/v1beta/,
  );
  for (const file of [
    'app',
    'chat',
    'convert',
    'events',
    'widgets',
    'usage',
    'connection',
    'config',
    'time',
  ]) {
    assert.doesNotMatch(
      source(`../src/${file}.js`),
      /fetch\(|node:https?|node:net|node:dgram/,
      file,
    );
  }
  assert.doesNotMatch(source('../src/app.js'), /publishTransports|GLADYS_PREFER_LOCAL/);
});

test('requires Gladys 5.3.0 (type ai), sits on the assistants shelf, asks no permission', () => {
  assert.equal(manifest.gladys_version, '>=5.3.0');
  assert.deepEqual(manifest.categories, ['assistants']);
  for (const key of [
    'location',
    'network_wake',
    'containers',
    'network_discovery',
    'webhooks',
    'messaging',
    'energy_contracts',
    'music',
  ]) {
    assert.equal(manifest[key], undefined, key);
  }
});

test('the configuration matches the code: keys, model ids, defaults, bounds', () => {
  const config = byKey(manifest.config_schema);
  assert.equal(config.get('api_key').type, 'secret');
  assert.equal(config.get('api_key').required, true);
  for (const key of ['model', 'fast_model']) {
    const field = config.get(key);
    assert.equal(field.type, 'select');
    assert.equal(field.default, DEFAULT_CONFIG[key]);
    for (const value of values(field)) {
      assert.ok(value === CUSTOM_MODEL || value in MODELS, `${key}: ${value}`);
    }
    assert.ok(values(field).includes(CUSTOM_MODEL), key);
  }
  // Every model is offered for the chat; the router leaves out 4 Argon
  // (paid only, and too slow for a 20 s deadline).
  assert.deepEqual(
    new Set(values(config.get('model'))),
    new Set([...Object.keys(MODELS), CUSTOM_MODEL]),
  );
  assert.ok(!values(config.get('fast_model')).includes('gemini-4-argon'));
  assert.equal(config.get('custom_model').type, 'string');
  assert.deepEqual(values(config.get('thinking')), THINKING_LEVELS);
  assert.equal(config.get('thinking').default, DEFAULT_CONFIG.thinking);
  const maxTokens = config.get('max_tokens');
  assert.deepEqual(
    [maxTokens.min, maxTokens.max, maxTokens.default],
    [MAX_TOKENS_MIN, MAX_TOKENS_MAX, DEFAULT_CONFIG.max_tokens],
  );
  for (const field of manifest.config_schema) {
    assert.ok(!['text', 'password'].includes(field.type), `${field.key}: string / secret only`);
    assert.equal(field.display_if, undefined, field.key);
  }
});

test('declares exactly the button, widget and triggers the code handles, no scene action', () => {
  const app = source('../src/app.js');
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    Object.values(ACTIONS),
  );
  assert.match(app, /onAction\(ACTIONS\.TEST_CONNECTION/);
  assert.deepEqual(
    manifest.widgets.map((w) => w.key),
    Object.values(WIDGETS),
  );
  assert.match(app, /onWidgetGet\(WIDGETS\.USAGE/);
  assert.doesNotMatch(app, /onWidgetAction/, 'the only button is a link');
  assert.deepEqual(
    manifest.scene_triggers.map((t) => t.key),
    Object.values(TRIGGERS),
  );
  // No web search action: the terms of Grounding with Google Search require
  // showing the Search Suggestions with the answer, which a scene cannot do.
  assert.equal(manifest.scene_actions, undefined);
  assert.doesNotMatch(app, /onSceneAction|googleSearch/);
  assert.match(app, /onAiChat\(/);
  // Every trigger field is a variable of the event (the core compares them).
  for (const trigger of manifest.scene_triggers) {
    for (const field of trigger.fields ?? []) {
      assert.ok(
        trigger.variables.some((variable) => variable.key === field.key),
        `${trigger.key}.${field.key}`,
      );
    }
  }
  // The kinds offered as a filter are kinds the code emits (a refused request emits nothing).
  const kinds = values(byKey(byKey(manifest.scene_triggers).get('error').fields).get('kind'));
  assert.deepEqual(
    new Set(kinds),
    new Set(Object.values(ERROR_KINDS).filter((kind) => kind !== 'request')),
  );
});

test('limits of the store: counts, timeouts, sizes, no secret in widget settings', () => {
  assert.ok(manifest.actions.length <= 10);
  assert.ok(manifest.widgets.length >= 1 && manifest.widgets.length <= 5);
  assert.ok(manifest.scene_triggers.length <= 20);
  for (const action of manifest.actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120, action.key);
  }
  const size = statSync(new URL('../gladys-assistant-integration.json', import.meta.url)).size;
  assert.ok(size < 100 * 1024, `${size} bytes`);
  const cover = readFileSync(new URL('../cover.jpg', import.meta.url));
  assert.ok(cover.length < 150 * 1024, `cover.jpg: ${cover.length} bytes`);
  assert.equal(cover.readUInt16BE(0), 0xffd8, 'cover.jpg is a JPEG');
});

test('catalog of Gladys 5.3.0: search keywords within the store bounds, worldwide', () => {
  const { keywords } = manifest;
  assert.ok(Array.isArray(keywords) && keywords.length >= 1 && keywords.length <= 10);
  const normalized = keywords.map((keyword) => keyword.trim().toLowerCase());
  for (const keyword of normalized) {
    assert.ok(keyword.length >= 2 && keyword.length <= 30, keyword);
  }
  assert.equal(new Set(normalized).size, normalized.length, 'unique once trimmed and lowercased');
  assert.ok(!normalized.includes(manifest.name.toLowerCase()), 'never the name itself');
  assert.equal(manifest.countries, undefined, 'usable worldwide: no country list');
});
