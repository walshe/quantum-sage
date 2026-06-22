import type { Scenario } from '../types.js';

// Entry 1 fires at 7500. Trade sits until time_exit fires.
// time_exit_minutes=0.5 in acceptance config → 30s timer.
// 32s delay before next tick gives the timer time to elapse.
export const scenario: Scenario = {
  name: '04-long-time-exit',
  description: 'Long: entry 1 fires, time limit elapses → closed by time exit',
  setup: {
    dvs: 52,
    futures_last: 7510,
    vwap: 7560,
    max_buy_1: 7475,
    max_buy_2: 7500,
    max_sell_1: null,
    max_sell_2: null,
    bias: 'neutral',
  },
  steps: [
    { label: 'idle above entry 1', price: 7510 },
    { label: 'entry 1',            price: 7500, expectState: 'in_trade', screenshot: true },
    { label: 'wait for time exit', price: 7498, delayMs: 32_000, expectState: 'closed', screenshot: true },
  ],
  expectedFinalState: 'closed',
};
