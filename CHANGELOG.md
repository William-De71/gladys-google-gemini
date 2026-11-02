# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.1.0] - unreleased

### Added

- **ai:** the Gladys AI provider on Google Gemini (Gemini API, key from Google AI Studio): the chat and its tool calls, the intent router, the scene "ask the AI" action and the weekly digest
- **models:** Gemini 3.8 Flash, Gemini 4 Argon, Gemini 3.6 Flash, Gemini 3.5 Flash-Lite and Gemini 3.1 Flash-Lite, or any other Gemini model id; a chat model and a fast router model; thinking level for the chat model
- **thought signatures:** kept between the turns of a conversation, so Gemini keeps its reasoning across tool calls
- **scenes:** triggers when the assistant fails (key refused, billing or free tier, rate limit, model unavailable, API unreachable) and when it answers again
- **widgets:** requests and tokens of the day and of the month, tokens per day over 30 days, last answer and last error
- **configuration:** "Test the connection" button; connection status checked without spending tokens; requests sent with logging off (`store: false`)
- **i18n:** English, French, German and Spanish for the manifest, the runtime texts, the documentation and the README

[0.1.0]: https://github.com/William-De71/gladys-google-gemini/releases/tag/v0.1.0
