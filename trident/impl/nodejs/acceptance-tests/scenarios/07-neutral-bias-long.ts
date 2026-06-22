import type { Scenario } from '../types.js';

// Neutral bias — both buy and sell levels loaded. Price drops to long side.
// Long trade fires: all 3 entries, breakeven, VWAP close.
export const scenario: Scenario = {
  name: '07-neutral-bias-long',
  description: 'Neutral bias: both sides loaded, price drops to long levels → full long trade',
  setup: {
    dvs: 52,
    futures_last: 7552,
    vwap: 7540,
    max_buy_1: 7475,
    max_buy_2: 7500,
    max_sell_1: 7590,
    max_sell_2: 7565,
    bias: 'neutral',
  },
  steps: [
    { label: 'idle in range',        price: 7552 },
    { label: 'entry 1 (buy inner)', price: 7500, expectState: 'in_trade' },
    { label: 'entry 2 (midpoint)',  price: 7489 },
    { label: 'entry 3 (buy outer)', price: 7475, screenshot: true },
    { label: 'breakeven trigger',   price: 7514 },
    { label: 'vwap close',          price: 7540, expectState: 'closed', screenshot: true },
  ],
  expectedFinalState: 'closed',
};
