import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc';
import type { Counter, ObservableGauge, ObservableResult } from '@opentelemetry/api';
import type { MetricsBackend } from './types.js';

const STATE_CODES: Record<string, number> = {
  idle: 0, blocked: 1, watching: 2, in_trade: 3, closed: 4,
};

// Parse OTEL_EXPORTER_OTLP_HEADERS="k1=v1,k2=v2" into a Record
function parseOtlpHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  return Object.fromEntries(
    raw.split(',')
      .map(pair => pair.split('=').map(s => s.trim()))
      .filter((parts): parts is [string, string] => parts.length === 2 && parts[0].length > 0)
  );
}

export class OtelBackend implements MetricsBackend {
  private readonly provider: MeterProvider;

  // Observable state — read by gauge callbacks
  private tickRate = 0;
  private engineState = 0;
  private feedConnected = 0;
  private lastPnlPoints = 0;

  // Instruments
  private readonly ticksCounter: Counter;
  private readonly signalLoadsCounter: Counter;
  private readonly entriesCounter: Counter;
  private readonly closesCounter: Counter;

  // Unused ObservableGauge refs kept to satisfy strict-null checks
  private readonly _tickRateGauge: ObservableGauge;
  private readonly _engineStateGauge: ObservableGauge;
  private readonly _feedConnectedGauge: ObservableGauge;
  private readonly _pnlGauge: ObservableGauge;

  constructor() {
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4317';
    const headers = parseOtlpHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);
    const exportIntervalMs = Number(process.env.OTEL_METRIC_EXPORT_INTERVAL ?? 60_000);
    const serviceName = process.env.OTEL_SERVICE_NAME ?? 'trident';

    const exporter = new OTLPMetricExporter({ url: endpoint, headers });

    this.provider = new MeterProvider({
      readers: [
        new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: exportIntervalMs }),
      ],
    });

    const meter = this.provider.getMeter(serviceName);

    this.ticksCounter = meter.createCounter('trident.ticks', {
      description: 'Total price ticks received from the feed',
    });
    this.signalLoadsCounter = meter.createCounter('trident.signal_loads', {
      description: 'Total signal load attempts',
    });
    this.entriesCounter = meter.createCounter('trident.entries', {
      description: 'Total entry fills',
    });
    this.closesCounter = meter.createCounter('trident.closes', {
      description: 'Total position closes',
    });

    this._tickRateGauge = meter.createObservableGauge('trident.tick_rate', {
      description: 'Current tick rate (ticks per minute)',
    });
    this._tickRateGauge.addCallback((result: ObservableResult) => { result.observe(this.tickRate); });

    this._engineStateGauge = meter.createObservableGauge('trident.engine_state', {
      description: 'Current engine state (idle=0 blocked=1 watching=2 in_trade=3 closed=4)',
    });
    this._engineStateGauge.addCallback((result: ObservableResult) => { result.observe(this.engineState); });

    this._feedConnectedGauge = meter.createObservableGauge('trident.feed_connected', {
      description: '1 when price feed is connected, 0 when disconnected',
    });
    this._feedConnectedGauge.addCallback((result: ObservableResult) => { result.observe(this.feedConnected); });

    this._pnlGauge = meter.createObservableGauge('trident.pnl_points', {
      description: 'P&L in points of the most recently closed position',
    });
    this._pnlGauge.addCallback((result: ObservableResult) => { result.observe(this.lastPnlPoints); });
  }

  recordTick(_price: number): void {
    this.ticksCounter.add(1);
  }

  recordSignalLoaded(valid: boolean): void {
    this.signalLoadsCounter.add(1, { valid: String(valid) });
  }

  recordEngineState(state: string): void {
    this.engineState = STATE_CODES[state] ?? 0;
  }

  recordEntry(entryNum: number, direction: string): void {
    this.entriesCounter.add(1, { entry_num: String(entryNum), direction });
  }

  recordClose(reason: string, pnlPoints: number): void {
    this.closesCounter.add(1, { reason });
    this.lastPnlPoints = pnlPoints;
  }

  recordConnectionState(connected: boolean): void {
    this.feedConnected = connected ? 1 : 0;
  }

  setTickRate(ticksPerMinute: number): void {
    this.tickRate = ticksPerMinute;
  }

  async shutdown(): Promise<void> {
    await this.provider.shutdown();
  }
}
