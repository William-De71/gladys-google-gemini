// -----------------------------------------------------------------------------
// OpenAI-shaped requests of the Gladys core <-> Gemini `generateContent`.
//
// The core speaks the OpenAI chat completion dialect; Gemini has its own:
//   - system messages go to `systemInstruction`; the turns are `contents`
//     with the roles `user` and `model`, made of `parts`;
//   - a tool call is a `functionCall` part `{ id, name, args }` (an object,
//     not a JSON string); its result a `functionResponse` part
//     `{ id, name, response }` in a `user` turn — the core never says the
//     name, so it is found again from the call with the same id;
//   - images arrive as data URLs and become `inlineData` parts;
//   - `tool_choice` becomes `toolConfig.functionCallingConfig.mode`.
//
// Thought signatures: Gemini 3 and later attach an encrypted
// `thoughtSignature` to the parts they produce, and refuse (HTTP 400) a
// history whose function calls of the current turn lost theirs. The core
// keeps only the OpenAI fields, so the signatures are kept here, in memory,
// keyed by tool call id (and by the hash of a text answer), and put back when
// the core sends the turn again. A call whose signature is unknown (the
// integration restarted, the history comes from another provider) gets the
// value Google documents for history it did not produce,
// `skip_thought_signature_validator`: accepted, at some cost in quality.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { ERROR_KINDS, GeminiError } from './gemini-api.js';

/** The value Google accepts for a function call it did not generate. */
export const SKIP_SIGNATURE = 'skip_thought_signature_validator';

/** The bounds the core applies to a completion (validateAiCompletion). */
const MAX_TOOL_CALLS = 20;
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_ID = 128;
/** Ids the core writes when a tool call had none: never sent to Gemini. */
const PLACEHOLDER_IDS = new Set(['unknown', 'tool_call_unknown']);

const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/is;

/** Finish reasons that mean "the answer was filtered". */
const FILTERED = new Set([
  'SAFETY',
  'RECITATION',
  'LANGUAGE',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'IMAGE_SAFETY',
  'IMAGE_PROHIBITED_CONTENT',
]);

/** Finish reasons that mean "the model produced something unusable". */
export const BROKEN_FINISH = new Set([
  'MALFORMED_FUNCTION_CALL',
  'UNEXPECTED_TOOL_CALL',
  'TOO_MANY_TOOL_CALLS',
  'MISSING_THOUGHT_SIGNATURE',
  'MALFORMED_RESPONSE',
]);

/**
 * @description A short stable hash.
 * @param {string} value - The value.
 * @returns {string} 24 hex characters.
 */
function hash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

/**
 * @description The memory of thought signatures: bounded, entries expire.
 * @param {object} [options] - Options.
 * @param {number} [options.max] - Entries kept at most.
 * @param {number} [options.ttlMs] - Life of an entry.
 * @param {() => number} [options.now] - Clock.
 * @returns {{ remember: Function, recall: Function, size: Function }} The store.
 */
export function createSignatureStore({ max = 2000, ttlMs = 6 * 3600_000, now = Date.now } = {}) {
  const entries = new Map();
  return {
    remember(key, signature) {
      if (!key || typeof signature !== 'string' || !signature) {
        return;
      }
      entries.delete(key);
      entries.set(key, { signature, at: now() });
      while (entries.size > max) {
        entries.delete(entries.keys().next().value);
      }
    },
    recall(key) {
      const entry = entries.get(key);
      if (!entry) {
        return undefined;
      }
      if (now() - entry.at > ttlMs) {
        entries.delete(key);
        return undefined;
      }
      return entry.signature;
    },
    size() {
      return entries.size;
    },
  };
}

/** @description Signature key of a tool call. */
const callKey = (id) => `call:${id}`;
/** @description Signature key of a text answer. */
const textKey = (text) => `text:${hash(text)}`;

/**
 * @description The text of a content (string or list of parts).
 * @param {unknown} content - An OpenAI content.
 * @returns {string} The text parts joined.
 */
export function textOf(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (part?.type === 'text' && typeof part.text === 'string') {
        return part.text;
      }
      return '';
    })
    .join('');
}

/**
 * @description Whether a request carries an image.
 * @param {Array<object>} messages - OpenAI messages.
 * @returns {boolean} True when a user message has an image part.
 */
export function hasImages(messages) {
  return (messages ?? []).some(
    (message) =>
      Array.isArray(message?.content) && message.content.some((part) => part?.type === 'image_url'),
  );
}

/**
 * @description The parts of a user message: text and images.
 * @param {unknown} content - The OpenAI content.
 * @returns {Array<object>} Gemini parts.
 */
function userParts(content) {
  if (!Array.isArray(content)) {
    const text = typeof content === 'string' ? content : '';
    return text ? [{ text }] : [];
  }
  const parts = [];
  for (const part of content) {
    if (typeof part === 'string') {
      if (part) {
        parts.push({ text: part });
      }
    } else if (part?.type === 'text' && typeof part.text === 'string') {
      if (part.text) {
        parts.push({ text: part.text });
      }
    } else if (part?.type === 'image_url') {
      const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
      const match = typeof url === 'string' ? DATA_URL.exec(url) : null;
      if (match) {
        parts.push({ inlineData: { mimeType: match[1].toLowerCase(), data: match[2] } });
      } else if (typeof url === 'string' && url) {
        // generateContent reads inline bytes or uploaded files, not any web
        // address; the core only sends data URLs, this is a safety net.
        parts.push({ text: `[Image: ${url}]` });
      }
    }
  }
  return parts;
}

/**
 * @description The arguments of a tool call of the core as an object.
 * @param {unknown} value - A JSON string or an object.
 * @returns {object} The arguments (an empty object when unreadable).
 */
function argumentsObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * @description A tool call id the core gave, or null when it is a placeholder.
 * @param {unknown} id - The id.
 * @returns {string|null} The id.
 */
function realId(id) {
  if (typeof id !== 'string' || !id || PLACEHOLDER_IDS.has(id)) {
    return null;
  }
  return id;
}

/**
 * @description OpenAI messages -> `{ systemInstruction, contents }`.
 * @param {Array<object>} messages - The messages of the core.
 * @param {object} [signatures] - The signature store.
 * @returns {{ systemInstruction?: object, contents: Array<object> }} The Gemini fields.
 */
export function toGeminiContents(messages, signatures = createSignatureStore()) {
  const system = [];
  const contents = [];
  const toolNames = new Map();

  const push = (role, parts) => {
    if (parts.length === 0) {
      return;
    }
    const last = contents[contents.length - 1];
    // Two turns of the same role in a row (a tool result then a user nudge)
    // become one: Gemini expects user and model to alternate.
    if (last && last.role === role) {
      last.parts.push(...parts);
    } else {
      contents.push({ role, parts });
    }
  };

  for (const message of messages ?? []) {
    switch (message?.role) {
      case 'system':
      case 'developer': {
        const text = textOf(message.content);
        if (text) {
          system.push({ text });
        }
        break;
      }
      case 'user':
        push('user', userParts(message.content));
        break;
      case 'assistant': {
        const parts = [];
        const text = textOf(message.content);
        if (text) {
          const part = { text };
          const signature = signatures.recall(textKey(text));
          if (signature) {
            part.thoughtSignature = signature;
          }
          parts.push(part);
        }
        const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
        let signed = false;
        const callParts = calls.map((call) => {
          const name = String(call?.function?.name ?? '');
          const id = realId(call?.id);
          if (id) {
            toolNames.set(id, name);
          }
          const functionCall = { name, args: argumentsObject(call?.function?.arguments) };
          if (id) {
            functionCall.id = id;
          }
          const part = { functionCall };
          const signature = id ? signatures.recall(callKey(id)) : undefined;
          if (signature) {
            part.thoughtSignature = signature;
            signed = true;
          }
          return part;
        });
        // Parallel calls: Gemini signs only the first one. When none of them
        // is known any more, the first gets the documented skip value.
        if (callParts.length > 0 && !signed) {
          callParts[0].thoughtSignature = SKIP_SIGNATURE;
        }
        parts.push(...callParts);
        push('model', parts);
        break;
      }
      case 'tool': {
        const id = realId(message.tool_call_id);
        const name =
          (id && toolNames.get(id)) ||
          (typeof message.name === 'string' && message.name) ||
          'unknown_tool';
        const functionResponse = {
          name,
          response: {
            result: typeof message.content === 'string' ? message.content : textOf(message.content),
          },
        };
        if (id) {
          functionResponse.id = id;
        }
        push('user', [{ functionResponse }]);
        break;
      }
      default:
        // An unknown role is dropped: Gemini would refuse the whole request.
        break;
    }
  }

  const out = { contents };
  if (system.length > 0) {
    out.systemInstruction = { parts: system };
  }
  return out;
}

/**
 * @description OpenAI tools -> one Gemini tool with function declarations.
 * The JSON Schema of the core goes in `parametersJsonSchema`, which takes
 * JSON Schema as it is (the older `parameters` field only takes an OpenAPI
 * subset).
 * @param {Array<object>} tools - The tools of the core.
 * @returns {Array<object>} `[{ functionDeclarations }]`, or [] without tools.
 */
export function toGeminiTools(tools) {
  const declarations = (tools ?? [])
    .filter((tool) => tool?.type === 'function' && typeof tool.function?.name === 'string')
    .map((tool) => {
      const declaration = {
        name: tool.function.name,
        // Required by Gemini; the core always writes one.
        description:
          typeof tool.function.description === 'string' && tool.function.description
            ? tool.function.description
            : tool.function.name,
      };
      const parameters = tool.function.parameters;
      if (parameters && typeof parameters === 'object' && !Array.isArray(parameters)) {
        declaration.parametersJsonSchema = parameters;
      }
      return declaration;
    });
  return declarations.length > 0 ? [{ functionDeclarations: declarations }] : [];
}

/**
 * @description OpenAI tool_choice -> Gemini toolConfig.
 * @param {unknown} choice - `auto`, `none`, `required` or `{ type, function }`.
 * @returns {object|undefined} The toolConfig, undefined to leave the default (AUTO).
 */
export function toGeminiToolConfig(choice) {
  if (choice === 'required' || choice === 'any') {
    return { functionCallingConfig: { mode: 'ANY' } };
  }
  if (choice === 'none') {
    return { functionCallingConfig: { mode: 'NONE' } };
  }
  if (choice === 'auto') {
    return { functionCallingConfig: { mode: 'AUTO' } };
  }
  if (choice && typeof choice === 'object' && typeof choice.function?.name === 'string') {
    return {
      functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [choice.function.name] },
    };
  }
  return undefined;
}

/**
 * @description The OpenAI usage of a Gemini `usageMetadata`. Thinking tokens
 * are billed as output: they count with the completion.
 * @param {object} metadata - `usageMetadata`.
 * @returns {object} `{ prompt_tokens, completion_tokens, total_tokens }`.
 */
export function toOpenAiUsage(metadata) {
  const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const prompt = number(metadata?.promptTokenCount) + number(metadata?.toolUsePromptTokenCount);
  const completion = number(metadata?.candidatesTokenCount) + number(metadata?.thoughtsTokenCount);
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: number(metadata?.totalTokenCount) || prompt + completion,
  };
}

/**
 * @description A Gemini response -> the OpenAI completion the core reads.
 * The signatures of the parts are remembered on the way.
 * @param {object} response - The GenerateContentResponse.
 * @param {object} [options] - Options.
 * @param {object} [options.signatures] - The signature store.
 * @param {string} [options.model] - The model id (for the completion).
 * @returns {object} `{ id, object, model, choices: [{ message, finish_reason }],
 * usage, gemini_finish }`.
 */
export function toOpenAiCompletion(response, { signatures = createSignatureStore(), model } = {}) {
  const blocked = response?.promptFeedback?.blockReason;
  if (blocked) {
    throw new GeminiError(
      ERROR_KINDS.REQUEST,
      `Gemini refused the request (prompt blocked: ${blocked})`,
    );
  }
  const candidate = response?.candidates?.[0];
  if (!candidate) {
    throw new GeminiError(ERROR_KINDS.SERVER, 'Gemini returned no answer');
  }
  const parts = Array.isArray(candidate.content?.parts) ? candidate.content.parts : [];
  const responseId = String(response?.responseId ?? hash(JSON.stringify(parts)));

  let text = '';
  let textSignature;
  const toolCalls = [];
  parts.forEach((part, index) => {
    if (part?.thought === true) {
      return;
    }
    if (typeof part?.text === 'string') {
      text += part.text;
      if (part.thoughtSignature) {
        textSignature = part.thoughtSignature;
      }
      return;
    }
    const call = part?.functionCall;
    if (!call || !TOOL_NAME.test(String(call.name ?? ''))) {
      return;
    }
    if (toolCalls.length >= MAX_TOOL_CALLS) {
      return;
    }
    const id =
      typeof call.id === 'string' && call.id && call.id.length <= MAX_ID
        ? call.id
        : `call_${hash(`${responseId}-${index}`)}`;
    signatures.remember(callKey(id), part.thoughtSignature);
    toolCalls.push({
      id,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
    });
  });

  if (text && textSignature) {
    signatures.remember(textKey(text), textSignature);
  }

  const reason = String(candidate.finishReason ?? 'STOP');
  let finish = 'stop';
  if (reason === 'MAX_TOKENS') {
    finish = 'length';
  } else if (FILTERED.has(reason)) {
    finish = 'content_filter';
  } else if (toolCalls.length > 0) {
    finish = 'tool_calls';
  }

  const message = { role: 'assistant', content: text || (toolCalls.length > 0 ? null : '') };
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }
  return {
    id: responseId,
    object: 'chat.completion',
    model: response?.modelVersion ?? model,
    choices: [{ index: 0, message, finish_reason: finish }],
    usage: toOpenAiUsage(response?.usageMetadata),
    gemini_finish: reason,
  };
}
