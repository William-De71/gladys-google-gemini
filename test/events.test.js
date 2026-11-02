import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import { createEvents, TRIGGERS } from '../src/events.js';

test('one error per failure, one recovery, a refused request starts nothing', async () => {
  const published = [];
  let clock = 1_000_000;
  const events = createEvents({
    publish: async (key, data) => published.push([key, data]),
    now: () => clock,
  });
  events.success();
  events.failure({ kind: 'request', message: 'bad image' }, { use: 'chat' });
  events.failure(
    { kind: 'rate_limit', message: 'HTTP 429' },
    { use: 'router', model: 'gemini-3.5-flash-lite' },
  );
  events.failure({ kind: 'rate_limit', message: 'HTTP 429' }, { use: 'chat' });
  clock += 60_000;
  events.failure({ kind: 'auth', message: 'HTTP 401' }, { use: 'chat', model: 'gemini-3.8-flash' });
  clock += 20 * 60_000;
  events.success();
  events.success();
  await tick();
  assert.deepEqual(published, [
    [
      TRIGGERS.ERROR,
      { kind: 'rate_limit', message: 'HTTP 429', use: 'router', model: 'gemini-3.5-flash-lite' },
    ],
    [TRIGGERS.ERROR, { kind: 'auth', message: 'HTTP 401', use: 'chat', model: 'gemini-3.8-flash' }],
    [TRIGGERS.RECOVERED, { down_minutes: 21 }],
  ]);
  assert.equal(events.state(), null);
});

test('event data stays flat and within the core limits; a refused publish is only logged', async () => {
  const published = [];
  const events = createEvents({ publish: async (key, data) => published.push(data) });
  events.failure({ kind: 'server', message: 'x'.repeat(2000) }, {});
  await tick();
  const [data] = published;
  for (const value of Object.values(data)) {
    assert.ok(value === null || ['string', 'number', 'boolean'].includes(typeof value));
  }
  assert.equal(data.message.length, 300);
  assert.equal(data.use, 'chat');
  const failing = createEvents({ publish: async () => Promise.reject(new Error('429')) });
  failing.failure({ kind: 'timeout', message: 't' });
  await tick();
});
