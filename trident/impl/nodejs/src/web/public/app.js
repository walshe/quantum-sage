// Trident dashboard client.
//
// Talks to the engine's web server:
//   - WebSocket /events         → live event tail + bootstrap snapshot
//   - GET /signals/latest       → pre-fill form with most recent today's signal
//   - POST /signals             → submit a new / updated signal as JSON
//
// Single file, no framework, no build step.

const $ = sel => document.querySelector(sel);

// Strip any absolute path, keep just the filename.
const baseName = p => (p ? String(p).split('/').pop() : '');

// ---------------------------------------------------------------------------
// i18n: English (source) ↔ Italian (window.TRIDENT_I18N from i18n.js)
// ---------------------------------------------------------------------------
const I18N_LANG_KEY = 'trident-lang';
let currentLang = localStorage.getItem(I18N_LANG_KEY) || 'en';

// tx() returns the translation for a given English source string in the
// current language. Falls back to English if no translation is present.
// Use it whenever JS sets user-visible text (chip values, status messages).
function tx(s, lang = currentLang) {
  if (lang === 'en' || s == null) return s;
  const dict = (window.TRIDENT_I18N || {})[lang] || {};
  return dict[s] ?? s;
}

// Snapshot of original English text per element. Captured once on first
// applyLang() call so we can always translate from English regardless of
// what the DOM currently shows.
const _i18nTextSnap = new WeakMap();
const _i18nTipSnap = new WeakMap();
const _i18nTitleSnap = new WeakMap();

const I18N_TEXT_SELECTOR = [
  'label', 'legend', 'option', 'button', 'h2', 'summary',
  '.chip-label', '.chip-value', '.brand-name', '.log-sub',
  '.confirm-sub', '.optional', '.field-note',
  // Help dialog body — scope to that subtree so we don't translate every
  // paragraph in the whole UI by accident.
  '#help-dialog-body h3', '#help-dialog-body dt', '#help-dialog-body dd',
  '#help-dialog-body p', '#help-dialog-body li',
].join(',');

function applyLang(lang) {
  currentLang = lang;
  try { localStorage.setItem(I18N_LANG_KEY, lang); } catch { /* private mode */ }

  // Translate visible text nodes inside known label-bearing elements.
  document.querySelectorAll(I18N_TEXT_SELECTOR).forEach(el => {
    if (!_i18nTextSnap.has(el)) {
      const snap = [];
      el.childNodes.forEach(n => {
        if (n.nodeType === Node.TEXT_NODE) snap.push(n.nodeValue);
      });
      _i18nTextSnap.set(el, snap);
    }
    const snap = _i18nTextSnap.get(el);
    let i = 0;
    el.childNodes.forEach(n => {
      if (n.nodeType !== Node.TEXT_NODE) return;
      const orig = snap[i++] ?? '';
      const trimmed = orig.trim();
      if (!trimmed) return;
      const lead = orig.match(/^\s*/)[0];
      const trail = orig.match(/\s*$/)[0];
      n.nodeValue = lead + tx(trimmed, lang) + trail;
    });
  });

  // Translate tooltip data-tip attributes.
  document.querySelectorAll('[data-tip]').forEach(el => {
    if (!_i18nTipSnap.has(el)) _i18nTipSnap.set(el, el.dataset.tip);
    el.dataset.tip = tx(_i18nTipSnap.get(el), lang);
  });

  // Translate title attributes (used on the lang toggle itself).
  document.querySelectorAll('[title]').forEach(el => {
    if (!_i18nTitleSnap.has(el)) _i18nTitleSnap.set(el, el.getAttribute('title'));
    el.setAttribute('title', tx(_i18nTitleSnap.get(el), lang));
  });

  // Lang toggle button shows the OTHER language as its label.
  const btn = document.getElementById('btn-lang');
  if (btn) btn.textContent = lang === 'en' ? 'IT' : 'EN';

  document.documentElement.lang = lang;
}

function toggleLang() {
  applyLang(currentLang === 'en' ? 'it' : 'en');
}

// ---------------------------------------------------------------------------
// Status band state
// ---------------------------------------------------------------------------
const state = {
  engine: 'disconnected',
  position: 'idle',
  dailyLocked: false,
  currentSignal: null,
  openPosition: null, // bootstrap snapshot of an in-flight position, if any
  history: [],
  pendingSubmitName: null, // filename we're waiting to hear back about as SIGNAL_LOADED
};

function setEngineChip(s) {
  state.engine = s;
  const chip = $('#engine-chip');
  chip.dataset.state = s;
  const enLabel =
    s === 'connected' ? 'Connected' :
    s === 'reconnecting' ? 'Reconnecting…' : 'Disconnected';
  const valEl = chip.querySelector('.chip-value');
  valEl.textContent = tx(enLabel);
  // Reset i18n snapshot so the next applyLang() works against the new English source.
  _i18nTextSnap.delete(valEl);
}
function setStateChip(s, locked) {
  state.position = s;
  state.dailyLocked = !!locked;
  const chip = $('#state-chip');
  const enLabel = locked ? 'locked' : s;
  chip.dataset.state = locked ? 'blocked' : s;
  const valEl = chip.querySelector('.chip-value');
  valEl.textContent = tx(enLabel);
  _i18nTextSnap.delete(valEl);
}
function renderSignalCard() {
  const s = state.currentSignal;
  const el = $('#signal-card-body');
  if (!s) { el.textContent = tx('None loaded'); return; }
  const filename = baseName(s.filePath) || '(unknown)';
  const bias = s.biasDirection ? `${s.biasDirection}/${s.biasConfidence ?? '?'}` : '—';
  el.textContent = `${filename}\nseq ${s.updateSeq} • DVS ${s.dvs} • VWAP ${s.vwap} • bias ${bias}`;
}

// ---------------------------------------------------------------------------
// Log pane
// ---------------------------------------------------------------------------
function severityClass(data) {
  if (data.actionRequired) return 'sev-action';
  if (data.severity === 'error') return 'sev-error';
  if (data.type === 'DAILY_LOCK') return 'sev-lock';
  if (data.type === 'SIGNAL_LOADED' || data.type === 'SIGNAL_INVALID' || data.type === 'SIGNAL_WARNING') return 'sev-signal';
  if (data.type === 'SETUP_READY' || data.type === 'NO_TRADE_SETUP' || data.type === 'DVS_GATE_BLOCKED') return 'sev-setup';
  return 'sev-info';
}

function appendLogRow(data) {
  // Coalesce repeats: if the new row has the same tag + headline as the last,
  // bump a counter on the existing row instead of appending a duplicate.
  const log = $('#log');
  const last = log.lastElementChild;
  if (last && last.dataset.tag === data.tag && last.dataset.head === data.headline) {
    const count = (parseInt(last.dataset.count || '1', 10)) + 1;
    last.dataset.count = String(count);
    let badge = last.querySelector('.count');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'count';
      last.querySelector('.head').after(badge);
    }
    badge.textContent = `×${count}`;
    // Update timestamp to the latest occurrence.
    last.querySelector('.ts').textContent = `[${data.timestamp}]`;
    return;
  }

  const li = document.createElement('li');
  li.className = severityClass(data);
  li.dataset.tag = data.tag;
  li.dataset.head = data.headline;

  const ts = document.createElement('span');
  ts.className = 'ts'; ts.textContent = `[${data.timestamp}]`;
  const tag = document.createElement('span');
  tag.className = 'tag'; tag.textContent = `[${data.tag}]`;
  const head = document.createElement('span');
  head.className = 'head'; head.textContent = data.headline;
  li.append(ts, tag, head);

  for (const d of data.detail ?? []) {
    const det = document.createElement('span');
    det.className = 'det'; det.textContent = d;
    li.append(det);
  }
  if (data.action) {
    const act = document.createElement('span');
    act.className = 'act'; act.textContent = `>>> ACTION: ${data.action}`;
    li.append(act);
  }
  log.append(li);
  // Auto-scroll the pane (not the whole page).
  const pane = document.querySelector('.log-pane');
  pane.scrollTop = pane.scrollHeight;

  if (data.actionRequired && Notification.permission === 'granted') {
    new Notification(`Trident: ${data.tag}`, { body: data.headline });
  }
}

// ---------------------------------------------------------------------------
// WebSocket with auto-reconnect
// ---------------------------------------------------------------------------
let ws = null;
let reconnectAttempt = 0;
function connectWs() {
  setEngineChip(reconnectAttempt === 0 ? 'disconnected' : 'reconnecting');
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/events`);

  ws.addEventListener('open', () => {
    reconnectAttempt = 0;
    setEngineChip('connected');
  });
  ws.addEventListener('close', () => {
    setEngineChip('reconnecting');
    reconnectAttempt++;
    const delayMs = Math.min(5000, 500 * Math.pow(2, reconnectAttempt));
    setTimeout(connectWs, delayMs);
  });
  ws.addEventListener('error', () => { /* close handler drives reconnect */ });
  ws.addEventListener('message', evt => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    if (msg.kind === 'bootstrap') handleBootstrap(msg.data);
    else if (msg.kind === 'event') handleEvent(msg.data);
  });
}

function handleBootstrap(b) {
  setStateChip(b.state, b.dailyLocked);
  state.currentSignal = b.currentSignal;
  state.openPosition = b.position ?? null;
  renderSignalCard();

  // Synthesise a log entry that captures the engine's current state so the
  // pane isn't blank on connect. The real event stream will only contain
  // things that happen from this moment onwards.
  const ts = new Date(b.serverTime).toTimeString().slice(0, 8);
  const headline = describeEngineState(b);
  const detail = [];
  if (b.currentSignal) {
    const filename = baseName(b.currentSignal.filePath);
    detail.push(
      `Setup: ${filename} (seq ${b.currentSignal.updateSeq}, DVS ${b.currentSignal.dvs}, VWAP ${b.currentSignal.vwap})`
    );
    // Seed history so Today shows the already-loaded signal even if the tab
    // connected after the engine picked it up.
    state.history.unshift({ ts: ts, tag: 'SIGNAL', text: b.currentSignal.filePath });
    renderHistory();
  }
  if (b.position) {
    detail.push(
      `Position: ${b.position.direction.toUpperCase()} — avg ${b.position.avgEntry}, stop ${b.position.currentStop}, ${b.position.fills} fill(s)`
    );
  }
  appendLogRow({
    timestamp: ts,
    type: 'BOOTSTRAP',
    tag: 'CONNECTED',
    headline,
    detail,
    action: null,
    severity: 'info',
    actionRequired: false,
  });
}

function describeEngineState(b) {
  if (b.dailyLocked) {
    return 'Engine is locked for the day — no more trades.';
  }
  switch (b.state) {
    case 'idle':     return 'Engine is idle — waiting for a setup.';
    case 'watching': return 'Engine is watching — setup loaded, waiting for Entry 1.';
    case 'in_trade': return 'Engine is in a trade.';
    case 'blocked':  return 'Engine is blocked — DVS gate has stopped trading today.';
    case 'closed':   return 'Engine is closed — today\'s trade is finished.';
    default:         return `Engine state: ${b.state}.`;
  }
}

function handleEvent(data) {
  // Price ticks only update the chip — they'd drown the log otherwise.
  if (data.type === 'PRICE_UPDATE') {
    updatePriceChip(data);
    return;
  }
  appendLogRow(data);

  // Update status band based on high-value events.
  const raw = data.raw ?? {};
  switch (data.type) {
    case 'SIGNAL_LOADED':
      state.currentSignal = {
        filePath: raw.filePath,
        updateSeq: raw.signal?.meta?.update_seq,
        dvs: raw.signal?.volatility?.dvs,
        vwap: raw.signal?.vwap?.value,
        biasDirection: raw.signal?.bias?.direction ?? null,
        biasConfidence: raw.signal?.bias?.confidence ?? null,
      };
      renderSignalCard();
      state.history.unshift({ ts: data.timestamp, tag: 'SIGNAL', text: raw.filePath });
      renderHistory();
      // If the UI is waiting on a just-submitted signal, clear the indicator.
      if (state.pendingSubmitName && raw.filePath?.endsWith(state.pendingSubmitName)) {
        setSubmitStatus(`Loaded ${state.pendingSubmitName}`, 'ok');
        state.pendingSubmitName = null;
      }
      setStateChip('watching', state.dailyLocked);
      break;

    case 'SIGNAL_INVALID':
      state.history.unshift({ ts: data.timestamp, tag: 'INVALID', text: raw.filePath });
      renderHistory();
      break;

    case 'SETUP_READY':    setStateChip('watching', state.dailyLocked); break;
    case 'ENTRY_TRIGGERED':setStateChip('in_trade', state.dailyLocked); break;
    case 'POSITION_CLOSED':setStateChip('closed',   state.dailyLocked); state.openPosition = null; break;
    case 'DAILY_LOCK':     setStateChip(state.position, true); break;
    case 'DVS_GATE_BLOCKED': setStateChip('blocked', state.dailyLocked); break;
  }
}

function renderHistory() {
  const list = $('#history-list');
  list.innerHTML = '';
  for (const h of state.history.slice(0, 20)) {
    const li = document.createElement('li');
    li.textContent = `${h.ts}  ${h.tag.padEnd(7)}  ${baseName(h.text)}`;
    list.append(li);
  }
  $('#history-count').textContent = `(${state.history.length})`;
}

function updatePriceChip(data) {
  const el = $('#price-chip-value');
  if (!el) return;
  el.textContent = data.headline; // eventFormatter PRICE_UPDATE headline is fmt(price)
  const chip = $('#price-chip');
  if (chip) chip.dataset.state = 'live';
}

// ---------------------------------------------------------------------------
// Form pre-fill + submit
// ---------------------------------------------------------------------------
async function prefillFromLatest() {
  const res = await fetch('/signals/latest');
  if (res.status === 204) { setSubmitStatus('No prior setup to pre-fill from.', ''); return; }
  if (!res.ok) { setSubmitStatus(`Pre-fill failed: ${res.status}`, 'err'); return; }
  const { signal } = await res.json();
  fillForm(signal);
  setSubmitStatus('Pre-filled from latest setup.', '');
}

// Walk the signal object and set form fields whose name matches the
// dotted path (e.g. meta.dvs → input[name="meta.dvs"]).
//
// `resetDateTime` (default true) overrides meta.date/timestamp/update_seq to
// "now / seq 1" — appropriate when pre-filling from yesterday's or an old
// signal as a starting point. Pass `false` for AI-extracted signals where
// the model has already read the real signal creation time off the chart.
function fillForm(signal, { resetDateTime = true } = {}) {
  const form = $('#signal-form');
  const setField = (path, value) => {
    const el = form.querySelector(`[name="${path}"]`);
    if (!el) return;
    if (value === null || value === undefined) { el.value = ''; return; }
    el.value = value;
  };
  const walk = (obj, prefix) => {
    for (const [k, v] of Object.entries(obj ?? {})) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, path);
      else setField(path, v);
    }
  };
  walk(signal, '');
  if (resetDateTime) {
    const now = new Date();
    setField('meta.date', now.toISOString().slice(0, 10));
    setField('meta.timestamp', now.toTimeString().slice(0, 5));
    setField('meta.update_seq', 1);
  }
}

function resetForNewSignal() {
  $('#signal-form').reset();
  const now = new Date();
  $('#signal-form').elements['meta.date'].value = now.toISOString().slice(0, 10);
  $('#signal-form').elements['meta.timestamp'].value = now.toTimeString().slice(0, 5);
  $('#signal-form').elements['meta.update_seq'].value = 1;
  setSubmitStatus('', '');
}

function bumpUpdateSeq() {
  const el = $('#signal-form').elements['meta.update_seq'];
  el.value = (parseInt(el.value || '0', 10) || 0) + 1;
  const now = new Date();
  $('#signal-form').elements['meta.timestamp'].value = now.toTimeString().slice(0, 5);
}

// Import-from-screenshots: opens the file picker, uploads each selected image
// to /signals/screenshots, and reports back. AI extraction + form prefill are
// not wired yet — for now this just gets the bytes to the server.
function openScreenshotPicker() {
  $('#screenshot-input').click();
}

const MAX_SCREENSHOTS = 3;

async function uploadScreenshots(evt) {
  const input = evt.target;
  const files = Array.from(input.files ?? []);
  if (files.length === 0) return;
  if (files.length > MAX_SCREENSHOTS) {
    setSubmitStatus(
      tx('Too many screenshots — pick up to 3 (IV Smile, intraday chart, optional summary).'),
      'err',
    );
    input.value = '';
    return;
  }

  clearAiBanner();
  openFormModal();
  showAiBusy(
    tx('Uploading screenshots…'),
    tx('Sending {n} image(s) to the server.').replace('{n}', String(files.length)),
  );

  const results = [];
  try {
    let idx = 0;
    for (const f of files) {
      idx++;
      showAiBusy(
        tx('Uploading screenshots…'),
        tx('Image {i} of {n}: {name}').replace('{i}', String(idx)).replace('{n}', String(files.length)).replace('{name}', f.name),
      );
      const res = await fetch('/signals/screenshots', {
        method: 'POST',
        headers: {
          'content-type': f.type || 'application/octet-stream',
          'x-filename': encodeURIComponent(f.name),
        },
        body: f,
      });
      if (!res.ok) throw new Error(`${f.name}: ${res.status}`);
      results.push(await res.json());
    }
  } catch (err) {
    hideAiBusy();
    setSubmitStatus(`Upload failed: ${err.message}`, 'err');
    input.value = '';
    return;
  }

  showAiBusy(
    tx('AI is reading the screenshots…'),
    tx('Extracting levels, ranges, DVS, and VWAP. This usually takes 5–20 seconds.'),
  );

  let extracted;
  try {
    const res = await fetch('/signals/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filenames: results.map(r => r.filename) }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 503) {
      hideAiBusy();
      renderAiBanner({
        kind: 'info',
        title: tx('AI extraction unavailable'),
        body: tx('Screenshots saved on the server. AI provider is not configured — fill the form manually.'),
      });
      setSubmitStatus(tx('Screenshots uploaded. AI extraction unavailable.'), '');
      input.value = '';
      return;
    }
    if (!res.ok) throw new Error(body.error || `${res.status}`);
    extracted = body;
  } catch (err) {
    hideAiBusy();
    renderAiBanner({
      kind: 'err',
      title: tx('AI extraction failed'),
      body: err.message,
    });
    setSubmitStatus(tx('AI extraction failed — fill the form manually.'), 'err');
    input.value = '';
    return;
  }

  hideAiBusy();
  if (extracted?.signal) fillForm(extracted.signal, { resetDateTime: false });
  renderAiBanner({
    kind: 'ok',
    title: tx('AI pre-fill complete — please review every field before submitting.'),
    notes: extracted.notes ?? [],
    warnings: extracted.warnings ?? [],
  });
  setSubmitStatus(tx('Form pre-filled from screenshots.'), 'ok');
  input.value = '';
}

// ---------------------------------------------------------------------------
// AI busy overlay — covers the form modal during upload + extraction so
// users can't type into half-populated fields and double-clicks are absorbed.
// ---------------------------------------------------------------------------
function showAiBusy(text, sub) {
  const dlg = $('#form-dialog');
  if (!dlg) return;
  dlg.classList.add('is-busy');
  $('#ai-overlay-text').textContent = text ?? '';
  $('#ai-overlay-sub').textContent = sub ?? '';
}
function hideAiBusy() {
  const dlg = $('#form-dialog');
  if (dlg) dlg.classList.remove('is-busy');
}

// ---------------------------------------------------------------------------
// AI banner inside the form modal — green/red/blue strip with notes &
// warnings from the extraction. Cleared whenever a fresh upload begins.
// ---------------------------------------------------------------------------
function clearAiBanner() {
  const b = $('#ai-banner');
  if (b) b.remove();
}

function renderAiBanner({ kind, title, body, notes = [], warnings = [] }) {
  clearAiBanner();
  const form = $('#signal-form');
  const banner = document.createElement('div');
  banner.id = 'ai-banner';
  banner.className = `ai-banner ai-banner--${kind}`;
  const h = document.createElement('div');
  h.className = 'ai-banner-head';
  h.textContent = title;
  banner.append(h);
  if (body) {
    const p = document.createElement('p');
    p.className = 'ai-banner-body';
    p.textContent = body;
    banner.append(p);
  }
  if (warnings.length) {
    const ul = document.createElement('ul');
    ul.className = 'ai-banner-warnings';
    for (const w of warnings) {
      const li = document.createElement('li');
      li.textContent = w;
      ul.append(li);
    }
    banner.append(ul);
  }
  if (notes.length) {
    const det = document.createElement('details');
    det.className = 'ai-banner-notes';
    const sum = document.createElement('summary');
    sum.textContent = tx('Extraction details');
    det.append(sum);
    const ul = document.createElement('ul');
    for (const n of notes) {
      const li = document.createElement('li');
      li.textContent = n;
      ul.append(li);
    }
    det.append(ul);
    banner.append(det);
  }
  form.prepend(banner);
}

function setSubmitStatus(text, kind) {
  const el = $('#submit-status');
  el.textContent = text;
  el.className = kind || '';
}

// ---------------------------------------------------------------------------
// Form modal: clicking New / Update / Pre-fill mutates the form values and
// then opens the form-dialog. The form's own Submit button still fires
// submitForm() which in turn opens the confirm-dialog on top.
// ---------------------------------------------------------------------------
function openFormModal() {
  const dlg = $('#form-dialog');
  if (!dlg.open) dlg.showModal();
}
function closeFormModal() {
  const dlg = $('#form-dialog');
  if (dlg.open) dlg.close();
}

// ---------------------------------------------------------------------------
// Status dialog: read-only "what is the engine doing right now" view.
// Fetches the loaded signal from /signals/latest so values are fresh.
// ---------------------------------------------------------------------------
async function showStatusDialog() {
  const dlg = $('#status-dialog');
  const body = $('#status-dialog-body');
  body.innerHTML = '';
  body.append(buildEngineStateSection(null));

  // Best-effort fetch; if no signal, show a placeholder.
  let loadedSignal = null;
  try {
    const res = await fetch('/signals/latest');
    if (res.ok) {
      const data = await res.json();
      loadedSignal = data.signal ?? null;
    }
  } catch { /* leave loadedSignal null */ }

  if (loadedSignal) {
    const sec = buildSummarySection(loadedSignal);
    sec.querySelector('h3').textContent = tx('Currently loaded setup');
    body.append(sec);
  } else {
    const sec = el('section', { class: 'confirm-section' });
    sec.append(el('h3', { text: tx('Currently loaded setup') }));
    sec.append(el('div', { class: 'confirm-headline', text: tx('No setup loaded today.') }));
    body.append(sec);
  }

  if (!dlg.open) dlg.showModal();
}

function collectForm() {
  // Build SignalFile from dotted-name inputs.
  const form = $('#signal-form');
  const signal = {
    schema_version: '1.0',
    meta: {}, volatility: {}, vwap: {}, ranges: {}, levels: {},
    levels_recal: {
      level_time: null, max_sell_1: null, max_sell_2: null,
      max_buy_1: null,  max_buy_2: null, supporto: null, resistenza: null,
      additional: [],
    },
    bias: {}, invalidation: {},
  };
  const numericFields = new Set([
    'meta.update_seq', 'meta.futures_last', 'meta.cash_last', 'meta.basis',
    'volatility.dvs', 'volatility.dvs_prior', 'volatility.skew',
    'vwap.value',
    'ranges.range_1_up', 'ranges.range_2_up', 'ranges.range_2_down', 'ranges.range_1_down',
    'levels.max_sell_1', 'levels.max_sell_2', 'levels.max_buy_1', 'levels.max_buy_2',
    'levels.supporto', 'levels.resistenza',
    'invalidation.void_above', 'invalidation.void_below',
  ]);
  for (const el of form.elements) {
    if (!el.name || !el.name.includes('.')) continue;
    const [group, key] = el.name.split('.');
    let value = el.value;
    if (value === '') { value = null; }
    else if (numericFields.has(el.name)) { value = Number(value); }
    signal[group][key] = value;
  }
  // levels.additional must be an array.
  signal.levels.additional = [];
  // Drop empty optional fields so the YAML stays clean.
  if (signal.meta.contract == null || signal.meta.contract === '') delete signal.meta.contract;
  if (!signal.bias?.direction) delete signal.bias;
  if (!signal.invalidation.notes) delete signal.invalidation.notes;
  return signal;
}

// Map a server validation message to the form field name(s) it relates to.
// Returns dotted names matching the input `name` attributes (e.g. "meta.basis").
// Empty array = no inline highlight, banner-only.
function fieldsForError(msg) {
  const fields = new Set();
  // Any explicit "section.field" tokens in the message.
  const dotted = msg.match(/\b[a-z_]+\.[a-z_0-9]+\b/g) || [];
  for (const f of dotted) fields.add(f);
  // Heuristics for messages that don't carry a dotted name.
  if (/^basis \(/.test(msg) || /Basis math mismatch/.test(msg)) {
    fields.add('meta.basis'); fields.add('meta.futures_last'); fields.add('meta.cash_last');
  }
  if (/Range ordering invalid/.test(msg)) {
    fields.add('ranges.range_1_down'); fields.add('ranges.range_2_down');
    fields.add('ranges.range_2_up');   fields.add('ranges.range_1_up');
  }
  if (/Buy level ordering invalid/.test(msg)) {
    fields.add('levels.max_buy_1'); fields.add('levels.max_buy_2');
  }
  if (/Sell level ordering invalid/.test(msg)) {
    fields.add('levels.max_sell_1'); fields.add('levels.max_sell_2');
  }
  if (/Required levels are missing/.test(msg)) {
    fields.add('levels.max_buy_1');  fields.add('levels.max_buy_2');
    fields.add('levels.max_sell_1'); fields.add('levels.max_sell_2');
  }
  if (/Invalidation boundaries must bracket/.test(msg)) {
    fields.add('invalidation.void_below'); fields.add('invalidation.void_above');
    fields.add('meta.futures_last');
  }
  if (/^dvs \(/.test(msg)) fields.add('volatility.dvs');
  if (/Setup timestamp .* must be before expiry/.test(msg)) {
    fields.add('meta.timestamp'); fields.add('invalidation.expiry');
  }
  if (/Setup is stale/.test(msg)) {
    fields.add('meta.timestamp'); fields.add('meta.date');
  }
  return [...fields];
}

function clearFieldErrors() {
  document.querySelectorAll('#signal-form label.has-error').forEach(lbl => {
    lbl.classList.remove('has-error');
    const m = lbl.querySelector('.field-error');
    if (m) m.remove();
  });
}

function markFieldError(name, msg) {
  const input = document.querySelector(`#signal-form [name="${name}"]`);
  if (!input) return;
  const lbl = input.closest('label');
  if (!lbl) return;
  lbl.classList.add('has-error');
  let m = lbl.querySelector('.field-error');
  if (!m) {
    m = document.createElement('span');
    m.className = 'field-error';
    lbl.append(m);
  }
  // Append message; multiple errors per field stack.
  const line = document.createElement('span');
  line.textContent = msg;
  if (m.children.length > 0) m.append(document.createElement('br'));
  m.append(line);
}

async function submitForm(evt) {
  evt.preventDefault();
  $('#form-errors').innerHTML = '';
  clearFieldErrors();
  if (!evt.target.checkValidity()) {
    evt.target.reportValidity();
    return;
  }
  const signal = collectForm();
  const confirmed = await showConfirmDialog(signal);
  if (!confirmed) {
    setSubmitStatus('', '');
    return;
  }
  const ok = await postSignal(signal);
  if (ok) closeFormModal();
}

async function postSignal(signal) {
  setSubmitStatus('Submitting…', '');
  try {
    const res = await fetch('/signals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signal),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSubmitStatus('Validation failed.', 'err');
      const ul = $('#form-errors');
      let firstErrField = null;
      for (const err of body.errors ?? []) {
        const li = document.createElement('li');
        li.textContent = err;
        ul.append(li);
        for (const name of fieldsForError(err)) {
          markFieldError(name, err);
          if (!firstErrField) firstErrField = name;
        }
      }
      if (firstErrField) {
        const input = document.querySelector(`#signal-form [name="${firstErrField}"]`);
        input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      return false;
    }
    state.pendingSubmitName = body.filename;
    setSubmitStatus(`Submitted ${body.filename} — waiting for engine…`, '');
    for (const w of body.warnings ?? []) {
      const li = document.createElement('li');
      li.textContent = `⚠ ${w}`;
      li.style.color = 'var(--warn)';
      $('#form-errors').append(li);
    }
    return true;
  } catch (err) {
    setSubmitStatus(`Submit error: ${err.message}`, 'err');
    console.error(err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Confirm dialog: shown after client-side validation, before the POST.
// Renders three sections — engine state right now, signal summary, PRD checks
// — so the analyst gets a one-glance review of what's about to happen.
// ---------------------------------------------------------------------------
function showConfirmDialog(signal) {
  return new Promise(resolve => {
    const dlg = $('#confirm-dialog');
    const body = $('#confirm-dialog-body');
    body.innerHTML = '';
    body.append(buildEngineStateSection(signal));
    body.append(buildSummarySection(signal));
    body.append(buildChecksSection(signal));

    const ok = $('#confirm-ok');
    const cancel = $('#confirm-cancel');
    const onOk     = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    const onClose  = () => { cleanup(); resolve(false); };
    function cleanup() {
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      dlg.removeEventListener('close', onClose);
      if (dlg.open) dlg.close();
    }
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    dlg.addEventListener('close', onClose);
    dlg.showModal();
  });
}

function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text;
  for (const c of children) if (c) node.append(c);
  return node;
}

function fmtNum(n) {
  if (n == null || n === '') return '—';
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(2) : String(n);
}

// Build the "Engine state right now" section. If `signalAboutToSubmit` is
// non-null, append the synthesised "what will happen" headline (used by the
// confirm dialog). When called from the read-only Status dialog, pass null.
function buildEngineStateSection(signalAboutToSubmit) {
  const sec = el('section', { class: 'confirm-section' });
  sec.append(el('h3', { text: tx('Engine state right now') }));

  const grid = el('div', { class: 'confirm-grid' });
  const addRow = (k, v) => {
    grid.append(el('span', { class: 'k', text: k }));
    grid.append(el('span', { class: 'v', text: v }));
  };

  const connTxt =
    state.engine === 'connected'    ? tx('Connected') :
    state.engine === 'reconnecting' ? tx('Reconnecting…') : tx('Disconnected');
  addRow(tx('Connection'), connTxt);
  addRow(tx('Engine state'), tx(state.position));
  addRow(tx('Daily lock'), state.dailyLocked ? tx('Locked — no more trades today') : tx('Not locked'));
  if (state.currentSignal) {
    const cs = state.currentSignal;
    addRow(tx('Current setup'), `${baseName(cs.filePath) || '—'} (seq ${cs.updateSeq})`);
  } else {
    addRow(tx('Current setup'), tx('None loaded'));
  }
  if (state.openPosition) {
    const p = state.openPosition;
    addRow(tx('Open position'),
      `${p.direction.toUpperCase()} • avg ${fmtNum(p.avgEntry)} • stop ${fmtNum(p.currentStop)} • ${p.fills} fill(s)${p.breakEvenActive ? ' • BE' : ''}`);
  }
  sec.append(grid);

  if (signalAboutToSubmit) {
    const headline = synthesiseAction(signalAboutToSubmit);
    const h = el('div', { class: `confirm-headline is-${headline.tone}`, text: headline.text });
    h.style.marginTop = '0.5rem';
    sec.append(h);
  }

  return sec;
}

// One-line synthesis of what submitting this signal will actually do, given
// the engine's current state and the new signal's seq vs the loaded one.
function synthesiseAction(signal) {
  if (state.engine !== 'connected') {
    return { tone: 'warn', text: tx('Engine is offline — file will sit in signals/ until it reconnects.') };
  }
  if (state.dailyLocked) {
    return { tone: 'warn', text: tx('Engine is locked for today — setup stored but no trades will fire until tomorrow.') };
  }
  if (state.position === 'blocked') {
    return { tone: 'warn', text: tx('Engine is blocked by the DVS gate — submission stored, but trading is off today.') };
  }
  const cs = state.currentSignal;
  const newSeq = Number(signal.meta.update_seq);
  if (cs && Number(cs.updateSeq) >= 1 && newSeq > Number(cs.updateSeq)) {
    if (state.position === 'in_trade') {
      const dir = state.openPosition?.direction?.toUpperCase() ?? '';
      return {
        tone: 'warn',
        text: tx('Updating levels of in-flight {dir} (seq {old} → {new}) — engine will recompute stops and entries.')
          .replace('{dir}', dir).replace('{old}', cs.updateSeq).replace('{new}', newSeq),
      };
    }
    return { tone: 'ok', text: tx('Recalibration of current setup (seq {old} → {new}) — engine will swap in new levels.').replace('{old}', cs.updateSeq).replace('{new}', newSeq) };
  }
  if (state.position === 'in_trade') {
    return { tone: 'warn', text: tx('Engine is in a trade — submitting a fresh setup here would replace what it is currently working on.') };
  }
  return { tone: 'ok', text: tx('Engine will load this as the active setup and start watching for Entry 1.') };
}

function buildSummarySection(signal) {
  const sec = el('section', { class: 'confirm-section' });
  sec.append(el('h3', { text: tx('Setup summary') }));
  const grid = el('div', { class: 'confirm-grid' });
  const m = signal.meta, v = signal.volatility, w = signal.vwap, r = signal.ranges, l = signal.levels, inv = signal.invalidation;

  const row = (k, val) => {
    grid.append(el('span', { class: 'k', text: k }));
    grid.append(el('span', { class: 'v', text: val }));
  };
  row(tx('Date / time'), `${m.date} ${m.timestamp} (seq ${m.update_seq})`);
  row(tx('Futures / Cash / Basis'), `${fmtNum(m.futures_last)}  /  ${fmtNum(m.cash_last)}  /  ${fmtNum(m.basis)}`);
  row(tx('DVS / regime'), `${fmtNum(v.dvs)} (${tx(v.regime)})  • prior ${fmtNum(v.dvs_prior)}`);
  row(tx('VWAP'), `${fmtNum(w.value)} @ ${w.updated_at}`);
  row(tx('Ranges (ES futures)'), `${fmtNum(r.range_1_down)}  ${fmtNum(r.range_2_down)}  …  ${fmtNum(r.range_2_up)}  ${fmtNum(r.range_1_up)}`);
  row(tx('Levels (SPX cash)'),
    `B1 ${fmtNum(l.max_buy_1)}  B2 ${fmtNum(l.max_buy_2)}  S2 ${fmtNum(l.max_sell_2)}  S1 ${fmtNum(l.max_sell_1)}`);
  if (l.supporto != null || l.resistenza != null) {
    row(tx('Support / Resistance'), `${fmtNum(l.supporto)}  /  ${fmtNum(l.resistenza)}`);
  }
  row(tx('Invalidation (futures)'), `void below ${fmtNum(inv.void_below)}  •  void above ${fmtNum(inv.void_above)}  •  expiry ${inv.expiry}`);
  if (signal.bias?.direction) {
    row(tx('Bias'), `${signal.bias.direction}/${signal.bias.confidence ?? '—'}`);
  }
  sec.append(grid);
  return sec;
}

function buildChecksSection(signal) {
  const sec = el('section', { class: 'confirm-section' });
  sec.append(el('h3', { text: tx('PRD sanity checks') }));

  const checks = computeChecks(signal);
  for (const c of checks) sec.append(renderCheck(c));
  return sec;
}

function renderCheck(c) {
  const row = el('div', { class: `check ${c.status}` });
  const ico = el('span', { class: 'ico', text: c.status === 'ok' ? '✓' : c.status === 'warn' ? '⚠' : '✗' });
  const msg = el('span', { class: 'msg' });
  msg.append(document.createTextNode(c.title));
  if (c.detail) msg.append(el('span', { class: 'det', text: c.detail }));
  row.append(ico, msg);
  return row;
}

function computeChecks(signal) {
  const out = [];
  const m = signal.meta, r = signal.ranges, l = signal.levels, v = signal.volatility, w = signal.vwap;

  // 1. Basis matches futures - cash within ±5
  if (m.futures_last != null && m.cash_last != null && m.basis != null) {
    const computed = m.futures_last - m.cash_last;
    const delta = Math.abs(computed - m.basis);
    if (delta <= 5) {
      out.push({ status: 'ok',   title: tx('Basis matches futures − cash'), detail: `Δ ${delta.toFixed(2)} (computed ${computed.toFixed(2)}, entered ${Number(m.basis).toFixed(2)})` });
    } else {
      out.push({ status: 'err',  title: tx('Basis disagrees with futures − cash by more than 5 points'), detail: `computed ${computed.toFixed(2)} vs entered ${Number(m.basis).toFixed(2)} (Δ ${delta.toFixed(2)}). Engine will reject.` });
    }
  }

  // 2. Range ordering r1d < r2d < r2u < r1u
  if ([r.range_1_down, r.range_2_down, r.range_2_up, r.range_1_up].every(x => x != null)) {
    const ok = r.range_1_down < r.range_2_down && r.range_2_down < r.range_2_up && r.range_2_up < r.range_1_up;
    out.push(ok
      ? { status: 'ok',  title: tx('Range ordering correct'), detail: 'range_1_down < range_2_down < range_2_up < range_1_up' }
      : { status: 'err', title: tx('Range ordering broken'),  detail: tx('Expected: range_1_down < range_2_down < range_2_up < range_1_up') });
  }

  // 3. Level ordering (cash) max_buy_1 < max_buy_2 < max_sell_2 < max_sell_1
  const lvls = [l.max_buy_1, l.max_buy_2, l.max_sell_2, l.max_sell_1];
  if (lvls.every(x => x != null)) {
    const ok = l.max_buy_1 < l.max_buy_2 && l.max_buy_2 < l.max_sell_2 && l.max_sell_2 < l.max_sell_1;
    out.push(ok
      ? { status: 'ok',  title: tx('Level ordering correct'), detail: 'max_buy_1 < max_buy_2 < max_sell_2 < max_sell_1' }
      : { status: 'err', title: tx('Level ordering broken'),  detail: tx('Expected: max_buy_1 < max_buy_2 < max_sell_2 < max_sell_1') });
  }

  // 3b. Tradeable pair coverage — engine needs at least one full pair.
  const hasBuyPair  = l.max_buy_1  != null && l.max_buy_2  != null;
  const hasSellPair = l.max_sell_1 != null && l.max_sell_2 != null;
  if (!hasBuyPair && !hasSellPair) {
    out.push({ status: 'err', title: tx('No tradeable level pair — engine will not enter'),
      detail: tx('Provide both MAX BUY 1+2 or both MAX SELL 1+2.') });
  } else if (hasBuyPair !== hasSellPair) {
    out.push({ status: 'warn', title: tx('Only one side has levels — engine will trade that side only'),
      detail: hasBuyPair ? 'MAX BUY 1+2 only (no shorts will fire)' : 'MAX SELL 1+2 only (no longs will fire)' });
  }

  // 4. DVS gate
  if (v.dvs != null) {
    if (v.dvs > 75) {
      out.push({ status: 'warn', title: tx('DVS above 75 — gate will block all trades today'), detail: `DVS = ${Number(v.dvs).toFixed(2)}` });
    } else if (v.dvs < 50) {
      out.push({ status: 'ok', title: tx('DVS below 50 — ideal mean-reversion conditions'), detail: `DVS = ${Number(v.dvs).toFixed(2)}` });
    } else {
      out.push({ status: 'ok', title: tx('DVS in normal range (50–75)'), detail: `DVS = ${Number(v.dvs).toFixed(2)}` });
    }
  }

  // 5. VWAP staleness vs signal timestamp
  if (w.updated_at && m.timestamp) {
    const vwapMin = hhmmToMin(w.updated_at);
    const sigMin  = hhmmToMin(m.timestamp);
    if (Number.isFinite(vwapMin) && Number.isFinite(sigMin)) {
      const ageMin = Math.abs(sigMin - vwapMin);
      if (ageMin > 90) {
        out.push({ status: 'warn', title: tx('VWAP older than 90 minutes vs setup time'), detail: `VWAP ${w.updated_at}, setup ${m.timestamp} (Δ ${ageMin}m)` });
      } else {
        out.push({ status: 'ok', title: tx('VWAP fresh (≤90 min)'), detail: `Δ ${ageMin}m` });
      }
    }
  }

  // 6. Cash → futures preview using basis
  if (m.basis != null && lvls.every(x => x != null)) {
    const b = Number(m.basis);
    const conv = (cash) => (Number(cash) + b).toFixed(2);
    out.push({
      status: 'ok',
      title: tx('Cash → futures conversion preview (engine compares ES live to these)'),
      detail:
        `B1 ${conv(l.max_buy_1)} • B2 ${conv(l.max_buy_2)} • S2 ${conv(l.max_sell_2)} • S1 ${conv(l.max_sell_1)} (basis ${b.toFixed(2)})`,
    });
  }

  // 7. Date is today
  const today = new Date().toISOString().slice(0, 10);
  if (m.date && m.date !== today) {
    out.push({ status: 'err', title: tx('Date is not today — engine will reject'), detail: `setup date ${m.date}, today ${today}` });
  }

  return out;
}

function hhmmToMin(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return NaN;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  $('#signal-form').addEventListener('submit', submitForm);

  // Quick-fill buttons: stamp "today" or "now" into the target field.
  $('#signal-form').addEventListener('click', e => {
    const btn = e.target.closest('[data-quick-fill]');
    if (!btn) return;
    const kind = btn.dataset.quickFill;
    const target = btn.dataset.target;
    const input = $('#signal-form').elements[target];
    if (!input) return;
    const now = new Date();
    if (kind === 'today') {
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      input.value = `${y}-${m}-${d}`;
    } else if (kind === 'now') {
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      input.value = `${hh}:${mm}`;
    }
  });

  // Top-strip action buttons each mutate the form then open the modal.
  $('#btn-status').addEventListener('click', () => { showStatusDialog().catch(console.error); });
  $('#btn-new').addEventListener('click', () => { resetForNewSignal(); openFormModal(); });
  $('#btn-update').addEventListener('click', () => { bumpUpdateSeq(); openFormModal(); });
  $('#btn-prefill').addEventListener('click', async () => {
    await prefillFromLatest();
    openFormModal();
  });
  $('#btn-import-screenshots').addEventListener('click', openScreenshotPicker);
  $('#screenshot-input').addEventListener('change', uploadScreenshots);

  // Form modal close (X button).
  $('#btn-form-close').addEventListener('click', closeFormModal);

  // Status dialog close (X + bottom Close button).
  $('#btn-status-close').addEventListener('click', () => $('#status-dialog').close());
  $('#btn-status-ok').addEventListener('click', () => $('#status-dialog').close());

  // Help dialog open + close.
  $('#btn-help').addEventListener('click', () => {
    const dlg = $('#help-dialog');
    if (!dlg.open) dlg.showModal();
  });
  $('#btn-help-close').addEventListener('click', () => $('#help-dialog').close());
  $('#btn-help-ok').addEventListener('click', () => $('#help-dialog').close());

  $('#btn-clear-log').addEventListener('click', () => { $('#log').innerHTML = ''; });
  $('#btn-lang').addEventListener('click', toggleLang);
  applyLang(currentLang);

  // Default date/time to now so a blank form is submittable after pre-fill.
  resetForNewSignal();

  // Ask for notification permission once — user can grant or dismiss.
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }

  connectWs();
  // Best-effort silent pre-fill on first load — populates the (closed) form
  // modal so opening "Pre-fill from latest" or "Update during session" shows
  // values immediately.
  prefillFromLatest().catch(() => {});
});
