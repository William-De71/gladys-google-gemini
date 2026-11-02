// -----------------------------------------------------------------------------
// The AI provider: one OpenAI chat completion in, one out, answered by Gemini.
//
// The whole agentic loop (prompts, tools, history) stays in the Gladys core:
// this handler picks the model, translates the request (convert.js), calls
// generateContent and translates the answer back. It runs no tool.
//
// What each `purpose` gets:
//   - `intent-classification` (the router, before every chat turn): the fast
//     model with the least thinking it accepts, under 18 s (the core waits
//     20 s);
//   - `chat`, `weekly-digest` and anything else: the main model at the
//     thinking level of the configuration, under 110 s (the core waits 120 s).
//
// `store: false` on every request: Google does not log the conversation in
// the "Logs and datasets" of the project (logging is on by default for the
// new paid projects since 2026-10-26).
// -----------------------------------------------------------------------------

import { AI_CHAT_PURPOSES, createLogger } from '@gladysassistant/integration-sdk';
import { MAX_TOKENS_MAX, modelName, resolveModel, thinkingLevelFor } from './config.js';
import {
  BROKEN_FINISH,
  createSignatureStore,
  hasImages,
  toGeminiContents,
  toGeminiToolConfig,
  toGeminiTools,
  toOpenAiCompletion,
} from './convert.js';
import { ERROR_KINDS, GeminiError } from './gemini-api.js';

const logger = createLogger({ name: 'chat' });

export const CHAT_TIMEOUT_MS = 110_000;
export const ROUTER_TIMEOUT_MS = 18_000;

/**
 * @description The use counted for a purpose.
 * @param {string} purpose - The `purpose` of the request.
 * @returns {string} `router`, `digest` or `chat`.
 */
export function useOf(purpose) {
  if (purpose === AI_CHAT_PURPOSES.INTENT_CLASSIFICATION) {
    return 'router';
  }
  if (purpose === AI_CHAT_PURPOSES.WEEKLY_DIGEST) {
    return 'digest';
  }
  return 'chat';
}

/**
 * @description Build the Gemini request of a core request.
 * @param {object} request - `{ messages, tools?, tool_choice?, max_tokens?, purpose }`.
 * @param {object} config - The normalized config.
 * @param {object} [options] - Options.
 * @param {object} [options.signatures] - The signature store.
 * @param {Set<string>} [options.noThinking] - Models that refused `thinkingConfig`.
 * @returns {{ model: string, body: object }} The model and the body.
 */
export function buildRequest(
  request,
  config,
  { signatures = createSignatureStore(), noThinking = new Set() } = {},
) {
  const router = request?.purpose === AI_CHAT_PURPOSES.INTENT_CLASSIFICATION;
  const model = resolveModel(config, router ? 'fast_model' : 'model');
  if (!model) {
    throw new GeminiError(
      ERROR_KINDS.MODEL,
      'The configuration chooses a custom model but the custom model id is empty',
    );
  }
  const body = {
    ...toGeminiContents(request?.messages, signatures),
    generationConfig: {
      // The caller's `max_tokens` is sized for an answer without thinking;
      // with Gemini the limit counts the thinking too.
      maxOutputTokens: Math.min(
        MAX_TOKENS_MAX,
        Math.max(config.max_tokens, Number(request?.max_tokens) || 0),
      ),
    },
    store: false,
  };
  if (body.contents.length === 0) {
    throw new GeminiError(ERROR_KINDS.REQUEST, 'The request carries no message to answer');
  }
  const tools = toGeminiTools(request?.tools);
  if (tools.length > 0) {
    body.tools = tools;
    const toolConfig = toGeminiToolConfig(request?.tool_choice);
    if (toolConfig) {
      body.toolConfig = toolConfig;
    }
  }
  if (!noThinking.has(model)) {
    const level = thinkingLevelFor(model, router ? 'minimal' : config.thinking);
    if (level !== undefined) {
      body.generationConfig.thinkingConfig = { thinkingLevel: level };
    }
  }
  return { model, body };
}

/**
 * @description Whether a refusal is about the thinking configuration.
 * @param {unknown} err - The error.
 * @returns {boolean} True for a 400 that names it.
 */
function refusedThinking(err) {
  return (
    err instanceof GeminiError && err.kind === ERROR_KINDS.REQUEST && /thinking/i.test(err.message)
  );
}

/**
 * @description Create the `onAiChat` handler.
 * @param {object} options - Options.
 * @param {object} options.client - The Gemini client (gemini-api.js).
 * @param {() => object} options.getConfig - The normalized config.
 * @param {object} [options.usage] - The usage store (usage.js).
 * @param {object} [options.signatures] - The signature store (convert.js).
 * @param {(err: GeminiError, context: object) => void} [options.onFailure] - Failure hook (scene trigger).
 * @param {() => void} [options.onSuccess] - Success hook.
 * @param {() => number} [options.now] - Clock.
 * @returns {(request: object) => Promise<object>} The handler.
 */
export function createChatHandler({
  client,
  getConfig,
  usage,
  signatures = createSignatureStore(),
  onFailure = () => {},
  onSuccess = () => {},
  now = Date.now,
}) {
  // Models that refused `thinkingConfig` (a custom model without thinking):
  // never sent to them again until the integration restarts.
  const noThinking = new Set();

  return async function onAiChat(request) {
    const config = getConfig();
    const use = useOf(request?.purpose);
    const router = use === 'router';
    const budget = router ? ROUTER_TIMEOUT_MS : CHAT_TIMEOUT_MS;
    const started = now();
    const left = () => Math.max(1000, budget - (now() - started));
    let model;
    try {
      let built = buildRequest(request, config, { signatures, noThinking });
      model = built.model;
      const call = async () => {
        try {
          return await client.generateContent(built.model, built.body, { timeoutMs: left() });
        } catch (err) {
          if (!built.body.generationConfig.thinkingConfig || !refusedThinking(err)) {
            throw err;
          }
          logger.warn(`${built.model} refused the thinking level: sent without it from now on`);
          noThinking.add(built.model);
          built = buildRequest(request, config, { signatures, noThinking });
          return client.generateContent(built.model, built.body, { timeoutMs: left() });
        }
      };

      let response = await call();
      let completion = toOpenAiCompletion(response, { signatures, model });
      // A malformed tool call is a slip of the model: one more try while
      // the deadline leaves room, then the core hears about it.
      if (BROKEN_FINISH.has(completion.gemini_finish) && budget - (now() - started) > 5000) {
        logger.warn(`${modelName(model)} ended with ${completion.gemini_finish}: asking again`);
        usage?.recordSuccess({ use, model, usage: completion.usage, ms: now() - started });
        response = await call();
        completion = toOpenAiCompletion(response, { signatures, model });
      }
      const { gemini_finish: reason, ...out } = completion;
      const message = out.choices[0].message;
      const ms = now() - started;

      if (!message.content && !message.tool_calls) {
        if (reason === 'MAX_TOKENS') {
          throw new GeminiError(
            ERROR_KINDS.REQUEST,
            `The answer was cut at max_tokens (${built.body.generationConfig.maxOutputTokens}) before any text: raise it in the configuration or lower the thinking`,
          );
        }
        if (out.choices[0].finish_reason === 'content_filter') {
          throw new GeminiError(
            ERROR_KINDS.REQUEST,
            `Gemini stopped the answer (${reason}): rephrase the request`,
          );
        }
        if (BROKEN_FINISH.has(reason)) {
          throw new GeminiError(
            ERROR_KINDS.REQUEST,
            `Gemini produced no usable answer (${reason})`,
          );
        }
        throw new GeminiError(ERROR_KINDS.SERVER, `Gemini returned an empty answer (${reason})`);
      }
      if (reason === 'MAX_TOKENS') {
        logger.warn(
          `The answer hit max_tokens (${built.body.generationConfig.maxOutputTokens}): raise it in the configuration`,
        );
      }
      logger.info(
        `${request?.purpose ?? 'chat'}: ${modelName(model)} answered in ${(ms / 1000).toFixed(1)} s` +
          ` (${out.usage.prompt_tokens} in, ${out.usage.completion_tokens} out` +
          `${message.tool_calls ? `, ${message.tool_calls.length} tool call(s)` : ''})`,
      );
      usage?.recordSuccess({ use, model, usage: out.usage, ms });
      onSuccess();
      return out;
    } catch (err) {
      const error =
        err instanceof GeminiError
          ? err
          : new GeminiError(ERROR_KINDS.SERVER, err?.message ?? String(err));
      if (hasImages(request?.messages) && error.kind === ERROR_KINDS.REQUEST) {
        error.message += ' (the request carried an image)';
      }
      logger.warn(`${request?.purpose ?? 'chat'} failed (${error.kind}): ${error.message}`);
      usage?.recordError({ use, model, kind: error.kind, message: error.message });
      onFailure(error, { use, model });
      throw error;
    }
  };
}
