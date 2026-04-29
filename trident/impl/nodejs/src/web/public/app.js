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
  '.chip-label', '.chip-value', '.brand-name', '.form-key', '.log-sub',
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
      `Signal: ${filename} (seq ${b.currentSignal.updateSeq}, DVS ${b.currentSignal.dvs}, VWAP ${b.currentSignal.vwap})`
    );
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
    case 'idle':     return 'Engine is idle — waiting for a signal.';
    case 'watching': return 'Engine is watching — signal loaded, waiting for Entry 1.';
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
    case 'POSITION_CLOSED':setStateChip('closed',   state.dailyLocked); break;
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
  if (res.status === 204) { setSubmitStatus('No prior signal to pre-fill from.', ''); return; }
  if (!res.ok) { setSubmitStatus(`Pre-fill failed: ${res.status}`, 'err'); return; }
  const { signal } = await res.json();
  fillForm(signal);
  setSubmitStatus('Pre-filled from latest signal.', '');
}

// Walk the signal object and set form fields whose name matches the
// dotted path (e.g. meta.dvs → input[name="meta.dvs"]).
function fillForm(signal) {
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
  // Today + now for the new submission.
  const now = new Date();
  setField('meta.date', now.toISOString().slice(0, 10));
  setField('meta.timestamp', now.toTimeString().slice(0, 5));
  setField('meta.update_seq', 1);
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

async function uploadScreenshots(evt) {
  const input = evt.target;
  const files = Array.from(input.files ?? []);
  if (files.length === 0) return;

  setSubmitStatus(`Uploading ${files.length} screenshot${files.length === 1 ? '' : 's'}…`, '');
  const results = [];
  try {
    for (const f of files) {
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
    setSubmitStatus(
      `Uploaded ${results.length} screenshot${results.length === 1 ? '' : 's'}. ` +
      `AI extraction coming soon — populate the form manually for now.`,
      'ok',
    );
  } catch (err) {
    setSubmitStatus(`Upload failed: ${err.message}`, 'err');
  } finally {
    input.value = ''; // allow re-uploading the same file
  }
}

function setSubmitStatus(text, kind) {
  const el = $('#submit-status');
  el.textContent = text;
  el.className = kind || '';
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

async function submitForm(evt) {
  evt.preventDefault();
  $('#form-errors').innerHTML = '';
  setSubmitStatus('Submitting…', '');
  try {
    const signal = collectForm();
    const res = await fetch('/signals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signal),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setSubmitStatus('Validation failed.', 'err');
      const ul = $('#form-errors');
      for (const err of body.errors ?? []) {
        const li = document.createElement('li');
        li.textContent = err;
        ul.append(li);
      }
      return;
    }
    state.pendingSubmitName = body.filename;
    setSubmitStatus(`Submitted ${body.filename} — waiting for engine…`, '');
    for (const w of body.warnings ?? []) {
      const li = document.createElement('li');
      li.textContent = `⚠ ${w}`;
      li.style.color = 'var(--warn)';
      $('#form-errors').append(li);
    }
  } catch (err) {
    setSubmitStatus(`Submit error: ${err.message}`, 'err');
    console.error(err);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  $('#signal-form').addEventListener('submit', submitForm);
  $('#btn-new').addEventListener('click', resetForNewSignal);
  $('#btn-update').addEventListener('click', bumpUpdateSeq);
  $('#btn-prefill').addEventListener('click', prefillFromLatest);
  $('#btn-import-screenshots').addEventListener('click', openScreenshotPicker);
  $('#screenshot-input').addEventListener('change', uploadScreenshots);
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
  // Best-effort pre-fill on first load; silent on 204.
  prefillFromLatest().catch(() => {});
});
