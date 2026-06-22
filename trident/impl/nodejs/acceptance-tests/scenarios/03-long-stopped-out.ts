import type { Scenario } from '../types.js';

// Long. All 3 entries fill (prices walk through entry chain), then price
// reverses below the final stop (avgEntry - 40 ≈ 7448) → stop_loss close.
// Note: entries 2 and 3 fire on the way down, which is the realistic path —
// the engine scales in and then gets stopped out.
export const scenario: Scenario = {
  name: '03-long-stopped-out',
  description: 'Long: all 3 entries fill, then price reverses through stop → stopped out',
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
    { label: 'entry 2',           price: 7489 },
    { label: 'entry 3',           price: 7475 },
    // avg ≈ (7500×0.325 + 7489×0.35 + 7475×0.325) = 7488.02
    // stop = 7488.02 - 40 = 7448.02 → inject below 7448
    { label: 'reversal',          price: 7455 },
    { label: 'stop hit',          price: 7447, expectState: 'closed', screenshot: true },
  ],
  expectedFinalState: 'closed',
};
