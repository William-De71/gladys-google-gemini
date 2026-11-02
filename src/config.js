// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the administrator in Gladys from the `config_schema` of the
// manifest; the SDK fetches it (`gladys.getConfig()`) and notifies every
// change (`gladys.onConfigUpdated()`). This module provides the defaults and
// normalizes what arrives, so the rest of the code never deals with
// `undefined`, a number typed as a string, or a model the select no longer
// offers.
// -----------------------------------------------------------------------------

/**
 * The Gemini models offered in the Configuration screen. The ids are the
 * exact API ids of the Gemini API (aistudio.google.com/docs/models, checked
 * 2026-11-02): they are stored by users, so an id leaves this list only when
 * Google shuts the model down. Preview models are left out (they move and
 * vanish); `custom` hands the choice to the free `custom_model` field.
 *
 * `thinking`: the `thinkingLevel` values the model accepts (docs/thinking,
 * "Controlling thinking"). No Gemini 3 or 4 model can turn thinking off:
 * `minimal` is the least, and Gemini 3.8 Flash and Gemini 4 Argon refuse it.
 * `free`: available on the free tier of the Gemini API (docs/pricing).
 */
export const MODELS = {
  'gemini-3.8-flash': {
    name: 'Gemini 3.8 Flash',
    thinking: ['low', 'medium', 'high'],
    free: true,
  },
  'gemini-4-argon': {
    name: 'Gemini 4 Argon',
    thinking: ['low', 'medium', 'high'],
    free: false,
  },
  'gemini-3.6-flash': {
    name: 'Gemini 3.6 Flash',
    thinking: ['minimal', 'low', 'medium', 'high'],
    free: true,
  },
  'gemini-3.5-flash-lite': {
    name: 'Gemini 3.5 Flash-Lite',
    thinking: ['minimal', 'low', 'medium', 'high'],
    free: true,
  },
  'gemini-3.1-flash-lite': {
    name: 'Gemini 3.1 Flash-Lite',
    thinking: ['minimal', 'low', 'medium', 'high'],
    free: true,
  },
};

export const CUSTOM_MODEL = 'custom';

/** The thinking levels of the configuration (`thinking` select), least first. */
export const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'];

/** A model id typed by hand: what Gemini API ids look like. */
const MODEL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,99}$/;

/** Bounds of the `max_tokens` field, mirrored by the manifest. */
export const MAX_TOKENS_MIN = 2048;
export const MAX_TOKENS_MAX = 65536;

// Defaults: they MUST stay consistent with the `default` values declared in
// the `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  // The Gemini API key. A `secret` field: no default, never logged.
  api_key: '',
  // The model of the chat, the scene `ai.ask` action and the weekly digest.
  model: 'gemini-3.8-flash',
  // The model of the intent router, which runs before every chat turn and must
  // answer within 20 s: a fast, cheap model is the right one there.
  fast_model: 'gemini-3.5-flash-lite',
  // The id used by a select set to "custom" (a newer model, a preview…).
  custom_model: '',
  // How hard the chat model thinks.
  thinking: 'medium',
  // Output budget of one answer, thinking included.
  max_tokens: 16000,
};

/**
 * @description Merge the user config with the defaults.
 * @param {Record<string, unknown>} [raw] - Config returned by the SDK.
 * @returns {object} The normalized config.
 */
export function normalizeConfig(raw = {}) {
  const config = { ...DEFAULT_CONFIG, ...(raw ?? {}) };
  // A pasted "models/gemini-…" (the resource name) is accepted too.
  const customModel = String(config.custom_model ?? '')
    .trim()
    .replace(/^models\//, '');
  return {
    api_key: String(config.api_key ?? '').trim(),
    model: pickModel(config.model, DEFAULT_CONFIG.model),
    fast_model: pickModel(config.fast_model, DEFAULT_CONFIG.fast_model),
    custom_model: MODEL_ID_PATTERN.test(customModel) ? customModel : '',
    thinking: THINKING_LEVELS.includes(config.thinking) ? config.thinking : DEFAULT_CONFIG.thinking,
    max_tokens: clampInteger(config.max_tokens, MAX_TOKENS_MIN, MAX_TOKENS_MAX),
  };
}

/**
 * @description The model id to call for a select value.
 * @param {object} config - The normalized config.
 * @param {'model'|'fast_model'} key - Which select.
 * @returns {string|null} The API model id, null when "custom" has no id.
 */
export function resolveModel(config, key) {
  const value = config[key];
  if (value === CUSTOM_MODEL) {
    return config.custom_model || null;
  }
  return value;
}

/**
 * @description The display name of a model id.
 * @param {string} id - An API model id.
 * @returns {string} "Gemini 3.8 Flash", or the id itself.
 */
export function modelName(id) {
  return MODELS[id]?.name ?? id;
}

/**
 * @description The `thinkingLevel` to send for a model, in the casing of the
 * REST API (`LOW`…).
 * @param {string} id - The API model id.
 * @param {string} level - The wanted level (`minimal`, `low`, `medium`, `high`).
 * @returns {string|undefined} The value to send, undefined to let the model
 * choose (a custom model asked for its least thinking).
 */
export function thinkingLevelFor(id, level) {
  const accepted = MODELS[id]?.thinking;
  if (!accepted) {
    // A custom model: send the level as asked, except `minimal` (several
    // models refuse it). A refusal is caught by the chat handler, which
    // retries without the parameter.
    return level === 'minimal' ? undefined : level.toUpperCase();
  }
  if (accepted.includes(level)) {
    return level.toUpperCase();
  }
  // The closest level above: 3.8 Flash and 4 Argon start at low.
  const wanted = THINKING_LEVELS.indexOf(level);
  const above = accepted.find((value) => THINKING_LEVELS.indexOf(value) >= wanted);
  return (above ?? accepted[accepted.length - 1]).toUpperCase();
}

/**
 * @description A select value kept when known, else the default.
 * @param {unknown} value - The value.
 * @param {string} fallback - The default.
 * @returns {string} A model key or "custom".
 */
function pickModel(value, fallback) {
  if (value === CUSTOM_MODEL || (typeof value === 'string' && value in MODELS)) {
    return value;
  }
  return fallback;
}

/**
 * @description An integer within bounds.
 * @param {unknown} value - The value.
 * @param {number} min - The minimum.
 * @param {number} max - The maximum.
 * @returns {number} The integer.
 */
function clampInteger(value, min, max) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) {
    return DEFAULT_CONFIG.max_tokens;
  }
  return Math.min(max, Math.max(min, number));
}
