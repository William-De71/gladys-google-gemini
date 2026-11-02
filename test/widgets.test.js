import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from '../src/config.js';
import { LANGUAGES } from '../src/i18n.js';
import { buildUsageWidget, compactTokens } from '../src/widgets.js';

const NOW = Date.UTC(2026, 10, 1, 17, 0, 0);
const day = (date, tokens) => ({ date, tokens });
const snapshot = {
  today_key: '2026-11-01',
  today: { requests: 42, errors: 2, prompt_tokens: 180_000, completion_tokens: 12_400, by_use: {} },
  month: { requests: 42, errors: 2, prompt_tokens: 180_000, completion_tokens: 12_400 },
  days: [day('2026-10-30', 95_000), day('2026-10-31', 240_000), day('2026-11-01', 192_400)],
  last_request: { at: NOW - 120_000, use: 'chat', model: 'gemini-3.8-flash', ms: 6400, ok: true },
  last_error: {
    at: NOW - 3_600_000,
    use: 'router',
    model: 'gemini-3.5-flash-lite',
    kind: 'rate_limit',
    message: 'HTTP 429',
  },
};
const empty = {
  today_key: '2026-11-01',
  today: { requests: 0, errors: 0, prompt_tokens: 0, completion_tokens: 0, by_use: {} },
  month: { requests: 0, errors: 0, prompt_tokens: 0, completion_tokens: 0 },
  days: [],
  last_request: null,
  last_error: null,
};

const budget = (content) => {
  const count = (types) => content.components.filter((c) => types.includes(c.type)).length;
  assert.ok(content.components.length <= 8, `${content.components.length} components`);
  assert.ok(count(['value', 'gauge']) <= 6);
  assert.ok(count(['text']) <= 2);
  assert.ok(count(['chart', 'card-list', 'image']) <= 1);
  assert.ok(count(['status']) <= 1);
  assert.ok(count(['button']) <= 4);
};

test('every state gives a valid content within the budget, in every language', () => {
  const configured = normalizeConfig({ api_key: 'k' });
  const cases = [
    { snapshot, config: configured, failing: null },
    { snapshot, config: configured, failing: { kind: 'auth', since: NOW - 600_000 } },
    { snapshot: empty, config: configured, failing: null },
    { snapshot, config: normalizeConfig(), failing: null },
    {
      snapshot,
      config: normalizeConfig({
        api_key: 'k',
        model: 'custom',
        custom_model: 'gemini-9-preview',
      }),
      failing: null,
    },
  ];
  for (const language of LANGUAGES) {
    for (const options of cases) {
      const content = buildUsageWidget({
        ...options,
        language,
        now: NOW,
        timeZone: 'Europe/Paris',
      });
      assert.deepEqual(validateWidgetContent(content), [], language);
      budget(content);
    }
  }
});

test('the numbers of the day, the chart of the days, the failing state', () => {
  const content = buildUsageWidget({
    snapshot,
    config: normalizeConfig({ api_key: 'k' }),
    failing: { kind: 'rate_limit', since: NOW - 600_000 },
    language: 'fr',
    now: NOW,
    timeZone: 'Europe/Paris',
  });
  const tiles = content.components.filter((c) => c.type === 'value');
  assert.deepEqual(
    tiles.map((tile) => tile.value),
    [42, compactTokens(192_400, 'fr'), compactTokens(192_400, 'fr'), 2],
  );
  assert.equal(tiles[3].color, 'warning');
  const chart = content.components.find((c) => c.type === 'chart');
  assert.equal(chart.series[0].points.length, 3);
  const status = content.components.find((c) => c.type === 'status');
  assert.equal(status.items[0].color, 'danger');
  assert.match(status.items[0].value, /En erreur depuis 17:50/);
  assert.match(content.components[0].text, /Gemini 3\.8 Flash · routeur Gemini 3\.5 Flash-Lite/);
  const link = content.components.find((c) => c.type === 'button');
  assert.equal(link.link.url, 'https://aistudio.google.com/usage');
});

test('without a key: a message instead of the chart', () => {
  const content = buildUsageWidget({
    snapshot,
    config: normalizeConfig(),
    failing: null,
    language: 'en',
    now: NOW,
  });
  assert.ok(content.components.some((c) => c.type === 'text' && c.variant === 'body'));
  assert.ok(!content.components.some((c) => c.type === 'chart'));
});

test('token counts stay short', () => {
  assert.equal(compactTokens(850, 'en'), '850');
  assert.equal(compactTokens(12_400, 'en'), '12.4K');
  assert.ok(compactTokens(12_400_000_000, 'de').length <= 12);
  assert.equal(compactTokens(NaN, 'fr'), '0');
});
