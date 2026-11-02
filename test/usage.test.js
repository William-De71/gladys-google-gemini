import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUsage } from '../src/usage.js';

const DAY = 24 * 3600 * 1000;

const setup = async (t, start = Date.UTC(2026, 9, 31, 23, 30)) => {
  const dir = await mkdtemp(join(tmpdir(), 'gemini-usage-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const clock = { now: start };
  const make = () =>
    createUsage({
      file: join(dir, 'usage.json'),
      now: () => clock.now,
      timeZone: () => 'Europe/Paris',
      saveDelayMs: 60_000,
    });
  return { dir, clock, make };
};

test('counts per local day and month, keeps the last request and error', async (t) => {
  const { clock, make } = await setup(t);
  const usage = make();
  t.after(() => usage.stop());
  // 23:30 UTC on 31 October is already 1 November in Paris (UTC+1 since 25 October).
  usage.recordSuccess({
    use: 'router',
    model: 'gemini-3.5-flash-lite',
    usage: { prompt_tokens: 300, completion_tokens: 5 },
    ms: 400,
  });
  usage.recordSuccess({
    use: 'chat',
    model: 'gemini-3.8-flash',
    usage: { prompt_tokens: 9000, completion_tokens: 700 },
    ms: 6200,
  });
  usage.recordError({
    use: 'chat',
    model: 'gemini-3.8-flash',
    kind: 'rate_limit',
    message: 'HTTP 429',
  });
  const snap = usage.snapshot();
  assert.equal(snap.today_key, '2026-11-01');
  assert.deepEqual(
    [
      snap.today.requests,
      snap.today.errors,
      snap.today.prompt_tokens,
      snap.today.completion_tokens,
    ],
    [3, 1, 9300, 705],
  );
  assert.deepEqual(snap.today.by_use, { router: 305, chat: 9700 });
  assert.equal(snap.last_request.ok, false);
  assert.equal(snap.last_error.kind, 'rate_limit');
  clock.now += 2 * DAY;
  usage.recordSuccess({
    use: 'digest',
    model: 'gemini-3.8-flash',
    usage: { prompt_tokens: 100, completion_tokens: 'x' },
    ms: 1,
  });
  const later = usage.snapshot();
  assert.equal(later.month.prompt_tokens, 9400);
  assert.deepEqual(
    later.days.map((day) => day.date),
    ['2026-11-01', '2026-11-03'],
  );
});

test('saved to the file, read back after a restart; a broken file starts empty; 62 days kept', async (t) => {
  const { dir, clock, make } = await setup(t);
  const usage = make();
  for (let i = 0; i < 70; i += 1) {
    usage.recordSuccess({
      use: 'chat',
      model: 'm',
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      ms: 1,
    });
    clock.now += DAY;
  }
  await usage.save();
  const saved = JSON.parse(await readFile(join(dir, 'usage.json'), 'utf8'));
  assert.equal(Object.keys(saved.days).length, 62);
  const again = make();
  await again.load();
  assert.equal(again.snapshot().days.length, 30);
  await writeFile(join(dir, 'usage.json'), '{broken');
  const broken = make();
  await broken.load();
  assert.equal(broken.snapshot().last_request, null);
});
