import type { Scenario } from '../types.js';

// All 3 entries fill as price walks down through the entry chain, then price
// reverses below the final stop (avgEntry - 40 ≈ 7448) → stop_loss close.
export const scenario: Scenario = {
  name: '03-long-stopped-out',
  description: 'Long: all 3 entries fill, price reverses through stop → stopped out',
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
    { label: 'entry 2',            price: 7489, screenshot: true },
    { label: 'entry 3',            price: 7475, screenshot: true },
    // avg ≈ 7488.02, stop = 7448.02 → inject below 7448
    { label: 'price reverses',     price: 7455, screenshot: true },
    { label: 'stop hit',           price: 7447, expectState: 'closed', screenshot: true },
  ],
  expectedFinalState: 'closed',
};
