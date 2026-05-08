## 1. Observability Module Scaffold

- [x] 1.1 Create `src/observability/types.ts` with `MetricsBackend` interface (all 7 methods)
- [x] 1.2 Create `src/observability/NoopBackend.ts` implementing `MetricsBackend` with empty methods
- [x] 1.3 Create `src/observability/index.ts` exporting `buildMetricsBackend(mode: string | undefined): MetricsBackend` factory that returns `NoopBackend` for unknown/absent modes

## 2. Prometheus Backend

- [x] 2.1 Add `prom-client` to `package.json` dependencies
- [x] 2.2 Create `src/observability/PrometheusBackend.ts` — register all 8 `trident_*` metrics plus enable default Node.js collectors
- [x] 2.3 Implement all `MetricsBackend` methods in `PrometheusBackend` mapping to the registered instruments
- [x] 2.4 Register `GET /metrics` route on the Express app in `src/web/server.ts` — conditionally, only when a `metricsHandler` is passed in (inject from `index.ts`)
- [x] 2.5 Update `startWebServer` signature to accept an optional `metricsHandler` parameter
- [x] 2.6 Wire `PrometheusBackend.metricsHandler()` into `startWebServer` call in `index.ts` when mode is `prometheus`

## 3. OpenTelemetry Backend

- [x] 3.1 Add `@opentelemetry/sdk-node`, `@opentelemetry/api`, `@opentelemetry/exporter-metrics-otlp-grpc`, and `@opentelemetry/sdk-metrics` to `package.json` dependencies
- [x] 3.2 Create `src/observability/OtelBackend.ts` — initialise MeterProvider with OTLP gRPC exporter, read endpoint/headers from env vars, default export interval 60s
- [x] 3.3 Implement all `MetricsBackend` methods in `OtelBackend` mapping to the registered OTel instruments
- [x] 3.4 Ensure `OtelBackend` shuts down the MeterProvider cleanly on process exit (wire into `shutdown()` in `index.ts`)

## 4. Startup Flag and Wiring

- [x] 4.1 Parse `--observability=<mode>` in `index.ts` argument parsing (alongside existing `--config`, `--mock`, `--signal`)
- [x] 4.2 Call `buildMetricsBackend(observabilityMode)` in `index.ts` and store the result
- [x] 4.3 Emit startup log line for prometheus mode: `Prometheus metrics available at :<port>/metrics`
- [x] 4.4 Emit startup log line for otel mode: `OpenTelemetry metrics exporting to <endpoint>`

## 5. Instrumentation — Feed and Connection

- [x] 5.1 Wrap the feed callback in `index.ts` to call `backend.recordTick(price)` before forwarding to `engine.onPriceUpdate`
- [x] 5.2 Call `backend.recordConnectionState(true)` after `connect()` resolves in `connectWithRetry`
- [x] 5.3 Call `backend.recordConnectionState(false)` in the catch block of `connectWithRetry`
- [x] 5.4 Implement tick-rate counter in `index.ts`: track tick count, reset every 60s, call `backend.setTickRate(n)`

## 6. Instrumentation — Engine Events via MetricsNotifier

- [x] 6.1 Create `src/observability/MetricsNotifier.ts` implementing `Notifier` interface — wraps a `MetricsBackend` and maps `NotificationEvent` types to backend calls
- [x] 6.2 Handle `SETUP_READY` → `recordEngineState('watching')`
- [x] 6.3 Handle `ENTRY_TRIGGERED` (entry 1) → `recordEngineState('in_trade')`, all entries → `recordEntry(entryNum, direction)`
- [x] 6.4 Handle `POSITION_CLOSED` → `recordEngineState('closed')`, `recordClose(reason, pnlPoints)`
- [x] 6.5 Handle `DVS_GATE_BLOCKED` → `recordEngineState('blocked')`
- [x] 6.6 Push `MetricsNotifier` instance onto `MultiNotifier` children in `index.ts` when observability is enabled

## 7. Signal Load Instrumentation

- [x] 7.1 Wrap `engine.loadSignal()` call in `index.ts` (or in the watcher callback) to call `backend.recordSignalLoaded(valid)` based on the engine's validation outcome — use the existing `loadSignal` return value or notifier event to determine validity

## 8. Self-Hosted Docker Compose Profile

- [x] 8.1 Add `prometheus` service to `docker-compose.yml` under the `observability` profile with a static scrape config targeting `trident:3000/metrics` at 15s interval
- [x] 8.2 Add `grafana` service to `docker-compose.yml` under the `observability` profile, exposed on port 3001
- [x] 8.3 Create `docker/prometheus/prometheus.yml` with the scrape configuration
- [x] 8.4 Create `docker/grafana/provisioning/datasources/prometheus.yml` provisioning the Prometheus datasource
- [x] 8.5 Create `docker/grafana/provisioning/dashboards/dashboard.yml` provisioning the dashboard provider
- [x] 8.6 Create `docker/grafana/dashboards/trident.json` — Grafana dashboard with panels: tick rate, engine state, entries/closes, last P&L, feed connected

## 9. Tests

- [x] 9.1 Unit test `NoopBackend` — all methods callable without error
- [x] 9.2 Unit test `PrometheusBackend` — verify metric values after calling each backend method
- [x] 9.3 Unit test `MetricsNotifier` — verify correct backend methods are called for each `NotificationEvent` type
- [x] 9.4 Integration test — start engine with `--observability=prometheus` in test mode, hit `/metrics`, assert `trident_*` metric names are present in response body

## 10. Documentation

- [x] 10.1 Update `RUNNING.md` — add "Observability" section covering self-hosted Compose profile activation and the `/metrics` endpoint
- [x] 10.2 Update `RUNNING.md` — add "Grafana Cloud (OTel)" subsection covering account creation, service account token, `.env` variables, and dashboard import
- [x] 10.3 Update `developer-mental-notes.md` — document the `MetricsNotifier` pattern and why instrumentation lives in `index.ts` rather than inside engine classes
