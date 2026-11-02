// -----------------------------------------------------------------------------
// Dashboard widget of the Google Gemini integration.
//
//   - `usage`  what the assistant consumed through Gemini: requests and
//              tokens of the day, tokens of the month, errors of the day
//              (tiles); tokens per day over 30 days (bar chart); the models,
//              the last answer and the last error (status); a link to the
//              usage page of Google AI Studio, the reference for the bill.
//
// Counted by the integration from the `usage` of every answer (usage.js):
// requests made outside Gladys with the same key are not in it. Every text
// exists in the four languages (the content is cached per language). Budget
// of a card: 8 components, 1 main one, 6 tiles, 2 texts (1 body), 1 status,
// 4 buttons.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { modelName, resolveModel } from './config.js';
import { ago, formatNumber, t } from './i18n.js';
import { formatTime } from './time.js';

export const WIDGETS = { USAGE: 'usage' };
const TTL_SECONDS = 60;
export const CONSOLE_URL = 'https://aistudio.google.com/usage';

/**
 * @description Truncate a text to a bound, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - The bound.
 * @returns {string} The text.
 */
function clip(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * @description A token count, short: "850", "12.4K" / "12,4 k".
 * @param {number} value - Tokens.
 * @param {string} language - The language.
 * @returns {string} The text (≤ 12 characters).
 */
export function compactTokens(value, language) {
  const number = Number.isFinite(value) ? value : 0;
  return clip(
    new Intl.NumberFormat(['en', 'fr', 'de', 'es'].includes(language) ? language : 'en', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(number),
    12,
  );
}

/**
 * @description The "usage" widget.
 * @param {object} options - Options.
 * @param {object} options.snapshot - `usage.snapshot()`.
 * @param {object} options.config - The normalized config.
 * @param {object|null} options.failing - `events.state()`.
 * @param {string} options.language - The user language.
 * @param {number} options.now - Now (ms).
 * @param {string} [options.timeZone] - The timezone of Gladys.
 * @returns {object} The content.
 */
export function buildUsageWidget({ snapshot, config, failing, language, now, timeZone }) {
  const time = (instant) => formatTime(instant, { language, timeZone, now });
  const chat = resolveModel(config, 'model');
  const router = resolveModel(config, 'fast_model');
  const components = [];

  components.push({
    type: 'text',
    variant: 'caption',
    text: clip(
      chat === router
        ? modelName(chat ?? '–')
        : `${modelName(chat ?? '–')} · ${t('rowRouterShort', language)} ${modelName(router ?? '–')}`,
      80,
    ),
  });

  if (!config.api_key) {
    components.push({ type: 'text', variant: 'body', text: clip(t('widgetNoKey', language), 300) });
  }

  const today = snapshot.today;
  components.push(
    {
      type: 'value',
      label: clip(t('tileRequestsToday', language), 24),
      value: today.requests,
      icon: 'message-circle',
      color: WIDGET_COLORS.PRIMARY,
    },
    {
      type: 'value',
      label: clip(t('tileTokensToday', language), 24),
      value: compactTokens(today.prompt_tokens + today.completion_tokens, language),
      icon: 'cpu',
      color: WIDGET_COLORS.INFO,
    },
    {
      type: 'value',
      label: clip(t('tileTokensMonth', language), 24),
      value: compactTokens(
        snapshot.month.prompt_tokens + snapshot.month.completion_tokens,
        language,
      ),
      icon: 'calendar',
      color: WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      label: clip(t('tileErrorsToday', language), 24),
      value: today.errors,
      icon: 'alert-triangle',
      color: today.errors > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    },
  );

  // Without a key the body text takes the place of the chart (8 components).
  if (config.api_key && snapshot.days.some((day) => day.tokens > 0)) {
    components.push({
      type: 'chart',
      chart_type: 'bar',
      title: clip(t('chartTitle', language), 60),
      unit: 'tokens',
      series: [
        {
          name: t('chartSeries', language),
          points: snapshot.days.map((day) => ({ t: `${day.date}T12:00:00Z`, v: day.tokens })),
        },
      ],
    });
  }

  const items = [];
  if (failing) {
    items.push({
      label: clip(t('rowState', language), 40),
      value: clip(t('stateFailing', language, { time: time(failing.since) }), 40),
      color: WIDGET_COLORS.DANGER,
    });
  } else {
    items.push({
      label: clip(t('rowState', language), 40),
      value: clip(t(config.api_key ? 'stateOk' : 'stateNoKey', language), 40),
      color: config.api_key ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
    });
  }
  const last = snapshot.last_request;
  items.push({
    label: clip(t('rowLastRequest', language), 40),
    value: clip(
      last
        ? t('valueLastRequest', language, {
            use: t(`use_${last.use}`, language),
            ago: ago(last.at, now, language),
          })
        : t('never', language),
      40,
    ),
    color: !last ? WIDGET_COLORS.NEUTRAL : last.ok ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
  });
  if (last?.ok && last.ms) {
    items.push({
      label: clip(t('rowDuration', language), 40),
      value: clip(`${formatNumber(last.ms / 1000, language, 1)} s`, 40),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  const error = snapshot.last_error;
  if (error) {
    items.push({
      label: clip(t('rowLastError', language), 40),
      value: clip(`${time(error.at)} · ${t(`kind_${error.kind}`, language)}`, 40),
      color: WIDGET_COLORS.WARNING,
    });
  }
  components.push({ type: 'status', items });

  components.push({
    type: 'button',
    label: clip(t('buttonConsole', language), 24),
    icon: 'external-link',
    style: 'secondary',
    link: { url: CONSOLE_URL },
  });

  return { ttl_seconds: TTL_SECONDS, components };
}
