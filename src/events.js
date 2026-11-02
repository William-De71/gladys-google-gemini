// -----------------------------------------------------------------------------
// Scene triggers: the assistant of Gladys stops working when Google refuses
// the key, the quota or the billing stops it, or the API is down — and Gladys never falls
// back to Gladys Plus on its own. These two triggers let a scene tell the
// administrator (by SMS, Telegram…):
//
//   - `error`      Gemini failed after working (or at the first request), or
//                  failed in another way than the last time;
//   - `recovered`  Gemini answers again after an `error`.
//
// One event per transition, never a repeat: a failing chat that the user
// retries ten times gives one `error`. A refused request (HTTP 400, an
// answer stopped by the safety filters…) is about that request, not the provider: it
// starts nothing.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { ERROR_KINDS } from './gemini-api.js';

const logger = createLogger({ name: 'events' });

export const TRIGGERS = { ERROR: 'error', RECOVERED: 'recovered' };

/**
 * @description Build the trigger state machine.
 * @param {object} options - Options.
 * @param {(key: string, data: object) => Promise<unknown>} options.publish - `gladys.publishSceneEvent`.
 * @param {() => number} [options.now] - Clock.
 * @returns {{ failure: Function, success: Function, state: Function }} The hooks.
 */
export function createEvents({ publish, now = Date.now }) {
  // null: no failure reported; else { kind, since }.
  let failing = null;

  const send = (key, data) => {
    Promise.resolve()
      .then(() => publish(key, data))
      .catch((err) => logger.warn(`Scene event ${key} not published: ${err?.message ?? err}`));
  };

  return {
    /**
     * @description A request failed.
     * @param {{ kind: string, message: string }} error - The GeminiError.
     * @param {{ use: string, model?: string }} context - What it was for.
     */
    failure(error, { use, model } = {}) {
      if (error?.kind === ERROR_KINDS.REQUEST) {
        return;
      }
      if (failing && failing.kind === error.kind) {
        return;
      }
      failing = { kind: error.kind, since: failing?.since ?? now() };
      send(TRIGGERS.ERROR, {
        kind: error.kind,
        message: String(error.message ?? '').slice(0, 300),
        use: use ?? 'chat',
        model: model ?? null,
      });
    },

    /** @description A request was answered. */
    success() {
      if (!failing) {
        return;
      }
      const minutes = Math.max(0, Math.round((now() - failing.since) / 60000));
      failing = null;
      send(TRIGGERS.RECOVERED, { down_minutes: minutes });
    },

    /**
     * @description The current state, for the widget and the tests.
     * @returns {object|null} `{ kind, since }` or null.
     */
    state() {
      return failing;
    },
  };
}
