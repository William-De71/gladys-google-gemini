// -----------------------------------------------------------------------------
// SDK wiring: every handler of the integration, registered on the Gladys
// client given, before `connect()`. Kept out of index.js so the tests run it
// against the fake Gladys of the SDK (`createFakeGladys`) and a fake Gemini
// API.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { modelName, normalizeConfig, resolveModel } from './config.js';
import { createGeminiClient, DEFAULT_BASE_URL, ERROR_KINDS } from './gemini-api.js';
import { createChatHandler } from './chat.js';
import { createSignatureStore } from './convert.js';
import { createEvents } from './events.js';
import { createUsage, USAGE_FILE } from './usage.js';
import { buildUsageWidget, WIDGETS } from './widgets.js';
import { checkConnection, failureMessage, testConnection } from './connection.js';
import { all } from './i18n.js';
import { usableTimeZone } from './time.js';

const logger = createLogger({ name: 'app' });

/** Keys of the manifest `actions`: stored by users, forever. */
export const ACTIONS = { TEST_CONNECTION: 'test_connection' };

/** A widget is nudged at most this often after requests (the core allows 1 / 10 s). */
const WIDGET_NUDGE_MS = 30_000;

/**
 * @description Register the handlers on a Gladys client, before `connect()`.
 * @param {object} gladys - A `GladysIntegration` (or the fake one of the SDK).
 * @param {object} [options] - Test seams.
 * @param {string} [options.baseUrl] - The Gemini API root.
 * @param {typeof fetch} [options.fetchImpl] - fetch.
 * @param {(ms: number) => Promise<void>} [options.sleep] - Retry waits.
 * @param {string} [options.usageFile] - The usage file.
 * @param {() => number} [options.now] - Clock.
 * @param {string} [options.timeZone] - The timezone of Gladys.
 * @returns {object} Handles for the tests.
 */
export function createApp(
  gladys,
  {
    baseUrl = DEFAULT_BASE_URL,
    fetchImpl = globalThis.fetch,
    sleep,
    usageFile = USAGE_FILE,
    now = Date.now,
    timeZone = usableTimeZone(),
  } = {},
) {
  let config = normalizeConfig();
  const getConfig = () => config;

  const client = createGeminiClient({
    getApiKey: () => config.api_key,
    baseUrl,
    fetchImpl,
    sleep,
    now,
  });
  const usage = createUsage({
    file: usageFile,
    now,
    timeZone: () => timeZone,
    onError: (err) => logger.warn(`Usage counters not saved: ${err?.message ?? err}`),
  });
  // Thought signatures of the answers, put back when the core sends the
  // turns again (convert.js): in memory only, they are worth nothing after
  // the conversation.
  const signatures = createSignatureStore({ now });
  const events = createEvents({ publish: (key, data) => gladys.publishSceneEvent(key, data), now });

  // --- Widget nudges ----------------------------------------------------------
  let lastNudge = 0;
  const nudgeWidget = () => {
    if (now() - lastNudge < WIDGET_NUDGE_MS) {
      return;
    }
    lastNudge = now();
    Promise.resolve()
      .then(() => gladys.requestWidgetRefresh(WIDGETS.USAGE))
      .catch(() => {});
  };

  // --- Status follows the requests ----------------------------------------------
  // A failing provider shows on the Configuration screen; the next answer
  // clears it. A refused request (400) says nothing about the provider.
  const setStatus = (ok, message) =>
    Promise.resolve()
      .then(() => gladys.setConnectionStatus(ok, ok ? undefined : message))
      .catch((err) => logger.warn(`Status not updated: ${err?.message ?? err}`));

  const onFailure = (error, context) => {
    const wasFailing = events.state();
    events.failure(error, context);
    if (error.kind !== ERROR_KINDS.REQUEST && events.state() !== wasFailing) {
      setStatus(false, failureMessage(error, context?.model));
    }
    nudgeWidget();
  };
  const onSuccess = () => {
    if (events.state()) {
      setStatus(true);
    }
    events.success();
    nudgeWidget();
  };

  // --- AI provider: every AI request of the instance arrives here ----------------
  gladys.onAiChat(
    createChatHandler({ client, getConfig, usage, signatures, onFailure, onSuccess, now }),
  );

  // --- Configuration button: "Test the connection" ---------------------------------
  gladys.onAction(ACTIONS.TEST_CONNECTION, async () => {
    logger.info('Action test_connection');
    const result = await testConnection(client, config, now);
    const { warnings } = await checkConnection(client, config).catch(() => ({ warnings: [] }));
    if (warnings.length === 0) {
      return result;
    }
    return all((language) =>
      [result[language], ...warnings.map((warning) => warning[language])].join('\n'),
    );
  });

  // --- Dashboard widget ------------------------------------------------------------
  gladys.onWidgetGet(WIDGETS.USAGE, async ({ language } = {}) =>
    buildUsageWidget({
      snapshot: usage.snapshot(),
      config,
      failing: events.state(),
      language,
      now: now(),
      timeZone,
    }),
  );

  // --- Configuration ---------------------------------------------------------------
  async function applyConfig(raw) {
    config = normalizeConfig(raw);
    logger.info(
      `Configuration: chat ${modelName(resolveModel(config, 'model') ?? '(custom, empty)')} ` +
        `(thinking ${config.thinking}), router ${modelName(resolveModel(config, 'fast_model') ?? '(custom, empty)')}, ` +
        `max_tokens ${config.max_tokens}, API key ${config.api_key ? 'set' : 'missing'}`,
    );
    const { ok, message, warnings } = await checkConnection(client, config);
    for (const warning of warnings) {
      logger.warn(warning.en);
    }
    await setStatus(ok, message);
    nudgeWidget();
  }

  gladys.onConfigUpdated(async (raw) => {
    await applyConfig(raw);
  });

  // Each (re)connection re-reads the configuration, which may have changed
  // while the integration was away. The promise lets the tests wait for it.
  let startup = Promise.resolve();
  gladys.on('connected', () => {
    startup = (async () => {
      await usage.load();
      await applyConfig(await gladys.getConfig());
    })().catch(async (err) => {
      logger.error('Post-connection initialization failed', err);
      await setStatus(false, all('statusInitFailed'));
    });
  });

  // --- Graceful shutdown -------------------------------------------------------------
  gladys.handleShutdown(async (signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    await usage.save().catch(() => {});
    usage.stop();
  });

  return { getConfig, usage, events, client, whenReady: () => startup };
}
