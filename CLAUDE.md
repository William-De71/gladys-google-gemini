# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** that makes **Google Gemini** the
AI provider of a Gladys instance: a Node.js service (Node 22+, ESM, no build
step) in its own sandboxed Docker container, talking to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js)
and to the official Gemini API (`https://generativelanguage.googleapis.com/v1beta`,
`generateContent`) with the administrator's API key from Google AI Studio.
Runtime dependency: the SDK only (plain `fetch`, no Google client).
`type: "ai"`, Gladys 5.3.0+, `transports: ["cloud"]`,
`categories: ["assistants"]`. Not affiliated with Google.

The contract (SDK README, "AI providers"): one OpenAI-compatible chat
completion in (`messages`, `tools`, `tool_choice`, `max_tokens`, `purpose`,
`categories`, no `model`), one OpenAI-compatible completion out. The agentic
loop (prompts, tools, history) runs in the core; this integration only picks
the model and translates to and from `generateContent`. **Never tested with a
real Gemini key**: request and response shapes follow the REST reference of
the Gemini API (aistudio.google.com/api-reference, `llms-full.txt`), checked
on 2026-11-02. Google now pushes its Interactions API; `generateContent` stays
"fully supported" and is stateless, which fits a bridge.

## Commands

```bash
npm install
npm test                                  # node --test; a fake Gemini API on 127.0.0.1
node --test test/chat.test.js             # one file
UPDATE_BASELINE=1 npm test                # rewrite test/fixtures/manifest.baseline.json (on purpose only)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npx github:GladysAssistant/integration-store . --skip-image-check   # store checks
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js               SDK wiring only (new GladysIntegration + createApp)
src/app.js             every handler: onAiChat, test button, widget, configuration,
                       status following the requests
src/chat.js            the AI provider: model per purpose, thinking level, retry
                       without it when refused, one more try on a malformed call,
                       cut / filtered answers, usage, hooks
src/convert.js         OpenAI <-> Gemini: systemInstruction, contents, functionCall /
                       functionResponse (names found back by id), inlineData, toolConfig,
                       parametersJsonSchema, thought signatures (memory + skip value)
src/gemini-api.js      fetch client: generateContent, models.get; x-goog-api-key header,
                       deadline, retries on 429 / 5xx / network with Retry-After or
                       RetryInfo, error kinds (a bad key is a 400 API_KEY_INVALID)
src/events.js          triggers: error (once per failure kind), recovered
src/usage.js           /data/usage.json: requests and tokens per local day, 62 days
src/widgets.js         the usage widget
src/connection.js      status (GET models/{id}, no token spent) and the test button
src/config.js          models, thinking levels per model, custom model id, max_tokens
src/i18n.js            runtime texts, en / fr / de / es
src/time.js            local days and times (TZ of Gladys, Intl only)
test/helpers/fake-gemini.js     the fake API (generateContent, models.get, 400 on a bad key)
.github/scripts/release.mjs     version, changelog, bump (tested in test/)
```

## Rules

- **Every key users store is forever**: the keys of `config_schema` and the
  values of the `model` / `fast_model` / `thinking` selects (a model id leaves
  the list only when Google shuts the model down), `actions`, the widget, the
  triggers (fields, options, variables). `test/structure.test.js` compares
  them to `test/fixtures/manifest.baseline.json`: never update it to make a
  test pass without a documented migration.
- **Deadlines of the core**: the ack is awaited 20 s for
  `intent-classification`, 120 s otherwise; the handler gives up at 18 s and
  110 s. Retries (429, 5xx, network) only while the deadline leaves room;
  a wait longer than 8 s (Retry-After or RetryInfo) fails at once.
- **Never fall back silently**: a failure throws (the core names it to the
  user); never answer from another provider, never return an empty turn.
- **The router thinks the least its model accepts**
  (`thinkingLevelFor(model, 'minimal')`): it must answer fast. Only levels a
  model accepts are sent (`MODELS[id].thinking`); 3.8 Flash and 4 Argon refuse
  `minimal`. No Gemini 3+ model can turn thinking off.
- **Thought signatures**: every signature of an answer is remembered
  (`createSignatureStore`, by tool call id and by hash of a text) and put back
  when the core resends the turn; a call never seen gets
  `skip_thought_signature_validator` on the first call of its turn. Never send
  `temperature`, `topP`, `topK`, `candidateCount` or a final `model` turn
  (refused or ignored since Gemini 3.6).
- **`store: false`** on every request (logging is on by default for new paid
  projects since 2026-10-26).
- **The completion is bounded like the core does** (`validateAiCompletion`):
  `content` a string or null, at most 20 tool calls, names
  `^[a-zA-Z0-9_-]{1,64}$`, `arguments` a JSON string, ids at most 128
  characters. Internal fields (`gemini_finish`) never leave `chat.js`.
- **Scene events** once per transition: `error` when the failure kind changes,
  `recovered` at the first answer after. A refused request (`request` kind:
  HTTP 400, safety filters, malformed answer) starts nothing and does not
  change the status.
- **No web search action**: the terms of Grounding with Google Search require
  displaying the Search Suggestions with the grounded result and forbid
  modifying it; a scene cannot. Do not add `googleSearch` without a way to
  honour them.
- **The API key** is a `secret`: never logged, never in /data, never in an
  error message or a URL (`errorMessageOf` masks `AIza…` keys and `key=`).
- **The container rootfs is read-only.** Write only under `/data` (usage
  counters, written at most every 10 s and at shutdown).
- **Four languages.** Every user-facing text (manifest, `src/i18n.js`,
  `docs/*.md`, README) exists in en, fr, de, es; `test/i18n.test.js` checks it.
  German says "du", Spanish "usted".
- **Widget images.** After any change to a widget content, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
- **Logo**: the Gemini spark (Wikimedia Commons, public domain) names the
  service only; keep the "not affiliated" notices.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
  Below 1.0.0 until the maintainer runs Release with `release-as: 1.0.0`.
- **Changelog.** Ne jamais éditer CHANGELOG.md à la main, il est généré à la
  release. Écris le titre de PR comme la ligne que l'utilisateur lira.
- **Commits and PR titles** follow Conventional Commits, in English.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

## Pitfalls

- A wrong key is an HTTP 400 `INVALID_ARGUMENT` with reason `API_KEY_INVALID`,
  not a 401. A 403 can mean a leaked key (auth) or a project without the free
  tier (billing): `kindOfStatus` reads the message.
- `models.get` succeeds even when the project may not generate: only the test
  button proves it.
- The core never says the name of a tool in a `tool` message: it is found
  again from the assistant turn with the same id. Ids `unknown` and
  `tool_call_unknown` are placeholders, never sent.
- Tool results and the next user text form one `user` turn: Gemini wants the
  roles to alternate.
- Enums are sent in the casing of the REST reference (`LOW`, `ANY`).
- `AbortSignal.timeout` does not keep the process alive: a test that waits on
  it needs its own timer.
- `node --test` also runs `test/helpers/`: nothing starts on import.
- The validator of the Gladys core creates `gladys-development.duckdb` in the
  current folder: run it from elsewhere.
