export interface QSConfig {
  capital: {
    starting_capital_eur: number;
    daily_risk_pct: number;
  };
  trident: {
    entry_1_allocation_pct: number;
    entry_2_allocation_pct: number;
    entry_3_allocation_pct: number;
    midpoint_offset_buy: number;
    midpoint_offset_sell: number;
    stop_loss_points: number;
    breakeven_trigger_points: number;
    hard_profit_exit_points: number;
    time_exit_minutes: number;
    dvs_gate: number;
  };
  size_adaptation: {
    after_one_loss_day: number;
    after_two_loss_days: number;
  };
  signal: {
    watch_dir: string;
    stale_threshold_hours: number;
    vwap_staleness_warn_minutes: number;
  };
}
