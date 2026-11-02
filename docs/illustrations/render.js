// Renders integration widget contents the way the Gladys front does
// (front/src/components/boxs/external-widget: ExternalWidgetBox,
// WidgetComponents, widgetContentUtils), in plain DOM, with the same slots,
// order and class names. Only the components these widgets use: text, value,
// gauge, chart (ApexCharts, as the front), card-list (list display), status, button.
// A tile or a chart bound to a device feature arrives with its value or its
// series filled in by gen.mjs, as the core does from the feature.
// Query: ?lang=fr&cards=live,today,schedule&theme=dark
/* global DATA, ApexCharts */
const params = new URLSearchParams(location.search);
const LANG = params.get('lang') || 'en';
const CARDS = (params.get('cards') || 'live,today,schedule').split(',');
window.PENDING_CHARTS = 0;

const text = (value) =>
  value && typeof value === 'object' ? (value[LANG] ?? value.en ?? '') : (value ?? '');
const formatNumber = (value) =>
  typeof value === 'number'
    ? new Intl.NumberFormat(LANG, { maximumFractionDigits: 2 }).format(value)
    : text(value);
// widgetContentUtils.formatDate: a calendar date (midnight UTC) shows as the
// day itself, dayjs format `ll` ("Oct 16, 2026"); any other instant with its
// time, format `lll` ("Oct 15, 2026 8:41 AM"), in the browser timezone.
const CALENDAR_DATE = /^(\d{4}-\d{2}-\d{2})(T00:00:00(\.000)?Z)?$/;
const formatDate = (value) => {
  if (!value) return '';
  const calendar = CALENDAR_DATE.exec(value);
  if (calendar) {
    const [year, month, day] = calendar[1].split('-').map(Number);
    return new Intl.DateTimeFormat(LANG, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(year, month - 1, day));
  }
  return new Intl.DateTimeFormat(LANG, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
};
const COLOR = {
  neutral: 'colorNeutral',
  primary: 'colorPrimary',
  success: 'colorSuccess',
  warning: 'colorWarning',
  danger: 'colorDanger',
  info: 'colorInfo',
};
const BADGE_COLOR = {
  primary: 'badgeColorPrimary',
  success: 'badgeColorSuccess',
  warning: 'badgeColorWarning',
  danger: 'badgeColorDanger',
  info: 'badgeColorInfo',
};
const el = (tag, cls, children = []) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
};
const icon = (name, cls = '') => el('i', `fe fe-${name} ${cls}`);

// widgetContentUtils.splitIntoSlots
function splitIntoSlots(components) {
  const slots = { header: [], tiles: [], focal: null, body: null, status: null, buttons: [] };
  for (const c of components) {
    if (c.type === 'text') c.variant === 'body' ? (slots.body = c) : slots.header.push(c);
    else if (c.type === 'value' || c.type === 'gauge') slots.tiles.push(c);
    else if (['chart', 'card-list', 'image'].includes(c.type)) slots.focal = c;
    else if (c.type === 'status') slots.status = c;
    else if (c.type === 'button') slots.buttons.push(c);
  }
  return slots;
}

// WidgetComponents Gauge: a 270° arc between min and max, in SVG.
const SVG_NS = 'http://www.w3.org/2000/svg';
const GAUGE_ARC_LENGTH = (2 * Math.PI * 34 * 270) / 360;
const gauge = (c) => {
  const ratio = Math.min(1, Math.max(0, (c.value - c.min) / (c.max - c.min)));
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `gauge ${COLOR[c.color || 'primary']}`);
  svg.setAttribute('viewBox', '0 0 88 66');
  for (const [cls, length] of [
    ['gaugeTrack', GAUGE_ARC_LENGTH],
    ['gaugeArc', ratio * GAUGE_ARC_LENGTH],
  ]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', cls);
    path.setAttribute('d', 'M 20 62 A 34 34 0 1 1 68 62');
    path.setAttribute('stroke-dasharray', `${length} ${GAUGE_ARC_LENGTH}`);
    svg.append(path);
  }
  return el('div', 'gaugeBox', [
    svg,
    el('div', 'tileValue gaugeValue', [
      formatNumber(c.value),
      c.unit ? el('span', 'tileUnit', text(c.unit)) : null,
    ]),
  ]);
};

const ANNOTATION_COLORS = {
  neutral: '#667081',
  primary: '#467fcf',
  success: '#2e8f5b',
  warning: '#f68f00',
  danger: '#d63939',
  info: '#45aaf2',
};
const annotationLabel = (label, color, textAnchor = 'middle') => ({
  text: label,
  borderColor: color,
  orientation: 'horizontal',
  position: 'top',
  textAnchor,
  style: {
    background: color,
    color: '#fff',
    fontSize: '10px',
    fontWeight: 600,
    padding: { left: 4, right: 4 },
  },
});

function chart(component) {
  const box = el('div', null, [
    component.title ? el('div', 'caption mb-1', text(component.title)) : null,
  ]);
  const target = el('div');
  box.append(target);
  const series = component.series.map((s, i) => ({
    name: text(s.name) || `${i + 1}`,
    data: s.points.map((p) => [new Date(p.t).getTime(), p.v]),
  }));
  let min = Infinity;
  let max = -Infinity;
  series.forEach((s) =>
    s.data.forEach(([t]) => {
      min = Math.min(min, t);
      max = Math.max(max, t);
    }),
  );
  const anchor = (x) => (x > max - (max - min) * 0.08 ? 'end' : 'middle');
  const xaxis = [];
  const points = [];
  for (const a of component.annotations || []) {
    const x = new Date(a.t).getTime();
    const color = ANNOTATION_COLORS[a.color] || ANNOTATION_COLORS.neutral;
    const label = text(a.label);
    if (typeof a.value === 'number') {
      points.push({
        x,
        y: a.value,
        marker: { size: 4, fillColor: '#fff', strokeColor: color, strokeWidth: 2 },
        ...(label ? { label: annotationLabel(label, color, anchor(x)) } : {}),
      });
    } else {
      xaxis.push({
        x,
        borderColor: color,
        strokeDashArray: 0,
        ...(label ? { label: annotationLabel(label, color, anchor(x)) } : {}),
      });
    }
  }
  const yAxisFormatter = (value) => {
    if (value === null || value === undefined || Number.isNaN(value)) return value;
    if (value === 0) return '0';
    const rounded = parseFloat(value.toPrecision(4));
    if (Math.abs(rounded) < 0.001 || Math.abs(rounded) >= 1e9) return rounded.toExponential(2);
    return value.toFixed(2);
  };
  const isBar = component.chart_type === 'bar';
  const isArea = component.chart_type === 'area';
  const options = {
    chart: {
      locales: window.APEX_LOCALES,
      defaultLocale: LANG,
      type: isBar ? 'bar' : isArea ? 'area' : 'line',
      fontFamily: 'inherit',
      height: 200,
      parentHeightOffset: 0,
      sparkline: { enabled: false },
      toolbar: { show: false },
      animations: { enabled: false },
      ...(isBar ? { stacked: true, zoom: { enabled: true } } : {}),
    },
    ...(isBar ? { plotOptions: { bar: { columnWidth: '90%' } } } : {}),
    dataLabels: { enabled: false },
    fill: isArea
      ? { type: 'gradient', gradient: { opacityFrom: 0.45, opacityTo: 0.05 } }
      : { opacity: 1 },
    ...(isBar ? {} : { stroke: { width: 2, curve: isArea ? 'smooth' : 'stepline' } }),
    series,
    grid: isBar
      ? {
          padding: { top: -20, right: 0, left: -4, bottom: -4 },
          strokeDashArray: 4,
          xaxis: { lines: { show: true } },
        }
      : { strokeDashArray: 4, padding: { left: -4 } },
    xaxis: {
      labels: { padding: 0, datetimeUTC: false },
      tooltip: { enabled: false },
      axisBorder: { show: false },
      type: 'datetime',
    },
    yaxis: { labels: { padding: 4, formatter: yAxisFormatter } },
    colors: ['#316cbe', '#d63031', '#00b894', '#fdcb6e', '#6c5ce7'],
    legend: { show: series.length > 1, position: 'bottom' },
    annotations: { xaxis, points },
  };
  requestAnimationFrame(() => {
    window.PENDING_CHARTS += 1;
    new ApexCharts(target, options).render().then(() => {
      window.PENDING_CHARTS -= 1;
    });
  });
  return box;
}

const tiles = (components) =>
  el(
    'div',
    'tilesBox',
    el(
      'div',
      `tiles tilesCount${Math.min(components.length, 6)}`,
      components.map((c) =>
        el('div', 'tile', [
          c.icon && c.type === 'value' ? icon(c.icon, `tileIcon ${COLOR[c.color] || ''}`) : null,
          c.type === 'gauge'
            ? gauge(c)
            : el('span', `tileValue ${COLOR[c.color] || ''}`, [
                formatNumber(c.value),
                c.unit ? el('span', 'tileUnit', text(c.unit)) : null,
              ]),
          c.label ? el('span', 'tileLabel', text(c.label)) : null,
        ]),
      ),
    ),
  );

// LazyWidgetImage, already loaded: the bytes served by onWidgetGetImage.
const image = (key, alt, fit) => {
  const img = el('img', fit === 'contain' ? 'imageContain' : 'imageCover');
  img.src = DATA.images[key];
  img.alt = alt;
  return el('div', 'imageFrame', img);
};

// WidgetCardList (list display): the date replaces the subtitle.
const cardList = (component) =>
  el(
    'div',
    null,
    el(
      'div',
      'cardList',
      component.items.map((item) => {
        const clickable = Boolean(item.description) || (item.links && item.links.length > 0);
        const meta = item.date ? formatDate(item.date) : text(item.subtitle);
        const node = el('button', `cardListItem ${clickable ? 'clickable' : ''}`, [
          item.image ? image(item.image, text(item.title)) : null,
          el('div', 'cardListText', [
            el('span', 'cardTitle', text(item.title)),
            meta ? el('span', 'cardMeta', meta) : null,
            item.badge
              ? el('span', `wbadge ${BADGE_COLOR[item.badge.color] || ''}`, text(item.badge.text))
              : null,
          ]),
        ]);
        node.type = 'button';
        node.disabled = !clickable;
        return node;
      }),
    ),
  );

const statusList = (component) =>
  el(
    'ul',
    'statusList',
    component.items.map((item) =>
      el('li', 'statusRow', [
        item.icon
          ? icon(item.icon, `statusIcon ${COLOR[item.color || 'neutral']}`)
          : el('span', `statusDot ${COLOR[item.color || 'neutral']}`),
        el('span', 'statusLabel', text(item.label)),
        el('span', 'statusValue', formatNumber(item.value)),
      ]),
    ),
  );

const buttons = (components) =>
  el(
    'div',
    'buttons',
    components.map((c) => {
      const cls = ['button'];
      if (c.style === 'primary') cls.push('buttonPrimary');
      if (c.style === 'danger') cls.push('buttonDanger');
      const node = el('button', cls.join(' '), [
        el('span', 'buttonIcon', icon(c.icon || 'play')),
        el('span', 'buttonLabel', text(c.label)),
      ]);
      node.type = 'button';
      return node;
    }),
  );

function card(name) {
  const content = DATA.contents[LANG][name];
  const { icon: cardIcon, label } = DATA.cards[name];
  const slots = splitIntoSlots(content.components);
  return el('div', 'card', [
    el(
      'div',
      'card-header',
      el('h3', 'card-title', [icon(cardIcon || 'grid'), el('span', 'm-1', text(label))]),
    ),
    el(
      'div',
      'card-body',
      el('div', 'slots', [
        slots.header.length
          ? el(
              'div',
              'header',
              slots.header.map((c) =>
                el('div', c.variant === 'heading' ? 'heading' : 'caption', text(c.text)),
              ),
            )
          : null,
        slots.tiles.length ? tiles(slots.tiles) : null,
        slots.focal && slots.focal.type === 'chart' ? chart(slots.focal) : null,
        slots.focal && slots.focal.type === 'card-list' ? cardList(slots.focal) : null,
        slots.focal && slots.focal.type === 'image'
          ? image(slots.focal.key, text(slots.focal.alt), slots.focal.fit)
          : null,
        slots.body ? el('p', 'body', text(slots.body.text)) : null,
        slots.status ? statusList(slots.status) : null,
        slots.buttons.length ? buttons(slots.buttons) : null,
      ]),
    ),
  ]);
}

const row = document.getElementById('row');
for (const name of CARDS) {
  row.append(el('div', 'col', card(name)));
}
