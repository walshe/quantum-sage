# Quantum Sage — Architecture

High-level map of the system. For implementation detail, non-obvious constraints, and past decisions see the [developer mental notes](trident/impl/nodejs/developer-mental-notes.md).

---

## Components

```
Analyst (FB)
    │  submits screenshots or setup YAML via web dashboard
    ▼
┌─────────────────────────────────────────────────────────┐
│  qs-signal-engine  (Node.js / TypeScript)               │
│                                                         │
│  Config loader         Signal validator                 │
│  TridentEngine ─────── Calculator (pure)                │
│  Snapshot / persistence                                 │
│                                                         │
│  AI extraction pipeline (src/ai/):                      │
│    Guardrail      — injection screening + session stats │
│    SignalExtractor — orchestrates the AI call           │
│    OutputValidator — runtime shape + range checks       │
│    LlmLogger      — per-call audit log (LLM_CALL)      │
│    PiiRedactor    — redacts PII from log content        │
│    OpenAIProvider — GPT-4o vision API                   │
│                                                         │
│  MultiNotifier fan-out:                                 │
│    ConsoleNotifier  (human-readable)                    │
│    LoggerNotifier   (structured JSON)                   │
│    WebSocketNotifier (browser dashboard)                │
│    MetricsNotifier  (opt-in metrics)                    │
└────────┬───────────────────────┬────────────────────────┘
         │                       │
    cTrader feed            Web dashboard
    (WebSocket)             :3000
    price ticks
```

---

## Data flow

1. **Setup file** — analyst submits via the web form (`POST /signals`); the server validates and writes `qs_setup_YYYY-MM-DD_HHmm.yaml` atomically to `setups/`. `fs.watch` detects the file and calls `TridentEngine.loadSignal()`.
2. **AI extraction** (optional) — analyst uploads chart screenshots (`POST /signals/extract`); `SignalExtractor` screens for injection, calls the vision LLM, validates the response shape and ranges, and returns a pre-filled signal payload. Logs a structured `LLM_CALL` entry per call and emits `AI_SESSION_METRICS` on shutdown.
3. **Price ticks** — `CTraderPriceFeed` streams live bid/ask over WebSocket; `onPriceUpdate(price)` drives the engine's entire decision loop every tick.
4. **Engine events** — state transitions (`SETUP_READY`, `ENTRY_TRIGGERED`, `POSITION_CLOSED`, etc.) are emitted to the `MultiNotifier` chain and fanned out to all registered notifiers in parallel.
5. **Observability** (optional) — when `TRIDENT_OBSERVABILITY=prometheus`, a `/metrics` endpoint is registered on the Express server and Prometheus scrapes it. Promtail ships container stdout (JSON) to Loki; Grafana visualises both. AI audit events (`LLM_CALL`, `AI_SESSION_METRICS`, `INJECTION_BLOCKED`, `OUTPUT_VALIDATION_FAILED`) land in the same Loki stream.

---

## Technology stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (TypeScript, ESM) |
| Distribution | Docker — `ghcr.io/walshe/trident:latest` |
| Web server | Express + `ws` (WebSocket) |
| Logging | Winston — coloured TTY, JSON in Docker |
| Metrics | `prom-client` (Prometheus mode) or OpenTelemetry SDK (OTel mode) |
| Observability stack | Prometheus · Grafana · Loki · Promtail (Docker Compose profile) |

---

## Phases

| Phase | Status | Description |
|---|---|---|
| 1 | **Current** | Human analyst submits setup; human trader executes signals manually at broker |
| 2 | Future | Auto-execution via cTrader Open API (same WebSocket, extended to send orders) |
| 3 | Future | Automated analysis pipeline replaces the human analyst |

The setup file schema is the stable interface between phases — only the producer (human vs. pipeline) and consumer (manual vs. auto) change.

---

## Key design invariants

- **Engine never imports a concrete feed, notifier, or observability backend** — only interfaces. Swap implementations in `index.ts`.
- **Validator is the only trust boundary** — once a setup passes, the engine trusts all values.
- **Calculator functions are pure** — all maths is side-effect-free and independently testable.
- **One engine instance per day** — the snapshot mechanism is not designed for concurrent writers.
