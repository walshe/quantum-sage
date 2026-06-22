import type { Scenario } from '../types.js';

// sell_2=7565 (Entry 1), midpoint-2=7575.5 (Entry 2), sell_1=7590 (Entry 3).
// avg ≈ 7577. Breakeven at avg-25 ≈ 7552. VWAP close at 7540.
export const scenario: Scenario = {
  name: '02-short-full',
  description: 'Short: all 3 entries fill → breakeven → VWAP close',
  setup: {
    dvs: 52,
    futures_last: 7540,
    vwap: 7540,
    max_buy_1: null,
    max_buy_2: null,
    max_sell_1: 7590,
    max_sell_2: 7565,
    bias: 'neutral',
  },
  steps: [
    { label: 'idle below entry 1',   price: 7555 },
    { label: 'entry 1 (sell inner)', price: 7565, expectState: 'in_trade', screenshot: true },
    { label: 'entry 2 (midpoint)',   price: 7576, screenshot: true },
    { label: 'entry 3 (sell outer)', price: 7590, screenshot: true },
    { label: 'breakeven trigger',    price: 7551, screenshot: true },
    { label: 'vwap close',           price: 7540, expectState: 'closed', screenshot: true },
  ],
  expectedFinalState: 'closed',
};
