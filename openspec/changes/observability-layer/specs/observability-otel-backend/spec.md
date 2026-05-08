## ADDED Requirements

### Requirement: OTel backend activation
The system SHALL activate the OpenTelemetry backend when the process is started with `--observability=otel`. The OTel SDK SHALL be initialised before any instrumentation calls are made.

#### Scenario: OTel mode activated at startup
- **WHEN** the process starts with `--observability=otel`
- **THEN** the OTel MeterProvider is initialised with a gRPC OTLP metrics exporter and all instrumentation points use the OTel backend

#### Scenario: OTel mode not activated
- **WHEN** the process starts without `--observability=otel`
- **THEN** no OTel SDK is initialised and no OTLP connections are attempted

### Requirement: OTel metric instruments
The `OtelBackend` SHALL register the following instruments against a `trident` meter:

- `trident.ticks` — UpDownCounter (or Counter). Total ticks received.
- `trident.tick_rate` — ObservableGauge. Ticks per minute, updated on each `setTickRate` call.
- `trident.signal_loads` — Counter. Total signal load attempts. Attribute: `valid` (`true`/`false`).
- `trident.engine_state` — ObservableGauge. Engine state as integer (idle=0, blocked=1, watching=2, in_trade=3, closed=4).
- `trident.entries` — Counter. Entry fills. Attributes: `entry_num`, `direction`.
- `trident.closes` — Counter. Position closes. Attribute: `reason`.
- `trident.pnl_points` — ObservableGauge. P&L in points of the most recently closed position.
- `trident.feed_connected` — ObservableGauge. 1 when connected, 0 when disconnected.

#### Scenario: OTel counter increments on entry
- **WHEN** entry 3 fills on a short trade
- **THEN** `trident.entries` is incremented with attributes `{entry_num: 3, direction: "short"}`

### Requirement: OTLP export configuration via environment variables
The system SHALL configure the OTLP exporter exclusively from standard OpenTelemetry environment variables. No custom env vars SHALL be introduced. The relevant variables are:

- `OTEL_EXPORTER_OTLP_ENDPOINT` — OTLP gRPC endpoint URL (default: `http://localhost:4317`)
- `OTEL_EXPORTER_OTLP_HEADERS` — comma-separated `key=value` pairs for auth headers
- `OTEL_SERVICE_NAME` — service name reported in metrics (default: `trident`)

This allows the same Docker image to target a local Prometheus OTLP receiver or Grafana Cloud by changing only env vars in `.env`.

#### Scenario: Grafana Cloud configuration
- **WHEN** `.env` contains a valid `OTEL_EXPORTER_OTLP_ENDPOINT` pointing at a Grafana Cloud OTLP endpoint and `OTEL_EXPORTER_OTLP_HEADERS` contains a valid Bearer token
- **THEN** metrics are exported to Grafana Cloud without any code or image changes

#### Scenario: Default endpoint used when not configured
- **WHEN** `OTEL_EXPORTER_OTLP_ENDPOINT` is not set
- **THEN** the exporter targets `http://localhost:4317`

### Requirement: OTel export interval
The system SHALL configure the OTel metrics export interval to 60 seconds by default. The interval SHALL be overridable via the standard `OTEL_METRIC_EXPORT_INTERVAL` env var (value in milliseconds).

#### Scenario: Metrics exported on schedule
- **WHEN** 60 seconds elapse after the last export
- **THEN** the OTel MeterProvider flushes all instrument readings to the OTLP exporter

### Requirement: OTel startup log
The system SHALL emit a startup log line at `info` level when OTel mode is active, stating the configured OTLP endpoint, so the operator can confirm the export target before relying on dashboard data.

#### Scenario: OTel mode starts with explicit endpoint
- **WHEN** the process starts with `--observability=otel` and `OTEL_EXPORTER_OTLP_ENDPOINT=https://example.grafana.net/otlp`
- **THEN** a log line is emitted containing the text `OpenTelemetry metrics exporting to https://example.grafana.net/otlp`

#### Scenario: OTel mode starts with default endpoint
- **WHEN** the process starts with `--observability=otel` and `OTEL_EXPORTER_OTLP_ENDPOINT` is not set
- **THEN** a log line is emitted containing `OpenTelemetry metrics exporting to http://localhost:4317`

### Requirement: Grafana Cloud setup documentation
`RUNNING.md` SHALL include a section documenting how to connect the engine to Grafana Cloud free tier using OTel mode. The section SHALL cover:
- Creating a Grafana Cloud account and stack
- Generating a service account token with MetricsPublisher role
- Setting `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` in `.env`
- Starting the engine with `--observability=otel`
- Importing the provided Grafana dashboard JSON into the cloud stack

#### Scenario: Operator follows Grafana Cloud setup guide
- **WHEN** an operator follows the RUNNING.md Grafana Cloud section with valid credentials
- **THEN** metrics appear in Grafana Cloud within 2 export intervals (≤120 seconds) of engine startup
