import type { Scenario } from '../types.js';

// First setup: DVS=80 → blocked. Re-submit with DVS=52 → watching.
export const scenario: Scenario = {
  name: '06-dvs-unblock',
  description: 'DVS above gate → blocked, then re-submit with valid DVS → watching',
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
  steps: [
    // Initial setup (dvs=80) loaded in runner — engine goes to 'blocked'.
    // Then submit a corrected setup with lower DVS.
    {
      type: 'submit-setup',
      label: 're-submit with valid DVS',
      setup: {
        dvs: 52,
        regime: 'normal',
        futures_last: 7510,
        vwap: 7540,
        max_buy_1: 7475,
        max_buy_2: 7500,
        max_sell_1: null,
        max_sell_2: null,
        bias: 'long',
      },
      expectState: 'watching',
      screenshot: true,
    },
  ],
  expectedFinalState: 'watching',
};
