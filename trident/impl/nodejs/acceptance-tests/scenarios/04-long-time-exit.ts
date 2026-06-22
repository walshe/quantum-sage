import type { Scenario } from '../types.js';

// Long. Entry 1 fires at 7500. Trade then sits until time_exit fires.
// Requires time_exit_minutes=0.5 in the acceptance test config (30s).
// The 32s delay after entry gives the timer time to elapse; the next price
// tick triggers enforceTimeExitDeadline() which closes the position.
export const scenario: Scenario = {
  name: '04-long-time-exit',
  description: 'Long: entry 1 fires, time exit elapses → closed by time limit',
  setup: {
    dvs: 52,
    futures_last: 7510,
    vwap: 7560,
    max_buy_1: 7475,
    max_buy_2: 7500,
    max_sell_1: null,
    max_sell_2: null,
    bias: 'long',
  },
  steps: [
    { label: 'idle above entry 1', price: 7510 },
    { label: 'entry 1',           price: 7500, expectState: 'in_trade', screenshot: true },
    // Wait 32 seconds — time_exit_minutes: 0.5 means exit fires after 30s.
    // The next price tick triggers the check.
    { label: 'wait for time exit', price: 7498, delayMs: 32_000, expectState: 'closed', screenshot: true },
  ],
  expectedFinalState: 'closed',
};
