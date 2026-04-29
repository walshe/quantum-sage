export type ExecutionInstrument = 'ES' | 'US500.cash' | 'SPX';
export type VolatilityRegime = 'compressed' | 'normal' | 'elevated' | 'extreme';
export type BiasDirection = 'long' | 'short' | 'neutral';
export type BiasConfidence = 'low' | 'medium' | 'high';
export type VwapSource = 'manual' | 'live_feed';

export interface SignalMeta {
  /** ISO 8601 date: YYYY-MM-DD (year-month-day). e.g. "2026-04-17", NOT "17-04-2026" */
  date: string;
  /** 24-hour time: HH:MM. e.g. "10:06" or "15:36" */
  timestamp: string;
  update_seq: number;
  /**
   * Optional, audit-trail only. Front-month ES contract code (e.g. "ESM6").
   * Not consumed by any validator or strategy rule — kept so a YAML on disk
   * is self-describing about which contract the analyst was watching.
   */
  contract?: string;
  futures_last: number;
  cash_last: number;
  basis: number;
  execution_instrument: ExecutionInstrument;
}

export interface SignalVolatility {
  dvs: number;
  dvs_prior: number;
  skew: number;
  regime: VolatilityRegime;
}

export interface SignalVwap {
  value: number;
  updated_at: string;
  source: VwapSource;
}

export interface SignalRanges {
  range_1_up: number;
  range_2_up: number;
  range_2_down: number;
  range_1_down: number;
}

export interface SignalLevels {
  level_time: string | null;
  max_sell_1: number | null;
  max_sell_2: number | null;
  max_buy_1: number | null;
  max_buy_2: number | null;
  supporto: number | null;
  resistenza: number | null;
  additional: unknown[];
}

export interface SignalBias {
  direction: BiasDirection;
  confidence: BiasConfidence;
  notes?: string;
}

export interface SignalInvalidation {
  void_above: number;
  void_below: number;
  expiry: string;
  notes?: string;
}

export interface SignalFile {
  schema_version: string;
  meta: SignalMeta;
  volatility: SignalVolatility;
  vwap: SignalVwap;
  ranges: SignalRanges;
  levels: SignalLevels;
  levels_recal: SignalLevels;
  bias?: SignalBias;
  invalidation: SignalInvalidation;
}

/** The levels that qs-signal-engine actually operates on (morning or recal). */
export interface ActiveLevels {
  level_time: string;
  max_sell_1: number | null;
  max_sell_2: number | null;
  max_buy_1: number | null;
  max_buy_2: number | null;
}
