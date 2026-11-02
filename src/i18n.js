// -----------------------------------------------------------------------------
// Texts of the integration, in English, French, German and Spanish (English
// fallback).
//
// The manifest carries its own labels; these are the texts the code writes at
// runtime: connection statuses, the result of the test button, the widget.
// German says "du", Spanish "usted", like Gladys. Model names are never
// translated.
// -----------------------------------------------------------------------------

const LANGUAGES = ['en', 'fr', 'de', 'es'];

const TEXTS = {
  // connection status and test action
  statusNoKey: {
    en: 'No Gemini API key: create one in Google AI Studio (aistudio.google.com/apikey) and paste it in the configuration.',
    fr: 'Pas de clé d’API Gemini : créez-en une dans Google AI Studio (aistudio.google.com/apikey) et collez-la dans la configuration.',
    de: 'Kein Gemini-API-Schlüssel: Erstelle einen in Google AI Studio (aistudio.google.com/apikey) und füge ihn in die Konfiguration ein.',
    es: 'No hay clave de API de Gemini: cree una en Google AI Studio (aistudio.google.com/apikey) y péguela en la configuración.',
  },
  statusBadKey: {
    en: 'Google refused the API key: check it, or create a new one in Google AI Studio.',
    fr: 'Google a refusé la clé d’API : vérifiez-la, ou créez-en une nouvelle dans Google AI Studio.',
    de: 'Google hat den API-Schlüssel abgelehnt: Prüfe ihn oder erstelle einen neuen in Google AI Studio.',
    es: 'Google ha rechazado la clave de API: compruébela o cree una nueva en Google AI Studio.',
  },
  statusBilling: {
    en: 'Google refuses to run {model} for this project: free tier unavailable or billing to set up, see Google AI Studio.',
    fr: 'Google refuse de faire tourner {model} pour ce projet : offre gratuite indisponible ou facturation à configurer, voyez Google AI Studio.',
    de: 'Google führt {model} für dieses Projekt nicht aus: kostenloser Tarif nicht verfügbar oder Abrechnung einzurichten, siehe Google AI Studio.',
    es: 'Google se niega a ejecutar {model} para este proyecto: nivel gratuito no disponible o facturación por configurar, vea Google AI Studio.',
  },
  statusNoModel: {
    en: '{model} is not available to this API key: choose another model.',
    fr: '{model} n’est pas disponible pour cette clé d’API : choisissez un autre modèle.',
    de: '{model} ist für diesen API-Schlüssel nicht verfügbar: Wähle ein anderes Modell.',
    es: '{model} no está disponible para esta clave de API: elija otro modelo.',
  },
  statusNoCustom: {
    en: 'A model is set to “Other model” but the model id field is empty.',
    fr: 'Un modèle est réglé sur « Autre modèle » mais le champ de l’identifiant est vide.',
    de: 'Ein Modell steht auf „Anderes Modell“, aber das Feld der Modell-ID ist leer.',
    es: 'Un modelo está en «Otro modelo» pero el campo del identificador está vacío.',
  },
  statusNoGenerate: {
    en: '{model} does not generate text: the assistant cannot use it.',
    fr: '{model} ne génère pas de texte : l’assistant ne peut pas l’utiliser.',
    de: '{model} erzeugt keinen Text: Der Assistent kann es nicht verwenden.',
    es: '{model} no genera texto: el asistente no puede usarlo.',
  },
  statusPaidOnly: {
    en: '{model} is not on the free tier: it needs a project with billing.',
    fr: '{model} n’est pas dans l’offre gratuite : il faut un projet avec facturation.',
    de: '{model} ist nicht im kostenlosen Tarif: Es braucht ein Projekt mit Abrechnung.',
    es: '{model} no está en el nivel gratuito: necesita un proyecto con facturación.',
  },
  statusRateLimited: {
    en: 'Gemini rate limit reached: try again in a moment, or link a billing account for higher limits.',
    fr: 'Limite de requêtes Gemini atteinte : réessayez dans un instant, ou liez un compte de facturation pour des limites plus hautes.',
    de: 'Gemini-Anfragelimit erreicht: Versuche es gleich noch einmal oder verknüpfe ein Abrechnungskonto für höhere Limits.',
    es: 'Se ha alcanzado el límite de solicitudes de Gemini: inténtelo de nuevo en un momento o vincule una cuenta de facturación para tener límites más altos.',
  },
  statusUnreachable: {
    en: 'Cannot reach generativelanguage.googleapis.com: check the internet access of Gladys.',
    fr: 'Impossible de joindre generativelanguage.googleapis.com : vérifiez l’accès Internet de Gladys.',
    de: 'generativelanguage.googleapis.com ist nicht erreichbar: Prüfe den Internetzugang von Gladys.',
    es: 'No se puede acceder a generativelanguage.googleapis.com: compruebe el acceso a Internet de Gladys.',
  },
  statusApiError: {
    en: 'Gemini API error: {detail}',
    fr: 'Erreur de l’API Gemini : {detail}',
    de: 'Fehler der Gemini-API: {detail}',
    es: 'Error de la API de Gemini: {detail}',
  },
  statusInitFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: 'L’initialisation a échoué, consultez les journaux de l’intégration.',
    de: 'Die Initialisierung ist fehlgeschlagen, prüfe die Protokolle der Integration.',
    es: 'La inicialización ha fallado, consulte los registros de la integración.',
  },
  role_chat: { en: 'Chat', fr: 'Discussion', de: 'Chat', es: 'Chat' },
  role_router: { en: 'Router', fr: 'Routeur', de: 'Router', es: 'Enrutador' },
  testAnswered: {
    en: '{model} answered in {seconds} s.',
    fr: '{model} a répondu en {seconds} s.',
    de: '{model} hat in {seconds} s geantwortet.',
    es: '{model} ha respondido en {seconds} s.',
  },

  // widget
  rowRouterShort: { en: 'router', fr: 'routeur', de: 'Router', es: 'enrutador' },
  widgetNoKey: {
    en: 'No Gemini API key yet: add it in the configuration of the integration, then choose Gemini in Settings, Artificial Intelligence.',
    fr: 'Pas encore de clé d’API Gemini : ajoutez-la dans la configuration de l’intégration, puis choisissez Gemini dans Paramètres, Intelligence artificielle.',
    de: 'Noch kein Gemini-API-Schlüssel: Füge ihn in der Konfiguration der Integration hinzu und wähle dann Gemini unter Einstellungen, Künstliche Intelligenz.',
    es: 'Todavía no hay clave de API de Gemini: añádala en la configuración de la integración y luego elija Gemini en Ajustes, Inteligencia artificial.',
  },
  tileRequestsToday: {
    en: 'Requests today',
    fr: 'Requêtes du jour',
    de: 'Anfragen heute',
    es: 'Solicitudes hoy',
  },
  tileTokensToday: {
    en: 'Tokens today',
    fr: 'Jetons du jour',
    de: 'Tokens heute',
    es: 'Tokens hoy',
  },
  tileTokensMonth: {
    en: 'Tokens this month',
    fr: 'Jetons du mois',
    de: 'Tokens im Monat',
    es: 'Tokens del mes',
  },
  tileErrorsToday: {
    en: 'Errors today',
    fr: 'Erreurs du jour',
    de: 'Fehler heute',
    es: 'Errores hoy',
  },
  chartTitle: {
    en: 'Tokens per day',
    fr: 'Jetons par jour',
    de: 'Tokens pro Tag',
    es: 'Tokens por día',
  },
  chartSeries: { en: 'Tokens', fr: 'Jetons', de: 'Tokens', es: 'Tokens' },
  rowState: { en: 'Gemini', fr: 'Gemini', de: 'Gemini', es: 'Gemini' },
  stateOk: { en: 'Answering', fr: 'Répond', de: 'Antwortet', es: 'Responde' },
  stateNoKey: {
    en: 'No API key',
    fr: 'Pas de clé d’API',
    de: 'Kein API-Schlüssel',
    es: 'Sin clave de API',
  },
  stateFailing: {
    en: 'Failing since {time}',
    fr: 'En erreur depuis {time}',
    de: 'Fehler seit {time}',
    es: 'Con errores desde {time}',
  },
  rowLastRequest: {
    en: 'Last request',
    fr: 'Dernière requête',
    de: 'Letzte Anfrage',
    es: 'Última solicitud',
  },
  valueLastRequest: {
    en: '{use}, {ago}',
    fr: '{use}, {ago}',
    de: '{use}, {ago}',
    es: '{use}, {ago}',
  },
  rowDuration: {
    en: 'Answered in',
    fr: 'Réponse en',
    de: 'Antwort in',
    es: 'Respuesta en',
  },
  rowLastError: {
    en: 'Last error',
    fr: 'Dernière erreur',
    de: 'Letzter Fehler',
    es: 'Último error',
  },
  buttonConsole: {
    en: 'AI Studio usage',
    fr: 'Conso AI Studio',
    de: 'AI-Studio-Nutzung',
    es: 'Uso en AI Studio',
  },
  use_chat: { en: 'chat', fr: 'discussion', de: 'Chat', es: 'chat' },
  use_router: { en: 'router', fr: 'routeur', de: 'Router', es: 'enrutador' },
  use_digest: {
    en: 'weekly digest',
    fr: 'résumé hebdo',
    de: 'Wochenrückblick',
    es: 'resumen semanal',
  },
  kind_auth: {
    en: 'key refused',
    fr: 'clé refusée',
    de: 'Schlüssel abgelehnt',
    es: 'clave rechazada',
  },
  kind_billing: {
    en: 'billing',
    fr: 'facturation',
    de: 'Abrechnung',
    es: 'facturación',
  },
  kind_model: {
    en: 'model unavailable',
    fr: 'modèle indisponible',
    de: 'Modell nicht verfügbar',
    es: 'modelo no disponible',
  },
  kind_rate_limit: {
    en: 'rate limit',
    fr: 'limite de requêtes',
    de: 'Anfragelimit',
    es: 'límite de solicitudes',
  },
  kind_request: {
    en: 'request refused',
    fr: 'requête refusée',
    de: 'Anfrage abgelehnt',
    es: 'solicitud rechazada',
  },
  kind_server: {
    en: 'Gemini error',
    fr: 'erreur Gemini',
    de: 'Gemini-Fehler',
    es: 'error de Gemini',
  },
  kind_unreachable: {
    en: 'unreachable',
    fr: 'injoignable',
    de: 'nicht erreichbar',
    es: 'inaccesible',
  },
  kind_timeout: { en: 'too slow', fr: 'trop lent', de: 'zu langsam', es: 'demasiado lento' },

  // durations
  never: { en: 'Never', fr: 'Jamais', de: 'Nie', es: 'Nunca' },
  justNow: { en: 'just now', fr: 'à l’instant', de: 'gerade eben', es: 'ahora mismo' },
  minutesAgo: {
    en: '{n} min ago',
    fr: 'il y a {n} min',
    de: 'vor {n} Min.',
    es: 'hace {n} min',
  },
  hoursAgo: { en: '{n} h ago', fr: 'il y a {n} h', de: 'vor {n} Std.', es: 'hace {n} h' },
  daysAgo: {
    en: '{n} days ago',
    fr: 'il y a {n} jours',
    de: 'vor {n} Tagen',
    es: 'hace {n} días',
  },
};

/**
 * @description Whether a value is a language of the integration.
 * @param {unknown} value - The value.
 * @returns {boolean} True for en, fr, de, es.
 */
function isLanguage(value) {
  return LANGUAGES.includes(value);
}

/**
 * @description A text in a language, with its values.
 * @param {string} key - A TEXTS key.
 * @param {string} language - The language (English when unknown).
 * @param {object} [values] - The values of the `{placeholders}`.
 * @returns {string} The text, the key itself when unknown.
 */
function t(key, language, values = {}) {
  const entry = TEXTS[key];
  if (!entry) {
    return key;
  }
  const template = entry[isLanguage(language) ? language : 'en'] ?? entry.en;
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    values[name] === undefined || values[name] === null ? '' : String(values[name]),
  );
}

/**
 * @description A text in the four languages.
 * @param {string|Function} key - A TEXTS key, or `(language) => text`.
 * @param {object|Function} [values] - The values, or `(language) => values`.
 * @returns {object} `{ en, fr, de, es }`.
 */
function all(key, values = {}) {
  return Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      typeof key === 'function'
        ? key(language)
        : t(key, language, typeof values === 'function' ? values(language) : values),
    ]),
  );
}

/**
 * @description How long ago an instant was: "just now", "12 min ago", "3 h ago".
 * @param {number} at - The instant, in ms (0: never).
 * @param {number} now - Now, in ms.
 * @param {string} language - The language.
 * @returns {string} The text.
 */
function ago(at, now, language) {
  if (!at) {
    return t('never', language);
  }
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) {
    return t('justNow', language);
  }
  if (minutes < 60) {
    return t('minutesAgo', language, { n: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return t('hoursAgo', language, { n: hours });
  }
  return t('daysAgo', language, { n: Math.floor(hours / 24) });
}

/**
 * @description A number in the format of a language.
 * @param {number} value - The number.
 * @param {string} language - The language.
 * @param {number} [decimals] - The decimals at most.
 * @returns {string} "12,5" in French.
 */
function formatNumber(value, language, decimals = 1) {
  if (!Number.isFinite(value)) {
    return '–';
  }
  return new Intl.NumberFormat(isLanguage(language) ? language : 'en', {
    maximumFractionDigits: decimals,
  }).format(value);
}

export { LANGUAGES, TEXTS, isLanguage, t, all, ago, formatNumber };
