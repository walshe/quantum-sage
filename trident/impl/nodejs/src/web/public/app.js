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

/**
 * Format a timestamp for display in the log.
 * Accepts an ISO 8601 string (from isoTimestamp) and returns "HH:MM:SS TZ"
 * in the browser's local timezone — so the analyst sees times in their own
 * timezone regardless of where the engine is running.
 * Falls back to the raw string if it's not parseable as ISO (legacy path).
 */
function fmtTime(value) {
  if (!value) return '??:??:??';
  if (!value.includes('T')) return value; // plain HH:MM:SS legacy fallback
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  const hms = d.toTimeString().slice(0, 8);
  const shortTz = d.toLocaleTimeString(undefined, { timeZoneName: 'short' }).split(' ').pop();
  const longTz  = d.toLocaleTimeString(undefined, { timeZoneName: 'long'  }).split(' ').slice(1).join(' ');
  return `${hms} ${shortTz} (${longTz})`;
}

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

  // All lang toggle buttons (top bar + dialog headers) show the OTHER language as label.
  // Show the flag of the OTHER language (clicking switches to it)
  const label = lang === 'en' ? '🇮🇹' : '🇬🇧';
  document.querySelectorAll('#btn-lang, [data-lang-toggle]').forEach(btn => {
    btn.textContent = label;
  });

  document.documentElement.lang = lang;

  // Status pane is always visible — rebuild it so translated labels update live.
  renderStatusPanel();
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
  stopPoints: null,   // from SETUP_READY — used to show worst-case stop in trade plan
  history: [],
  pendingSubmitName: null, // filename we're waiting to hear back about as SIGNAL_LOADED
  account: null,      // latest AccountInfo from bootstrap or account_update
};
// Last history envelope received — kept so handleBootstrap can fall back to it
// when the bootstrap's currentSignal is null (engine clears signal on close).
let _lastHistory = [];

function setEngineChip(s) {
  state.engine = s;
  // Show/hide the full-page connection overlay.
  // Note: we do NOT hide the overlay on 'connected' here — we wait until the
  // bootstrap message is processed (handleBootstrap calls this after setting
  // all state). This prevents a brief flash of stale 'idle' state between the
  // moment the WebSocket opens and the moment the bootstrap arrives.
  const overlay = $('#ws-overlay');
  if (overlay) {
    if (s !== 'connected') {
      overlay.classList.remove('is-hidden');
      $('#ws-overlay-text').textContent =
        s === 'reconnecting' ? 'Reconnecting…' : 'Connecting to server…';
      $('#ws-overlay-sub').textContent =
        s === 'reconnecting'
          ? 'Connection dropped — retrying…'
          : 'Waiting for the engine process to respond.';
    }
    // Overlay is hidden by handleBootstrap once state is fully set.
  }
  renderStatusPanel();
}
function setStateChip(s, locked) {
  state.position = s;
  state.dailyLocked = !!locked;
  // Page title badge: prefix with 🔴 while a trade is open so it's visible from other tabs.
  document.title = s === 'in_trade' ? '🔴 IN TRADE — Trident' : 'Trident';
}
function renderSignalCard() {
  const el = $('#signal-card-body');
  if (!el) return;
  const s = state.currentSignal;
  if (!s) { el.textContent = tx('None loaded'); return; }
  const filename = baseName(s.filePath) || '(unknown)';
  const bias = s.biasDirection ?? '—';
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
  const log = $('#log');

  // Coalesce only if the immediately preceding row matches.
  let matchRow = null;
  const last = log.lastElementChild;
  if (last && last.dataset.tag === data.tag && last.dataset.head === data.headline) {
    matchRow = last;
  }

  if (matchRow) {
    const count = (parseInt(matchRow.dataset.count || '1', 10)) + 1;
    matchRow.dataset.count = String(count);
    let badge = matchRow.querySelector('.count');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'count';
      matchRow.querySelector('.head').after(badge);
    }
    badge.textContent = `×${count}`;
    // Update timestamp to the latest occurrence (browser local time + TZ label).
    matchRow.querySelector('.ts').textContent = `[${fmtTime(data.isoTimestamp ?? data.timestamp)}]`;
    return;
  }

  const li = document.createElement('li');
  li.className = severityClass(data);
  li.dataset.tag = data.tag;
  li.dataset.head = data.headline;

  const ts = document.createElement('span');
  ts.className = 'ts'; ts.textContent = `[${fmtTime(data.isoTimestamp ?? data.timestamp)}]`;
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

  // ORDER_FAILED pins to the top so critical errors are never scrolled off.
  // All other events append chronologically at the bottom.
  if (data.type === 'ORDER_FAILED') {
    const badge = document.createElement('span');
    badge.className = 'action-badge';
    badge.textContent = '⚠️ ACTION REQUIRED';
    li.prepend(badge);
    log.insertAdjacentElement('afterbegin', li);
  } else {
    log.append(li);
  }

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
    if (msg.kind === 'history') { _lastHistory = msg.data; handleHistory(msg.data); }
    else if (msg.kind === 'bootstrap') handleBootstrap(msg.data);
    else if (msg.kind === 'event') handleEvent(msg.data);
    else if (msg.kind === 'account_update') updateAccountChip(msg.data);
  });
}

/**
 * Replays the server's ring buffer of recent events into the log.
 * Called before handleBootstrap so the log is fully rebuilt before the
 * bootstrap's CONNECTED row is appended. Clears the log first so no
 * duplicate rows appear on reconnect.
 * State chips are NOT updated here — the bootstrap that follows sets them.
 * Returns the events array so handleBootstrap can mine it for signal data.
 */
function handleHistory(events) {
  $('#log').innerHTML = '';
  for (const ev of events) {
    appendLogRow(ev);
  }
  return events;
}

// Most recent SIGNAL_LOADED payload from a history/event array, or null.
function latestSignalFromHistory(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.type === 'SIGNAL_LOADED' && ev.raw?.filePath) {
      return {
        filePath:      ev.raw.filePath,
        updateSeq:     ev.raw.signal?.meta?.update_seq,
        dvs:           ev.raw.signal?.volatility?.dvs,
        vwap:          ev.raw.signal?.vwap?.value,
        biasDirection: ev.raw.signal?.bias?.direction ?? null,
        _signal:       ev.raw.signal ?? null,
      };
    }
  }
  return null;
}

function handleBootstrap(b) {
  // If server has funMode enabled and user hasn't set it locally yet, enable it.
  if (b.funMode && !localStorage.getItem(FUN_MODE_KEY)) {
    localStorage.setItem(FUN_MODE_KEY, 'true');
  }

  setStateChip(b.state, b.dailyLocked);
  if (b.symbol) {
    const symEl = $('#symbol-chip-value');
    symEl.textContent = b.symbol;
    _i18nTextSnap.delete(symEl); // symbol name is never translatable — keep it on lang toggle
  }
  // The engine clears currentSignal when a position closes. If the bootstrap
  // has no signal but the ring buffer contains a recent SIGNAL_LOADED, seed
  // the UI from it so the nav card and status pane aren't blank until the next
  // live scanSignalDirOnce event arrives.
  state.currentSignal = b.currentSignal ?? latestSignalFromHistory(_lastHistory);
  state.openPosition = b.position ?? null;
  if (b.stopPoints != null) state.stopPoints = b.stopPoints;
  updateAccountChip(b.account ?? null);
  renderSignalCard();

  // Show server timezone note in the form so the analyst knows which timezone
  // to use when entering times (timestamp, expiry, vwap.updated_at).
  if (b.serverTz) {
    const tzNote = $('#server-tz-note');
    if (tzNote) {
      tzNote.textContent = `🕐 Times in this form are interpreted in the server timezone: ${b.serverTz.offsetStr} (${b.serverTz.ianaName})`;
      tzNote.hidden = false;
    }
  }

  // Synthesise a log entry that captures the engine's current state so the
  // pane isn't blank on connect. The real event stream will only contain
  // things that happen from this moment onwards.
  const headline = describeEngineState(b);
  const detail = [];
  if (b.currentSignal) {
    const filename = baseName(b.currentSignal.filePath);
    detail.push(
      `Setup: ${filename} (seq ${b.currentSignal.updateSeq}, DVS ${b.currentSignal.dvs}, VWAP ${b.currentSignal.vwap})`
    );
    // Seed history so Today shows the already-loaded signal even if the tab
    // connected after the engine picked it up.
    state.history.unshift({ ts: b.currentSignal.timestamp, tag: 'SIGNAL', text: b.currentSignal.filePath });
    renderHistory();
  }
  if (b.lastIdleReason) {
    // Engine went idle due to a non-trade event (stale signal, expiry before
    // entry, invalidation before entry). Surface the reason here so the analyst
    // sees it even if they connected/reconnected after the live event fired.
    detail.push(`ℹ️ ${b.lastIdleReason}`);
  }
  if (b.position) {
    detail.push(
      `Position: ${b.position.direction.toUpperCase()} — avg ${b.position.avgEntry}, stop ${b.position.currentStop}, ${b.position.fills} fill(s)`
    );
  }
  appendLogRow({
    timestamp: fmtTime(b.serverTime),
    isoTimestamp: b.serverTime,
    type: 'BOOTSTRAP',
    tag: 'CONNECTED',
    headline,
    detail,
    action: null,
    severity: 'info',
    actionRequired: false,
  });

  // All state is now correctly set from the bootstrap. Safe to reveal the panel.
  // Hiding the overlay here (rather than on WS open) ensures the user never sees
  // a stale 'idle' state in the status pane between connection and bootstrap receipt.
  const overlay = $('#ws-overlay');
  if (overlay) overlay.classList.add('is-hidden');

  renderStatusPanel();
}

// ---------------------------------------------------------------------------
// Status pane — live always-visible panel on the right half of the main area
// ---------------------------------------------------------------------------
function renderStatusPanel() {
  const pane = $('#status-pane');
  const body = $('#status-pane-body');
  if (!pane || !body) return;

  // Drive the pane's data-state so CSS can apply colours + animation.
  const engineState = state.dailyLocked ? 'blocked' : (state.position ?? 'idle');
  pane.dataset.state = engineState;

  body.innerHTML = '';

  const spRow = (key, valText, valClass) => {
    const row = el('div', { class: 'sp-row' });
    row.append(el('span', { class: 'sp-key', text: tx(key) }));
    const v = el('span', { class: `sp-val${valClass ? ' ' + valClass : ''}`, text: valText });
    row.append(v);
    return row;
  };

  // ── Engine section ──────────────────────────────────────
  const engSec = el('div', { class: 'sp-section' });
  engSec.append(el('h3', { text: tx('Engine') }));

  const connTxt =
    state.engine === 'connected'    ? tx('Connected') :
    state.engine === 'reconnecting' ? tx('Reconnecting…') : tx('Disconnected');
  const connClass =
    state.engine === 'connected'    ? 'is-closed' :
    state.engine === 'reconnecting' ? 'is-locked' : 'is-blocked';
  engSec.append(spRow('Connection', connTxt, connClass));

  const STATE_LABELS = { idle: 'idle', watching: 'watching', in_trade: 'in trade', closed: 'closed', blocked: 'blocked', locked: 'locked' };
  const stateLabel = state.dailyLocked ? tx('locked') : tx(STATE_LABELS[state.position] ?? state.position ?? 'idle');
  const stateClass =
    state.position === 'in_trade'  ? 'is-in-trade sp-val--flash' :
    state.position === 'watching'  ? 'is-watching'  :
    state.position === 'closed'    ? 'is-closed'    :
    state.position === 'blocked'   ? 'is-blocked'   :
    state.dailyLocked              ? 'is-locked'    : '';
  engSec.append(spRow('State', stateLabel, stateClass));

  const lockTxt = state.dailyLocked
    ? tx('Locked — no more trades today')
    : tx('Not locked');
  engSec.append(spRow('Daily lock', lockTxt, state.dailyLocked ? 'is-locked' : ''));
  body.append(engSec);

  // ── Setup section ───────────────────────────────────────
  const setupSec = el('div', { class: 'sp-section' });
  setupSec.append(el('h3', { text: tx('Current setup') }));
  if (state.currentSignal) {
    const cs = state.currentSignal;
    setupSec.append(spRow('File', baseName(cs.filePath) || '—', ''));
    setupSec.append(spRow('Seq', String(cs.updateSeq ?? '—'), ''));
    setupSec.append(spRow('DVS', cs.dvs != null ? String(cs.dvs) : '—', ''));
    setupSec.append(spRow('VWAP', cs.vwap != null ? fmtNum(cs.vwap) : '—', ''));
    setupSec.append(spRow('Bias', cs.biasDirection ?? '—', ''));
  } else {
    setupSec.append(el('div', { class: 'sp-empty', text: tx('No setup loaded today.') }));
  }
  body.append(setupSec);

  // ── Trade plan section (watching or in_trade) ───────────
  const showPlan = state.position === 'watching' || state.position === 'in_trade';
  if (showPlan && state.currentSignal) {
    const planSec = el('div', { class: 'sp-section' });

    const inTrade     = state.position === 'in_trade';
    const entrySig    = inTrade ? state.openPosition?.entrySignal    : null;
    const entryPath   = inTrade ? state.openPosition?.entrySignalFilePath : null;
    const sigUpdated  = inTrade && entryPath && state.currentSignal.filePath &&
                        baseName(state.currentSignal.filePath) !== baseName(entryPath);

    // While in_trade, show the plan from the signal that opened the position.
    // When watching, show the current signal's plan.
    const planSig = (inTrade && entrySig) ? entrySig : state.currentSignal._signal;

    planSec.append(el('h3', { text: tx('Trade plan') + (inTrade && entrySig ? tx(' (at entry)') : '') }));

    if (planSig) {
      planSec.append(buildTradePlanNote(planSig));
    } else {
      // Bootstrap gave us only the summary — fetch the full signal once and re-render.
      fetch('/signals/latest').then(r => r.ok ? r.json() : null).then(data => {
        if (data?.signal && state.currentSignal) {
          state.currentSignal._signal = data.signal;
          if (inTrade && state.openPosition && !state.openPosition.entrySignal) {
            state.openPosition.entrySignal = data.signal;
            state.openPosition.entrySignalFilePath = state.currentSignal.filePath;
          }
          renderStatusPanel();
        }
      }).catch(() => {});
    }

    // If a new signal was loaded during the trade, show it collapsed below.
    if (sigUpdated) {
      const updatedSig = state.currentSignal._signal;
      const details = document.createElement('details');
      details.className = 'sp-updated-plan';
      const summary = document.createElement('summary');
      summary.textContent = `⚠️ ${tx('Signal updated since entry')} — ${baseName(state.currentSignal.filePath)}`;
      details.append(summary);
      if (updatedSig) {
        details.append(buildTradePlanNote(updatedSig));
      } else {
        const note = document.createElement('p');
        note.style.color = 'var(--fg-dim)';
        note.style.fontSize = '12px';
        note.textContent = tx('Loading…');
        details.append(note);
        fetch('/signals/latest').then(r => r.ok ? r.json() : null).then(data => {
          if (data?.signal && state.currentSignal) {
            state.currentSignal._signal = data.signal;
            renderStatusPanel();
          }
        }).catch(() => {});
      }
      planSec.append(details);
    }

    body.append(planSec);
  }

  // ── Position section (only when in trade) ──────────────
  if (state.openPosition) {
    const p = state.openPosition;
    const posSec = el('div', { class: 'sp-section' });
    posSec.append(el('h3', { text: tx('Open position') }));
    posSec.append(spRow('Direction', p.direction.toUpperCase(), 'is-in-trade'));
    posSec.append(spRow('Avg entry', fmtNum(p.avgEntry), ''));
    posSec.append(spRow('Stop', fmtNum(p.currentStop), 'is-blocked'));
    posSec.append(spRow('Target (VWAP)', fmtNum(p.vwapTarget), 'is-closed'));
    // Individual fills — show each entry's price and size if available.
    const details = p.fillDetails ?? [];
    if (details.length > 0) {
      details.forEach(f => {
        posSec.append(spRow(
          `${tx('Entry')} ${f.entryNumber}`,
          `${fmtNum(f.price)}  (${f.allocationPct}%)`,
          ''
        ));
      });
    } else {
      // Fallback: just show the count if fill details aren't available.
      posSec.append(spRow(tx('Fills'), String(p.fills), ''));
    }
    posSec.append(spRow('Breakeven', p.breakEvenActive ? tx('Active') : tx('Not yet'), p.breakEvenActive ? 'is-closed' : ''));

    // Broker P&L from CTraderTrader's unrealizedPnl (updates every 30s).
    const acct = state.account;
    const CURRENCY_SYMBOLS = { EUR: '€', USD: '$', GBP: '£', JPY: '¥', AUD: 'A$', CAD: 'C$', CHF: 'Fr' };
    if (acct && acct.unrealizedPnl != null) {
      const sym = CURRENCY_SYMBOLS[acct.currency] ?? acct.currency;
      const pnl = acct.unrealizedPnl;
      const prefix = pnl > 0 ? '+' : '';
      const pnlText = `${prefix}${sym} ${pnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      posSec.append(spRow('Broker P&L', pnlText, pnl > 0 ? 'pnl--positive' : pnl < 0 ? 'pnl--negative' : ''));
    } else {
      posSec.append(spRow('Broker P&L', '—', ''));
    }

    body.append(posSec);
  }
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
        // Full signal kept so the trade plan note can be rendered in the status panel.
        _signal: raw.signal ?? null,
      };
      renderSignalCard();
      state.history.unshift({ ts: data.timestamp, tag: 'SIGNAL', text: raw.filePath });
      renderHistory();
      // If the UI is waiting on a just-submitted signal, clear the indicator.
      if (state.pendingSubmitName && raw.filePath?.endsWith(state.pendingSubmitName)) {
        setSubmitStatus(`Loaded ${state.pendingSubmitName}`, 'ok');
        state.pendingSubmitName = null;
      }
      // Engine ignores new signals while in_trade — don't clobber the state chip.
      // (scanSignalDirOnce fires SIGNAL_LOADED on every restart regardless of engine state.)
      if (state.position !== 'in_trade') {
        setStateChip('watching', state.dailyLocked);
      }
      renderStatusPanel();
      break;

    case 'SIGNAL_INVALID':
      state.history.unshift({ ts: data.timestamp, tag: 'INVALID', text: raw.filePath });
      renderHistory();
      break;

    case 'SETUP_READY':
      setStateChip('watching', state.dailyLocked);
      state.openPosition = null;
      if (raw.stopPoints != null) state.stopPoints = raw.stopPoints;
      renderStatusPanel();
      break;
    case 'ENTRY_TRIGGERED': {
      setStateChip('in_trade', state.dailyLocked);
      // Accumulate fill details — each ENTRY_TRIGGERED carries the new fill.
      const prevFills = state.openPosition?.fillDetails ?? [];
      const newFill = raw.entryNumber != null ? {
        entryNumber: raw.entryNumber,
        price: raw.price ?? raw.avgEntry,
        allocationPct: raw.allocationPct,
      } : null;
      const fillDetails = newFill
        ? [...prevFills.filter(f => f.entryNumber !== newFill.entryNumber), newFill]
            .sort((a, b) => a.entryNumber - b.entryNumber)
        : prevFills;
      state.openPosition = {
        direction:            raw.direction,
        avgEntry:             raw.avgEntry,
        currentStop:          raw.currentStop,
        vwapTarget:           raw.vwapTarget ?? state.openPosition?.vwapTarget ?? null,
        fills:                3 - raw.fillsRemaining,
        fillDetails,
        breakEvenActive:      state.openPosition?.breakEvenActive ?? false,
        // Preserve entry signal from Entry 1; subsequent fills carry it too
        entrySignalFilePath:  raw.entrySignalFilePath ?? state.openPosition?.entrySignalFilePath ?? null,
        entrySignal:          raw.entrySignal          ?? state.openPosition?.entrySignal          ?? null,
      };
      renderStatusPanel();
      break;
    }
    case 'BREAKEVEN_TRIGGERED':
      if (state.openPosition) state.openPosition.currentStop = raw.newStop;
      if (state.openPosition) state.openPosition.breakEvenActive = true;
      renderStatusPanel();
      break;
    case 'POSITION_CLOSED':
      setStateChip('closed', state.dailyLocked);
      state.openPosition = null;
      renderStatusPanel();
      break;
    case 'DAILY_LOCK':
      setStateChip(state.position, true);
      renderStatusPanel();
      break;
    case 'DVS_GATE_BLOCKED':
      setStateChip('blocked', state.dailyLocked);
      renderStatusPanel();
      break;
    case 'NO_TRADE_SETUP':
      // Engine has no active setup (stale signal discarded, expiry before entry,
      // or invalidation before entry). Reset to idle so the analyst knows to
      // submit today's setup.
      setStateChip('idle', state.dailyLocked);
      state.currentSignal = null;
      state.openPosition = null;
      renderSignalCard();
      renderStatusPanel();
      break;
  }
}

function renderHistory() {
  const list = $('#history-list');
  if (!list) return;
  list.innerHTML = '';
  for (const h of state.history.slice(0, 20)) {
    const li = document.createElement('li');
    li.textContent = `${h.ts}  ${h.tag.padEnd(7)}  ${baseName(h.text)}`;
    list.append(li);
  }
  const countEl = $('#history-count');
  if (countEl) countEl.textContent = `(${state.history.length})`;
}

let _lastPrice = null;
function updatePriceChip(data) {
  const el = $('#price-chip-value');
  if (!el) return;
  const newPrice = data.raw?.price ?? null;
  const chip = $('#price-chip');
  if (chip) {
    chip.dataset.state = 'live';
    if (newPrice !== null && _lastPrice !== null) {
      const dir = newPrice > _lastPrice ? 'up' : newPrice < _lastPrice ? 'down' : null;
      if (dir) {
        chip.dataset.tick = dir;
        clearTimeout(chip._tickTimer);
        chip._tickTimer = setTimeout(() => { delete chip.dataset.tick; }, 600);
      }
    }
    _lastPrice = newPrice;
  }
  el.textContent = data.headline;
  _i18nTextSnap.delete(el);
}

function updateAccountChip(account) {
  state.account = account;
  const balEl = $('#account-chip-value');
  const pnlEl = $('#unrealized-pnl');
  const tipEl = $('#account-chip-tip');
  if (!balEl || !pnlEl) return;

  if (!account) {
    balEl.textContent = '—';
    pnlEl.hidden = true;
    return;
  }

  const { balance, unrealizedPnl, currency, login, brokerName, isLive } = account;
  const CURRENCY_SYMBOLS = { EUR: '€', USD: '$', GBP: '£', JPY: '¥', AUD: 'A$', CAD: 'C$', CHF: 'Fr' };
  const sym = CURRENCY_SYMBOLS[currency] ?? currency;
  balEl.textContent = `${sym} ${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  _i18nTextSnap.delete(balEl);

  // Build dynamic tooltip with account identity
  if (tipEl) {
    const accountType = isLive ? 'Live' : 'Demo';
    const broker = brokerName || 'Broker';
    const loginStr = login ? ` · ${login}` : '';
    tipEl.dataset.tip =
      `${accountType} account — ${broker}${loginStr}\n\nBalance refreshes every 30 seconds.\n\nDashes mean no trader connection yet.`;
  }

  if (unrealizedPnl === 0) {
    pnlEl.hidden = true;
  } else {
    const prefix = unrealizedPnl > 0 ? '+' : '';
    const val = unrealizedPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    pnlEl.textContent = `(${prefix}${sym} ${val})`;
    pnlEl.className = 'chip-pnl ' + (unrealizedPnl > 0 ? 'pnl--positive' : 'pnl--negative');
    pnlEl.hidden = false;
    _i18nTextSnap.delete(pnlEl);
  }

  // Refresh the Open Position panel so the Broker P&L row updates live.
  if (state.position === 'in_trade') renderStatusPanel();
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
    if (value === null || value === undefined) {
      // For <select> elements, only clear to '' if the dropdown actually has an
      // empty option — otherwise leave the HTML default (the `selected` attribute).
      // This prevents a pre-fill with no bias from overriding the neutral default.
      if (el.tagName === 'SELECT') {
        const hasEmptyOpt = Array.from(el.options).some(o => o.value === '');
        if (hasEmptyOpt) el.value = '';
        // else: leave whatever the HTML `selected` attribute set (e.g. neutral)
      } else {
        el.value = '';
      }
      return;
    }
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

// Compress a screenshot to JPEG before upload so it clears tunnel/proxy body
// limits (~1 MB). Max 1800px wide at 85% quality — sufficient for AI vision.
function compressImage(file, maxWidth = 1800, quality = 0.85) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(resolve, 'image/jpeg', quality);
    };
    img.src = url;
  });
}

// Import-from-screenshots: opens the file picker, uploads each selected image
// to /signals/screenshots, and reports back. AI extraction + form prefill are
// not wired yet — for now this just gets the bytes to the server.
function openScreenshotPicker() {
  $('#screenshot-input').click();
}

const MAX_SCREENSHOTS = 1;

async function uploadScreenshots(evt) {
  const input = evt.target;
  const files = Array.from(input.files ?? []);
  if (files.length === 0) return;
  if (files.length > MAX_SCREENSHOTS) {
    setSubmitStatus(
      tx('Only one screenshot is supported — upload the IV Smile chart.'),
      'err',
    );
    input.value = '';
    return;
  }

  clearAiBanner();
  openFormModal();
  showAiBusy(
    tx('Uploading screenshot…'),
    tx('Sending image to the server.'),
  );

  const results = [];
  try {
    let idx = 0;
    for (const f of files) {
      idx++;
      showAiBusy(
        tx('Uploading screenshot…'),
        f.name,
      );
      const compressed = await compressImage(f);
      const res = await fetch('/signals/screenshots', {
        method: 'POST',
        headers: {
          'content-type': 'image/jpeg',
          'x-filename': encodeURIComponent(f.name),
        },
        body: compressed,
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
    tx('AI is reading the screenshot…'),
    tx('Extracting BUY/SELL levels, ranges, DVS, and VWAP. This usually takes 5–20 seconds.'),
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
  if (extracted?.signal) {
    // Force bias to neutral regardless of what the AI extracted — analyst sets this manually.
    if (extracted.signal.bias) extracted.signal.bias.direction = 'neutral';
    fillForm(extracted.signal, { resetDateTime: false });
  }
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
    det.open = true;
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

const FUN_MODE_KEY = 'trident-fun-mode';
function isFunMode() { return localStorage.getItem(FUN_MODE_KEY) === 'true'; }
function showFunModeToast(on) {
  let toast = $('#fun-mode-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'fun-mode-toast';
    document.body.append(toast);
  }
  toast.textContent = on ? '🎉 Fun mode on' : 'Fun mode off';
  toast.className = 'fun-toast fun-toast--show';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.className = 'fun-toast'; }, 2000);
}

function showCertaintyOverlay() {
  if (!isFunMode()) return;
  const el = $('#certainty-overlay');
  if (!el) return;
  el.hidden = false;
  el.classList.remove('fade-out');
  setTimeout(() => {
    el.classList.add('fade-out');
    el.addEventListener('animationend', () => { el.hidden = true; }, { once: true });
  }, 4000);
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
function updateFormScrollHint() {
  const form = $('#signal-form');
  const hint = $('.form-scroll-hint');
  const grad = $('.form-scroll-gradient');
  if (!form || !hint) return;
  const atBottom = form.scrollHeight - form.scrollTop <= form.clientHeight + 4;
  hint.classList.toggle('is-hidden', atBottom);
  if (grad) grad.classList.toggle('is-hidden', atBottom);
}

function openFormModal() {
  const dlg = $('#form-dialog');
  if (!dlg.open) dlg.showModal();
  // Reset scroll to top and re-evaluate hint visibility.
  const form = $('#signal-form');
  if (form) form.scrollTop = 0;
  updateFormScrollHint();
}
function closeFormModal() {
  const dlg = $('#form-dialog');
  if (dlg.open) dlg.close();
}

// ---------------------------------------------------------------------------
// Status dialog: read-only "what is the engine doing right now" view.
// Fetches the loaded signal from /signals/latest so values are fresh.
// ---------------------------------------------------------------------------
function collectForm() {
  // Build SignalFile from dotted-name inputs.
  const form = $('#signal-form');
  const signal = {
    schema_version: '1.0',
    meta: {}, volatility: {}, vwap: {}, ranges: {}, levels: {},
    levels_recal: {
      level_time: null, max_sell_1: null, max_sell_2: null,
      max_buy_1: null,  max_buy_2: null,
      additional: [],
    },
    bias: {},
  };
  const numericFields = new Set([
    'meta.update_seq', 'meta.futures_last', 'meta.cash_last', 'meta.basis',
    'volatility.dvs', 'volatility.dvs_prior', 'volatility.skew',
    'vwap.value',
    'ranges.range_1_up', 'ranges.range_2_up', 'ranges.range_2_down', 'ranges.range_1_down',
    'levels.max_sell_1', 'levels.max_sell_2', 'levels.max_buy_1', 'levels.max_buy_2',
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
  // TODO: remove once ranges.* confirmed redundant with FB — auto-derive from levels so the
  // hidden Ranges fieldset (and manual-entry path) never sends null ranges to the validator.
  // Derive each range value independently so a buy-only or sell-only setup still works.
  const lv = signal.levels;
  if (signal.ranges.range_1_up   == null && lv.max_sell_1 != null) signal.ranges.range_1_up   = lv.max_sell_1;
  if (signal.ranges.range_2_up   == null && lv.max_sell_2 != null) signal.ranges.range_2_up   = lv.max_sell_2;
  if (signal.ranges.range_2_down == null && lv.max_buy_2  != null) signal.ranges.range_2_down = lv.max_buy_2;
  if (signal.ranges.range_1_down == null && lv.max_buy_1  != null) signal.ranges.range_1_down = lv.max_buy_1;
  // Drop empty optional fields so the YAML stays clean.
  if (signal.meta.contract == null || signal.meta.contract === '') delete signal.meta.contract;
  if (!signal.bias?.direction) delete signal.bias;
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
  if (/^dvs \(/.test(msg)) fields.add('volatility.dvs');
  if (/Setup is stale/.test(msg)) {
    fields.add('meta.timestamp');
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
    showCertaintyOverlay();
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
  addRow(tx('Daily lock'), state.dailyLocked ? tx('Locked — no more trades today') : tx('Not locked (one winning trade triggers the lock)'));
  if (state.currentSignal) {
    const cs = state.currentSignal;
    addRow(tx('Current setup'), `${baseName(cs.filePath) || '—'} (seq ${cs.updateSeq})`);
  } else {
    addRow(tx('Current setup'), tx('None loaded'));
  }
  if (state.openPosition) {
    const p = state.openPosition;
    const beTag = p.breakEvenActive ? ` • ${tx('BE')}` : '';
    addRow(tx('Open position'),
      `${p.direction.toUpperCase()} • ${tx('avg entry')} ${fmtNum(p.avgEntry)} • ${tx('stop')} ${fmtNum(p.currentStop)} • ${p.fills} ${tx('fill(s)')}${beTag}`);
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

/**
 * Computes a worst-case stop price for one side of the trade plan.
 * Uses the same midpoint formula as the trade plan display (raw midpoint,
 * no config ±offset — Entry 2 is approximate but accurate within 2 pts).
 * Allocations are the fixed 32.5 / 35 / 32.5 split.
 * Returns null if stopPoints is unknown or inner level is absent.
 */
function worstCaseStop(direction, inner, outer, stopPts) {
  const present = v => v != null && v !== '';
  if (!stopPts || !present(inner)) return null;
  const e1 = Number(inner);
  const e3 = present(outer) ? Number(outer) : null;
  const avgEntry = e3 != null
    ? (e1 * 32.5 + (((e1 + e3) / 2) * 35) + e3 * 32.5) / 100
    : e1;
  const stop = direction === 'long' ? avgEntry - stopPts : avgEntry + stopPts;
  const ctx = e3 != null
    ? tx('worst case if all 3 fill')
    : tx('single entry');
  return `🛑 ${tx('Stop')}: ${fmtNum(stop)} (${tx('pre-trade estimate')} — ${ctx}, ${stopPts} ${tx('pts from avg entry')})`;
}

function buildTradePlanNote(signal) {
  const l = signal.levels, bias = signal.bias;
  const dir = bias?.direction?.toLowerCase();

  const has = v => v != null && v !== '';
  const parts = [];

  // Two-sided: neutral bias with both level pairs present — engine watches both Entry 1s.
  const isTwoSided = dir === 'neutral' && has(l.max_buy_2) && has(l.max_sell_2);

  const biasNote = dir === 'long'    ? tx('Bias: long.')
                 : dir === 'short'   ? tx('Bias: short.')
                 : dir === 'neutral' ? (isTwoSided
                     ? tx('Bias: neutral — watching both sides, first trigger wins.')
                     : tx('Bias: neutral — one side only (incomplete level pair on the other side).'))
                 :                     tx('No bias set — defaulting to long.');
  parts.push(biasNote);

  if (isTwoSided) {
    // Show both chains side by side.
    const midBuy = has(l.max_buy_1) ? (Number(l.max_buy_1) + Number(l.max_buy_2)) / 2 : null;
    let buyStr = '⬆️ ' + tx('Buy entry: watching for {price} BUY INNER (Entry 1)').replace('{price}', fmtNum(l.max_buy_2));
    if (midBuy != null) buyStr += ' → ' + tx('{price} mid (Entry 2, derived)').replace('{price}', fmtNum(midBuy));
    if (has(l.max_buy_1)) buyStr += ' → ' + tx('{price} BUY OUTER (Entry 3)').replace('{price}', fmtNum(l.max_buy_1));
    parts.push(buyStr + ' → ' + tx('engine enters long.'));
    const buyStop = worstCaseStop('long', l.max_buy_2, l.max_buy_1, state.stopPoints);
    if (buyStop) parts.push(buyStop);

    const midSell = has(l.max_sell_1) ? (Number(l.max_sell_1) + Number(l.max_sell_2)) / 2 : null;
    let sellStr = '⬇️ ' + tx('Sell entry: watching for {price} SELL INNER (Entry 1)').replace('{price}', fmtNum(l.max_sell_2));
    if (midSell != null) sellStr += ' → ' + tx('{price} mid (Entry 2, derived)').replace('{price}', fmtNum(midSell));
    if (has(l.max_sell_1)) sellStr += ' → ' + tx('{price} SELL OUTER (Entry 3)').replace('{price}', fmtNum(l.max_sell_1));
    parts.push(sellStr + ' → ' + tx('engine enters short.'));
    const sellStop = worstCaseStop('short', l.max_sell_2, l.max_sell_1, state.stopPoints);
    if (sellStop) parts.push(sellStop);
  } else {
    // Single-sided: bias=long, bias=short, or neutral with only one pair of levels.
    const effectiveDir = (dir === 'short') ? 'short' : 'long';

    if (effectiveDir === 'long' && has(l.max_buy_2)) {
      const midBuy = has(l.max_buy_1) ? (Number(l.max_buy_1) + Number(l.max_buy_2)) / 2 : null;
      let s = '⬆️ ' + tx('Buy entry: watching for {price} BUY INNER (Entry 1)').replace('{price}', fmtNum(l.max_buy_2));
      if (midBuy != null) s += ' → ' + tx('{price} mid (Entry 2, derived)').replace('{price}', fmtNum(midBuy));
      if (has(l.max_buy_1)) s += ' → ' + tx('{price} BUY OUTER (Entry 3)').replace('{price}', fmtNum(l.max_buy_1));
      parts.push(s + ' → ' + tx('engine enters long.'));
      const buyStop = worstCaseStop('long', l.max_buy_2, l.max_buy_1, state.stopPoints);
      if (buyStop) parts.push(buyStop);
    }
    if (effectiveDir === 'short' && has(l.max_sell_2)) {
      const midSell = has(l.max_sell_1) ? (Number(l.max_sell_1) + Number(l.max_sell_2)) / 2 : null;
      let s = '⬇️ ' + tx('Sell entry: watching for {price} SELL INNER (Entry 1)').replace('{price}', fmtNum(l.max_sell_2));
      if (midSell != null) s += ' → ' + tx('{price} mid (Entry 2, derived)').replace('{price}', fmtNum(midSell));
      if (has(l.max_sell_1)) s += ' → ' + tx('{price} SELL OUTER (Entry 3)').replace('{price}', fmtNum(l.max_sell_1));
      parts.push(s + ' → ' + tx('engine enters short.'));
      const sellStop = worstCaseStop('short', l.max_sell_2, l.max_sell_1, state.stopPoints);
      if (sellStop) parts.push(sellStop);
    }
  }

  if (has(signal.vwap?.value)) {
    parts.push('🎯 ' + tx('Profit target: VWAP at {vwap} — entire position closes when price reaches VWAP.').replace('{vwap}', fmtNum(signal.vwap.value)));
  }

  const note = el('div', { class: 'trade-plan-note' });
  note.append(el('span', { class: 'trade-plan-label', text: 'Trade plan — ' }));
  note.append(document.createTextNode(parts.join('  ')));

  // Add risk amount in footnote (assumes 0.5% daily risk from config)
  const acct = state.account;
  const dailyRiskAmount = acct ? (acct.balance * 0.005).toFixed(2) : null;

  note.append(document.createElement('br'));
  const fn = document.createElement('span');
  fn.className = 'trade-plan-footnote';
  if (dailyRiskAmount && acct) {
    // Risk amount is the configured daily risk (0.5% of account balance per config).
    // Actual realized risk depends on fill prices; this is the planned risk.
    const CURRENCY_SYMBOLS = { EUR: '€', USD: '$', GBP: '£', JPY: '¥', AUD: 'A$', CAD: 'C$', CHF: 'Fr' };
    const sym = CURRENCY_SYMBOLS[acct.currency] ?? acct.currency ?? 'EUR';
    const amount = `${sym}${dailyRiskAmount}`;
    const baseText = tx('ℹ️ Once in a trade the status panel shows the live stop. Full position (all 3 tranches) risks ');
    const riskText = tx('(0.5% of account).');
    fn.append(document.createTextNode(baseText));
    const boldAmount = document.createElement('strong');
    boldAmount.className = 'trade-plan-risk-amount';
    boldAmount.textContent = amount;
    fn.append(boldAmount);
    fn.append(document.createTextNode(` ${riskText}`));
  } else {
    fn.textContent = tx('ℹ️ Once in a trade the status panel shows the live stop.');
  }
  note.append(fn);

  return note;
}

function buildSummarySection(signal) {
  const sec = el('section', { class: 'confirm-section' });
  sec.append(el('h3', { text: tx('Setup summary') }));
  sec.append(buildTradePlanNote(signal));
  const grid = el('div', { class: 'confirm-grid' });
  const m = signal.meta, v = signal.volatility, w = signal.vwap, r = signal.ranges, l = signal.levels;

  const row = (k, val) => {
    grid.append(el('span', { class: 'k', text: k }));
    grid.append(el('span', { class: 'v', text: val }));
  };
  row(tx('Date / time'), `${m.date} ${m.timestamp} (seq ${m.update_seq})`);
  row(tx('Futures / Cash / Basis'), `${fmtNum(m.futures_last)}  /  ${fmtNum(m.cash_last)}  /  ${fmtNum(m.basis)}`);
  row(tx('DVS / regime'), `${fmtNum(v.dvs)} (${tx(v.regime)})  • prior ${fmtNum(v.dvs_prior)}`);
  row(tx('VWAP'), `${fmtNum(w.value)} @ ${w.updated_at}`);
  // TODO: remove ranges summary row once ranges.* confirmed redundant with FB
  const _midSell = (l.max_sell_1 != null && l.max_sell_2 != null) ? (Number(l.max_sell_1) + Number(l.max_sell_2)) / 2 : null;
  const _midBuy  = (l.max_buy_1  != null && l.max_buy_2  != null) ? (Number(l.max_buy_1)  + Number(l.max_buy_2))  / 2 : null;
  row(tx('SELL levels'), `INNER ${fmtNum(l.max_sell_2)}  →  mid ${fmtNum(_midSell)} (derived)  →  OUTER ${fmtNum(l.max_sell_1)}`);
  row(tx('BUY levels'),  `INNER ${fmtNum(l.max_buy_2)}  →  mid ${fmtNum(_midBuy)} (derived)  →  OUTER ${fmtNum(l.max_buy_1)}`);
  if (signal.bias?.direction) {
    row(tx('Bias'), signal.bias.direction);
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

  // TODO: remove range ordering check once ranges.* confirmed redundant with FB
  // (ranges are auto-derived from levels so ordering is guaranteed; the check is noise)

  // 3. Level ordering (ES futures) BUY OUTER < BUY INNER < SELL INNER < SELL OUTER
  const lvls = [l.max_buy_1, l.max_buy_2, l.max_sell_2, l.max_sell_1];
  if (lvls.every(x => x != null)) {
    const ok = l.max_buy_1 < l.max_buy_2 && l.max_buy_2 < l.max_sell_2 && l.max_sell_2 < l.max_sell_1;
    out.push(ok
      ? { status: 'ok',  title: tx('Level ordering correct'), detail: 'BUY OUTER < BUY INNER < SELL INNER < SELL OUTER' }
      : { status: 'err', title: tx('Level ordering broken'),  detail: tx('Expected: BUY OUTER < BUY INNER < SELL INNER < SELL OUTER') });
  }

  // 3b. Tradeable pair coverage — engine needs at least one full pair.
  const hasBuyPair  = l.max_buy_1  != null && l.max_buy_2  != null;
  const hasSellPair = l.max_sell_1 != null && l.max_sell_2 != null;
  if (!hasBuyPair && !hasSellPair) {
    out.push({ status: 'err', title: tx('No tradeable level pair — engine will not enter'),
      detail: tx('Provide both BUY INNER+OUTER or both SELL INNER+OUTER.') });
  } else if (hasBuyPair !== hasSellPair) {
    out.push({ status: 'warn', title: tx('Only one side has levels — engine will trade that side only'),
      detail: hasBuyPair ? 'BUY INNER+OUTER only (no shorts will fire)' : 'SELL INNER+OUTER only (no longs will fire)' });
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

  // 6. Level summary (ES futures — same units as engine price feed)
  if (lvls.every(x => x != null)) {
    const midSell = (Number(l.max_sell_1) + Number(l.max_sell_2)) / 2;
    const midBuy  = (Number(l.max_buy_1)  + Number(l.max_buy_2))  / 2;
    out.push({
      status: 'ok',
      title: tx('Levels summary (ES futures)'),
      detail:
        `SELL  INNER ${fmtNum(l.max_sell_2)} → mid ${fmtNum(midSell)} → OUTER ${fmtNum(l.max_sell_1)}` +
        `  |  BUY  INNER ${fmtNum(l.max_buy_2)} → mid ${fmtNum(midBuy)} → OUTER ${fmtNum(l.max_buy_1)}`,
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
  $('#btn-new').addEventListener('click', () => { resetForNewSignal(); openFormModal(); });
  $('#btn-update').addEventListener('click', () => { bumpUpdateSeq(); openFormModal(); });
  $('#btn-prefill').addEventListener('click', async () => {
    await prefillFromLatest();
    openFormModal();
  });
  $('#btn-import-screenshots').addEventListener('click', openScreenshotPicker);
  $('#screenshot-input').addEventListener('change', uploadScreenshots);

  // Reset engine button.
  $('#btn-reset-engine').addEventListener('click', async () => {
    const confirmed = confirm(i18n.t('Reset engine?'));
    if (!confirmed) return;

    try {
      const res = await fetch('/engine/reset', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        alert(i18n.t('Engine reset to {state}', { state: data.state }));
        // Refresh status pane
        if (ws && ws.readyState === WebSocket.OPEN) {
          // WebSocket will send a bootstrap update
        }
      } else {
        const data = await res.json();
        alert(i18n.t('Reset failed: {error}', { error: data.error }));
      }
    } catch (err) {
      alert(i18n.t('Reset error: {msg}', { msg: String(err) }));
    }
  });

  // Form modal close (X button).
  $('#btn-form-close').addEventListener('click', closeFormModal);

  // Help dialog open + close.
  $('#btn-help').addEventListener('click', () => {
    const dlg = $('#help-dialog');
    if (!dlg.open) dlg.showModal();
    // Re-check scroll position each time the dialog opens (content may not need scrolling)
    updateHelpScroll();
  });
  const _helpBody = $('#help-dialog-body');
  function updateHelpScroll() {
    const wrap = _helpBody.closest('.help-body-wrap');
    if (!wrap) return;
    const atBottom = _helpBody.scrollHeight - _helpBody.scrollTop <= _helpBody.clientHeight + 4;
    wrap.classList.toggle('at-bottom', atBottom);
  }
  _helpBody.addEventListener('scroll', updateHelpScroll);
  $('#btn-help-close').addEventListener('click', () => $('#help-dialog').close());
  $('#btn-help-ok').addEventListener('click', () => $('#help-dialog').close());

  // Fun mode checkbox — sync with localStorage on open and on change.
  $('#btn-help').addEventListener('click', () => {
    const cb = $('#fun-mode-checkbox');
    if (cb) cb.checked = isFunMode();
  }, true); // capture phase so it fires before the dialog opens
  const _funCb = $('#fun-mode-checkbox');
  if (_funCb) {
    _funCb.addEventListener('change', () => {
      if (_funCb.checked) localStorage.setItem(FUN_MODE_KEY, 'true');
      else localStorage.removeItem(FUN_MODE_KEY);
      showFunModeToast(_funCb.checked);
    });
  }

  // Logo easter egg: click 5 times quickly to toggle fun mode.
  let _logoClicks = 0, _logoTimer = null;
  $('.brand-logo')?.addEventListener('click', () => {
    _logoClicks++;
    clearTimeout(_logoTimer);
    _logoTimer = setTimeout(() => { _logoClicks = 0; }, 1500);
    if (_logoClicks >= 5) {
      _logoClicks = 0;
      const next = !isFunMode();
      if (next) localStorage.setItem(FUN_MODE_KEY, 'true');
      else localStorage.removeItem(FUN_MODE_KEY);
      const cb = $('#fun-mode-checkbox');
      if (cb) cb.checked = next;
      showFunModeToast(next);
    }
  });

  // VWAP Calculate button: fetch live VWAP from the server and populate the field.
  $('#vwap-calc-btn').addEventListener('click', async () => {
    const btn       = $('#vwap-calc-btn');
    const input     = $('#signal-form').elements['vwap.value'];
    const updatedAt = $('#signal-form').elements['vwap.updated_at'];
    const errEl     = (() => {
      let el = document.getElementById('vwap-calc-error');
      if (!el) {
        el = document.createElement('span');
        el.id = 'vwap-calc-error';
        el.style.cssText = 'color:#f87171;font-size:10px;display:block;margin-top:2px;';
        btn.closest('label').appendChild(el);
      }
      return el;
    })();

    btn.disabled  = true;
    btn.textContent = '…';
    errEl.textContent = '';

    try {
      const res  = await fetch('/api/vwap');
      const data = await res.json();
      if (!res.ok) {
        errEl.textContent = data.error ?? 'VWAP fetch failed';
        return;
      }
      input.value = String(data.vwap);
      if (updatedAt) {
        const now = new Date();
        updatedAt.value = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      }
    } catch {
      errEl.textContent = 'Network error — is the server reachable?';
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Calculate';
    }
  });

  $('#signal-form').addEventListener('scroll', updateFormScrollHint);

  $('#btn-clear-log').addEventListener('click', () => { $('#log').innerHTML = ''; });
  $('#btn-lang').addEventListener('click', toggleLang);
  document.querySelectorAll('[data-lang-toggle]').forEach(btn => btn.addEventListener('click', toggleLang));
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
