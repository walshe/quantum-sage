## Why

The trading engine runs as a black box — there is no visibility into connection health, tick arrival rates, signal latency, or execution timing without digging through logs. An optional observability layer provides real-time metrics that make it practical to monitor the engine in both development and production environments.

## What Changes

- Add a `--observability` startup flag accepting `prometheus` or `otel` as values; absent means no instrumentation
- `prometheus` mode: instruments the app with `prom-client` and exposes a `/metrics` HTTP endpoint
- `otel` mode: instruments the app via the OpenTelemetry SDK, exporting metrics to a configured OTLP endpoint
- Both modes export the same metric set (connection uptime, tick frequency, signal latency, execution performance)
- Add a self-hosted Grafana + Prometheus Docker Compose profile (`--profile observability`) for local/self-hosted use
- Add documentation covering Grafana Cloud free tier setup as the cloud deployment path
- Grafana dashboard definition (JSON) included for both deployment modes

## Capabilities

### New Capabilities
- `observability-metrics`: Core metrics collection and instrumentation — defines what is measured, metric names, labels, and collection points in the engine
- `observability-prometheus-backend`: Prometheus instrumentation via `prom-client`, `/metrics` endpoint exposure, and self-hosted Grafana+Prometheus Compose profile
- `observability-otel-backend`: OpenTelemetry instrumentation via OTel SDK, OTLP export configuration, and Grafana Cloud integration guide

### Modified Capabilities
<!-- none -->

## Impact

- **New dependencies**: `prom-client` (prometheus mode), `@opentelemetry/sdk-node` + OTLP exporter packages (otel mode)
- **Startup**: `src/index.ts` gains `--observability` flag parsing and conditional backend initialisation
- **Engine**: instrumentation hooks added at tick receipt, signal evaluation, and order execution points
- **Docker Compose**: new `observability` profile adds `prometheus` and `grafana` services; existing core service unchanged when profile not active
- **Config**: no `config.yaml` changes — observability is purely a startup switch, keeping operator config minimal
- **Docs**: `RUNNING.md` updated with observability setup instructions for both self-hosted and Grafana Cloud paths
