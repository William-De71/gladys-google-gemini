// -----------------------------------------------------------------------------
// Consumption counters, for the widget: requests, errors and tokens per local
// day (timezone of Gladys), from the `usageMetadata` Gemini returns with every
// answer (thinking tokens counted as output, as Google bills them). Nothing
// here is a price: Google AI Studio stays the reference.
//
// Kept in /data/usage.json (the only writable folder), written at most every
// 10 s and at shutdown; 62 days are kept. A missing or broken file starts
// empty: these are statistics, never needed to answer.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { localParts, usableTimeZone } from './time.js';

export const USAGE_FILE = '/data/usage.json';
const KEEP_DAYS = 62;
const SAVE_DELAY_MS = 10_000;

/** What a request is for, as counted. */
export const USES = ['chat', 'router', 'digest'];

/**
 * @description An empty day.
 * @returns {object} The counters.
 */
function emptyDay() {
  return { requests: 0, errors: 0, prompt_tokens: 0, completion_tokens: 0, by_use: {} };
}

/**
 * @description A finite, non-negative integer.
 * @param {unknown} value - The value.
 * @returns {number} The integer, 0 otherwise.
 */
function count(value) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * @description Build the usage store.
 * @param {object} [options] - Options.
 * @param {string} [options.file] - The JSON file.
 * @param {() => number} [options.now] - Clock.
 * @param {() => string} [options.timeZone] - The timezone of Gladys.
 * @param {number} [options.saveDelayMs] - Write debounce.
 * @param {(err: Error) => void} [options.onError] - Write failures.
 * @returns {object} The store.
 */
export function createUsage({
  file = USAGE_FILE,
  now = Date.now,
  timeZone = () => usableTimeZone(),
  saveDelayMs = SAVE_DELAY_MS,
  onError = () => {},
} = {}) {
  let data = { days: {}, last_request: null, last_error: null };
  let timer = null;

  const today = () => localParts(now(), timeZone()).date;

  function day(key = today()) {
    if (!data.days[key]) {
      data.days[key] = emptyDay();
      prune();
    }
    return data.days[key];
  }

  function prune() {
    const keys = Object.keys(data.days).sort();
    for (const key of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) {
      delete data.days[key];
    }
  }

  function scheduleSave() {
    if (timer) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      save().catch(onError);
    }, saveDelayMs);
    timer.unref?.();
  }

  async function save() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    await mkdir(dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    await writeFile(temp, JSON.stringify(data));
    await rename(temp, file);
  }

  return {
    /** @description Read the file (missing or broken: start empty). */
    async load() {
      try {
        const parsed = JSON.parse(await readFile(file, 'utf8'));
        if (parsed && typeof parsed.days === 'object' && parsed.days) {
          data = {
            days: parsed.days,
            last_request: parsed.last_request ?? null,
            last_error: parsed.last_error ?? null,
          };
          prune();
        }
      } catch {
        // First start, or an unreadable file: counters start again.
      }
    },

    /**
     * @description Count one answered request.
     * @param {object} entry - `{ use, model, usage, ms }`.
     */
    recordSuccess({ use, model, usage, ms }) {
      const counters = day();
      const prompt = count(usage?.prompt_tokens);
      const completion = count(usage?.completion_tokens);
      counters.requests += 1;
      counters.prompt_tokens += prompt;
      counters.completion_tokens += completion;
      const key = USES.includes(use) ? use : 'chat';
      counters.by_use[key] = (counters.by_use[key] ?? 0) + prompt + completion;
      data.last_request = {
        at: now(),
        use: key,
        model: String(model ?? ''),
        ms: count(ms),
        ok: true,
      };
      scheduleSave();
    },

    /**
     * @description Count one failed request.
     * @param {object} entry - `{ use, model, kind, message }`.
     */
    recordError({ use, model, kind, message }) {
      const counters = day();
      counters.requests += 1;
      counters.errors += 1;
      const key = USES.includes(use) ? use : 'chat';
      data.last_request = { at: now(), use: key, model: String(model ?? ''), ok: false };
      data.last_error = {
        at: now(),
        use: key,
        model: String(model ?? ''),
        kind: String(kind ?? ''),
        message: String(message ?? '').slice(0, 200),
      };
      scheduleSave();
    },

    /**
     * @description What the widget shows.
     * @returns {object} `{ today, month, days: [{ date, tokens }], last_request, last_error }`.
     */
    snapshot() {
      const todayKey = today();
      const month = todayKey.slice(0, 7);
      const totals = emptyDay();
      for (const [key, counters] of Object.entries(data.days)) {
        if (key.startsWith(month)) {
          totals.requests += count(counters.requests);
          totals.errors += count(counters.errors);
          totals.prompt_tokens += count(counters.prompt_tokens);
          totals.completion_tokens += count(counters.completion_tokens);
        }
      }
      const days = Object.keys(data.days)
        .sort()
        .slice(-30)
        .map((key) => ({
          date: key,
          tokens: count(data.days[key].prompt_tokens) + count(data.days[key].completion_tokens),
        }));
      return {
        today_key: todayKey,
        today: { ...emptyDay(), ...(data.days[todayKey] ?? {}) },
        month: totals,
        days,
        last_request: data.last_request,
        last_error: data.last_error,
      };
    },

    save,

    /** @description Stop the pending write (tests, shutdown after save). */
    stop() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
