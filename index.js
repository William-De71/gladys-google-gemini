// -----------------------------------------------------------------------------
// Entry point of the Google Gemini external integration.
//
// An AI provider (manifest `type: "ai"`): once an administrator selects it in
// Settings, Artificial Intelligence, every AI request of the Gladys instance —
// the chat and its tool calls, the intent router, the scene `ai.ask` action,
// the weekly digest — is answered by Gemini through the Gemini API, with the
// administrator's own API key (Google AI Studio). On top of that:
//   - scene triggers: Gemini fails / answers again;
//   - dashboard widget: requests and tokens consumed.
//
// This file only wires the SDK client: the handlers are in src/app.js.
//
// Environment variables provided by the Gladys supervisor:
//   GLADYS_HOST_API_URL / GLADYS_INTEGRATION_TOKEN / GLADYS_INTEGRATION_SELECTOR
//   TZ (the timezone of Gladys: the days of the usage counters)
// The SDK reads the first three: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
createApp(gladys);

// --- Startup -----------------------------------------------------------------------
logger.info(`Starting the Google Gemini integration ${version}...`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
