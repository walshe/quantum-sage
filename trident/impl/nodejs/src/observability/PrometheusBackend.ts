import { Registry, Counter, Gauge, collectDefaultMetrics } from 'prom-client';
import type { Request, Response } from 'express';
import type { MetricsBackend } from './types.js';

const STATE_CODES: Record<string, number> = {
  idle: 0, blocked: 1, watching: 2, in_trade: 3, closed: 4,
};

export class PrometheusBackend implements MetricsBackend {
  private readonly registry = new Registry();

  private readonly ticksTotal: Counter;
  private readonly tickRateGauge: Gauge;
  private readonly signalLoads: Counter;
  private readonly engineStateGauge: Gauge;
  private readonly entriesTotal: Counter;
  private readonly closesTotal: Counter;
  private readonly pnlGauge: Gauge;
  private readonly feedConnectedGauge: Gauge;

  constructor() {
    collectDefaultMetrics({ register: this.registry });

    this.ticksTotal = new Counter({
      name: 'trident_ticks_total',
      help: 'Total price ticks received from the feed',
      registers: [this.registry],
    });
    this.tickRateGauge = new Gauge({
      name: 'trident_tick_rate',
      help: 'Current tick rate (ticks per minute)',
      registers: [this.registry],
    });
    this.signalLoads = new Counter({
      name: 'trident_signal_loads_total',
      help: 'Total signal load attempts',
      labelNames: ['valid'],
      registers: [this.registry],
    });
    this.engineStateGauge = new Gauge({
      name: 'trident_engine_state',
      help: 'Current engine state (idle=0 blocked=1 watching=2 in_trade=3 closed=4)',
      registers: [this.registry],
    });
    this.entriesTotal = new Counter({
      name: 'trident_entries_total',
      help: 'Total entry fills',
      labelNames: ['entry_num', 'direction'],
      registers: [this.registry],
    });
    this.closesTotal = new Counter({
      name: 'trident_closes_total',
      help: 'Total position closes',
      labelNames: ['reason'],
      registers: [this.registry],
    });
    this.pnlGauge = new Gauge({
      name: 'trident_pnl_points',
      help: 'P&L in points of the most recently closed position',
      registers: [this.registry],
    });
    this.feedConnectedGauge = new Gauge({
      name: 'trident_feed_connected',
      help: '1 when the price feed is connected, 0 when disconnected',
      registers: [this.registry],
    });
  }

  recordTick(_price: number): void {
    this.ticksTotal.inc();
  }

  recordSignalLoaded(valid: boolean): void {
    this.signalLoads.inc({ valid: String(valid) });
  }

  recordEngineState(state: string): void {
    this.engineStateGauge.set(STATE_CODES[state] ?? 0);
  }

  recordEntry(entryNum: number, direction: string): void {
    this.entriesTotal.inc({ entry_num: String(entryNum), direction });
  }

  recordClose(reason: string, pnlPoints: number): void {
    this.closesTotal.inc({ reason });
    this.pnlGauge.set(pnlPoints);
  }

  recordConnectionState(connected: boolean): void {
    this.feedConnectedGauge.set(connected ? 1 : 0);
  }

  setTickRate(ticksPerMinute: number): void {
    this.tickRateGauge.set(ticksPerMinute);
  }

  metricsHandler(): (req: Request, res: Response) => Promise<void> {
    return async (_req, res) => {
      res.set('Content-Type', this.registry.contentType);
      res.end(await this.registry.metrics());
    };
  }
}
