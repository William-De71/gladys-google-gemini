// -----------------------------------------------------------------------------
// Times shown to the user (the widget, the status): in the timezone of the
// Gladys instance (TZ, given by the supervisor), else UTC. Intl only, no
// dependency.
// -----------------------------------------------------------------------------

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * @description The timezone of the instance.
 * @returns {string|undefined} An IANA name, undefined for the system one.
 */
function defaultTimeZone() {
  return process.env.TZ || undefined;
}

/**
 * @description Whether a text is a timezone Intl knows.
 * @param {unknown} value - "Europe/Paris", "Australia/Sydney".
 * @returns {boolean} True when valid.
 */
function isTimeZone(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 64) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en', { timeZone: value.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * @description The timezone to use: the one of Gladys when valid, else UTC.
 * @param {string} [zone] - The timezone of Gladys.
 * @returns {string} An IANA name.
 */
function usableTimeZone(zone = defaultTimeZone()) {
  return isTimeZone(zone) ? zone.trim() : 'UTC';
}

const formatters = new Map();
/**
 * @description A cached Intl formatter of the calendar fields in a timezone.
 * @param {string} timeZone - The timezone.
 * @returns {Intl.DateTimeFormat} The formatter.
 */
function partsFormatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    );
  }
  return formatters.get(timeZone);
}

/**
 * @description The local calendar fields of an instant.
 * @param {number} instant - The instant (ms).
 * @param {string} timeZone - The timezone.
 * @returns {{ year: number, month: number, day: number, hour: number, minute: number,
 * second: number, date: string, time: string }} The fields;
 * `date` "2026-10-31", `time` "18:05".
 */
function localParts(instant, timeZone) {
  const fields = Object.fromEntries(
    partsFormatter(timeZone)
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  const pad = (n) => String(n).padStart(2, '0');
  const { year, month, day, hour, minute, second } = fields;
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    date: `${year}-${pad(month)}-${pad(day)}`,
    time: `${pad(hour)}:${pad(minute)}`,
  };
}

/**
 * @description "14:05" in the language and timezone of the user; the day too
 * when it is not today.
 * @param {number|null} instant - The instant (ms).
 * @param {object} [options] - `{ language, timeZone, now }`.
 * @returns {string} The time, '' when none.
 */
function formatTime(instant, { language = 'en', timeZone = defaultTimeZone(), now } = {}) {
  if (!Number.isFinite(instant)) {
    return '';
  }
  const locale = language === 'en' ? 'en-GB' : language;
  const sameDay =
    !Number.isFinite(now) || localParts(instant, timeZone).date === localParts(now, timeZone).date;
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    ...(sameDay ? {} : { weekday: 'short', day: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant));
}

export {
  MINUTE_MS,
  HOUR_MS,
  DAY_MS,
  defaultTimeZone,
  isTimeZone,
  usableTimeZone,
  localParts,
  formatTime,
};
