import type { Scenario } from '../types.js';

// Long bias. buy_2=7500 (Entry 1), midpoint+2=7489 (Entry 2), buy_1=7475 (Entry 3).
// avg ≈ 7488. Breakeven at avg+25 ≈ 7513. VWAP close at 7540.
export const scenario: Scenario = {
  name: '01-long-full',
  description: 'Long: all 3 entries → breakeven → VWAP close',
  setup: {
    dvs: 52,
    futures_last: 7520,
    vwap: 7540,
    max_buy_1: 7475,
    max_buy_2: 7500,
    max_sell_1: null,
    max_sell_2: null,
    bias: 'long',
  },
  steps: [
    { label: 'idle above entry 1',    price: 7510 },
    { label: 'entry 1 (buy inner)',   price: 7500, expectState: 'in_trade' },
    { label: 'entry 2 (midpoint)',    price: 7489 },
    { label: 'entry 3 (buy outer)',   price: 7475, screenshot: true },
    { label: 'breakeven trigger',     price: 7514 },
    { label: 'vwap close',            price: 7540, expectState: 'closed', screenshot: true },
  ],
  expectedFinalState: 'closed',
};
