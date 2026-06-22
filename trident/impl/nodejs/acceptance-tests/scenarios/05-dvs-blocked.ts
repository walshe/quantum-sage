import type { Scenario } from '../types.js';

// DVS of 80 exceeds the gate (75). Engine should immediately block on setup load.
export const scenario: Scenario = {
  name: '05-dvs-blocked',
  description: 'DVS above gate → engine blocked, no trade possible',
  setup: {
    dvs: 80,
    regime: 'extreme',
    futures_last: 7510,
    vwap: 7540,
    max_buy_1: 7475,
    max_buy_2: 7500,
    max_sell_1: null,
    max_sell_2: null,
    bias: 'long',
  },
  // No price steps needed — the block fires on setup load, before any prices
  steps: [],
  expectedFinalState: 'blocked',
};
