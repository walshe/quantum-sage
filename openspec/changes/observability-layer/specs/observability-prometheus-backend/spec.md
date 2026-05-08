## ADDED Requirements

### Requirement: Prometheus backend activation
The system SHALL activate the Prometheus backend when the process is started with `--observability=prometheus`. No other configuration SHALL be required for the backend to initialise.

#### Scenario: Prometheus mode activated at startup
- **WHEN** the process starts with `--observability=prometheus`
- **THEN** a `PrometheusBackend` instance is created using `prom-client`, default Node.js process metrics are registered, and the backend is wired into all instrumentation points

#### Scenario: Prometheus mode not activated
- **WHEN** the process starts without `--observability=prometheus`
- **THEN** `prom-client` is not initialised and no `/metrics` endpoint is registered

### Requirement: Prometheus metrics registry
The `PrometheusBackend` SHALL register the following metrics in the default `prom-client` registry:

- `trident_ticks_total` — Counter. Total price ticks received. Label: none.
- `trident_tick_rate` — Gauge. Current ticks per minute. Label: none.
- `trident_signal_loads_total` — Counter. Total signal load attempts. Label: `valid` (`true`/`false`).
- `trident_engine_state` — Gauge. Current engine state encoded as integer (idle=0, blocked=1, watching=2, in_trade=3, closed=4). Label: none.
- `trident_entries_total` — Counter. Total entry fills. Labels: `entry_num` (1/2/3), `direction` (`long`/`short`).
- `trident_closes_total` — Counter. Total position closes. Label: `reason`.
- `trident_pnl_points` — Gauge. P&L in points of the most recently closed position. Label: none.
- `trident_feed_connected` — Gauge. 1 when feed is connected, 0 when disconnected.

The default `prom-client` process and Node.js metrics SHALL also be collected.

#### Scenario: Metrics endpoint returns all registered metrics
- **WHEN** a scrape request hits `GET /metrics`
- **THEN** the response includes all `trident_*` metrics plus default Node.js process metrics in Prometheus text exposition format

#### Scenario: Counter increments on tick
- **WHEN** a price tick is received
- **THEN** `trident_ticks_total` is incremented by 1

#### Scenario: Entry counter incremented with labels
- **WHEN** entry 2 fills on a long trade
- **THEN** `trident_entries_total{entry_num="2",direction="long"}` is incremented by 1

### Requirement: Prometheus /metrics HTTP endpoint
The system SHALL expose a `GET /metrics` route on the existing Express server (same port as the dashboard, default 3000) when the Prometheus backend is active. The endpoint SHALL return metrics in the standard Prometheus text exposition format (`text/plain; version=0.0.4`).

#### Scenario: Prometheus scrape succeeds
- **WHEN** Prometheus (or any HTTP client) sends `GET /metrics`
- **THEN** the response has status 200 and `Content-Type: text/plain; version=0.0.4`

#### Scenario: /metrics not registered when backend is disabled
- **WHEN** the process starts without `--observability=prometheus`
- **THEN** `GET /metrics` returns 404

### Requirement: Self-hosted Compose profile
The `docker-compose.yml` SHALL include an `observability` profile that adds `prometheus` and `grafana` services alongside the core `trident` service. When the profile is not activated the compose file SHALL behave identically to its current state.

The Prometheus service SHALL be configured with a static scrape job targeting `trident:3000/metrics` with a 15-second scrape interval. The Grafana service SHALL be provisioned at startup with:
- A Prometheus datasource pointing at the `prometheus` service
- A pre-built Trident dashboard (JSON model at `docker/grafana/dashboards/trident.json`)

Dashboard panels SHALL include at minimum: tick rate over time, engine state over time, entries and closes count, P&L of last close, and feed connected status.

#### Scenario: Observability profile activated
- **WHEN** `docker compose --profile observability up` is run with `--observability=prometheus` passed to the trident service
- **THEN** Prometheus and Grafana containers start alongside trident, Grafana is reachable on port 3001, and the Trident dashboard is pre-loaded

#### Scenario: Observability profile not activated
- **WHEN** `docker compose up` is run without `--profile observability`
- **THEN** only the `trident` service starts; no Prometheus or Grafana containers are created

#### Scenario: Grafana datasource pre-provisioned
- **WHEN** Grafana starts for the first time
- **THEN** the Prometheus datasource is configured automatically without requiring manual UI setup

### Requirement: Startup log for Prometheus mode
The system SHALL emit a startup log line at `info` level when Prometheus mode is active, stating the `/metrics` path and port, so the operator can confirm the endpoint is reachable.

#### Scenario: Prometheus mode starts
- **WHEN** the process starts with `--observability=prometheus`
- **THEN** a log line is emitted containing the text `Prometheus metrics available at :3000/metrics` (or the configured port)
