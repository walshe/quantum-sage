## Context

The engine runs as an opaque process. Operators currently have two visibility channels: Winston log output (requires terminal/SSH access) and the browser dashboard (trading events only). There is no metrics endpoint, no connection health signal visible to external tooling, and no way to wire the engine into alerting or dashboards without scraping logs.

The app is distributed as a Docker image pulled by the analyst and run via `docker-compose up`. Any self-hosted monitoring stack must compose naturally alongside the core service. The analyst also runs the engine remotely on a VPS where self-hosted infra may be impractical, making a managed cloud backend (Grafana Cloud free tier) a necessary second path.

The existing optional-feature pattern (AI extraction, cTrader feed) is the model: absent when not configured, no code path active, no dependency loaded.

## Goals / Non-Goals

**Goals:**
- Add opt-in metrics instrumentation with zero overhead when disabled
- Two backends: `prom-client` (Prometheus mode) and OpenTelemetry SDK (OTel mode)
- Self-hosted monitoring path: Docker Compose `observability` profile adds Prometheus + Grafana alongside the core service
- Cloud monitoring path: OTel OTLP export to Grafana Cloud free tier (hosted Prometheus, dashboards, 14-day retention)
- Same metric set regardless of backend (connection uptime, tick frequency, signal latency, execution events)
- Follow existing interface-only architecture: engine does not import concrete observability deps

**Non-Goals:**
- Distributed tracing / spans — metrics only in Phase 1
- Log aggregation (Loki, etc.)
- Alerting rule configuration (Grafana dashboard ships with suggested rules; operator wires them up)
- Authentication on the `/metrics` endpoint (LAN/self-hosted deployment assumption)
- Horizontal scaling or multi-instance aggregation

## Decisions

### 1. Startup flag, not config.yaml

`--observability=prometheus` or `--observability=otel`. Absent = disabled.

Observability is a deployment-time operational concern, not a trading strategy parameter. `config.yaml` is for trading numbers (capital, stops, allocations). CLI flags (`--mock`, `--signal`, `--config`) are already the pattern for operational switches. Mixing observability mode into `config.yaml` would require the analyst to understand and maintain it; a flag keeps the operator's deployment script self-documenting.

### 2. MetricsBackend interface with NoopBackend default

```
MetricsBackend
  recordTick(price: number): void
  recordSignalLoaded(valid: boolean): void
  recordEngineState(state: string): void
  recordEntry(entryNum: number, direction: string): void
  recordClose(reason: string, pnlPoints: number): void
  recordConnectionState(connected: boolean): void
  setTickRate(ticksPerMinute: number): void
```

Both `PrometheusBackend` and `OtelBackend` implement this interface. `NoopBackend` implements it with empty methods and is the default. This mirrors the `PriceFeed` and `Notifier` interface patterns — the engine and its components never import a concrete backend.

Alternative considered: instrument via the existing `NotificationEvent` / `Notifier` chain (add an `ObservabilityNotifier`). Rejected: the notifier is for trader-facing events at coarse granularity. Tick-level metrics (tick rate, processing latency) happen far more frequently than notification events and don't belong in the notification fan-out.

### 3. Instrumentation points in index.ts, not inside engine classes

`index.ts` creates the backend and passes it to components that need it. The `CTraderPriceFeed` callback wrapper records tick metrics at the boundary before forwarding to the engine. High-level events (signal loaded, entry, close) are recorded by wrapping the engine's notifier in a thin `MetricsNotifier` decorator that reads `NotificationEvent` types and calls the backend.

This keeps `TridentEngine`, `CTraderPriceFeed`, and all strategy code free of observability imports — consistent with the "engine never imports a concrete feed or notifier" invariant.

### 4. Prometheus `/metrics` endpoint on the existing Express server

When backend is `PrometheusBackend`, a `GET /metrics` route is registered on the existing Express app (port 3000). No second HTTP server. The Prometheus scrape config in the self-hosted Compose profile targets `trident:3000`.

Alternative: dedicated metrics port (9090 or 9464). Rejected: adds a second port to document, expose in Docker, and configure. The existing server is always running; reusing it is simpler.

### 5. OTel OTLP export — gRPC by default, env-var configured

`@opentelemetry/sdk-node` with `@opentelemetry/exporter-metrics-otlp-grpc`. Endpoint and headers are read from standard OTel env vars (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`) so the same binary works for both self-hosted (local Prometheus OTLP receiver) and Grafana Cloud (remote HTTPS endpoint with Bearer token).

### 6. Docker Compose observability profile

New `observability` profile in `docker-compose.yml` adds `prometheus` and `grafana` services. Core `trident` service unchanged when profile is not active. Prometheus is provisioned with a static scrape config targeting `trident:3000/metrics`. Grafana is provisioned with a Prometheus datasource and pre-built dashboard JSON (shipped in `docker/grafana/`). Operator activates with `docker compose --profile observability up`.

## Risks / Trade-offs

- **prom-client default collectors** → prom-client registers ~15 Node.js process metrics automatically. Useful, but operators should know the `/metrics` endpoint will contain more than just trading metrics. Document in RUNNING.md.
- **OTel SDK startup failure** → if `OTEL_EXPORTER_OTLP_ENDPOINT` is unreachable, the SDK will queue and drop metrics silently. Mitigate with a startup log line showing the configured endpoint so operators can verify the setting before relying on data.
- **Unauthenticated `/metrics`** → acceptable for self-hosted LAN deployments. Cloud deployments using OTel export don't expose `/metrics` externally. Document the exposure in RUNNING.md.
- **prom-client vs OTel feature overlap** → both modes export the same logical metrics but via different APIs. A thin shared `MetricsCollector` layer records raw values; each backend translates to its API. This avoids duplicating metric-recording logic.

## Migration Plan

1. Merge feature branch — no config changes required; `--observability` flag absent means zero-change behaviour for existing deployments.
2. FB activates by adding `--observability=prometheus` to the Docker Compose command and running `docker compose --profile observability up`.
3. For Grafana Cloud: set `OTEL_EXPORTER_OTLP_ENDPOINT` + `OTEL_EXPORTER_OTLP_HEADERS` in `.env`, pass `--observability=otel`.
4. No rollback needed — disabling means removing the flag.

## Open Questions

- Should tick-rate be computed as a rolling window (e.g. 1-minute EMA) or a simple per-interval counter? Rolling window is more useful in dashboards but adds state. Start with a simple per-minute counter; upgrade later.
- Grafana Cloud free tier OTLP endpoint requires a service account token — should we add a `GRAFANA_OTLP_TOKEN` env var as a convenience alias, or rely on the standard `OTEL_EXPORTER_OTLP_HEADERS`? Prefer standard OTel env vars to avoid a custom abstraction.
