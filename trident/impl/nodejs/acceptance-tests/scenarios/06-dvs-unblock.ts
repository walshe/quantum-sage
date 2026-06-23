import type { Scenario } from '../types.js';

export const scenario: Scenario = {
  name: '06-dvs-unblock',
  description: 'DVS above gate → blocked, re-submit with valid DVS → back to watching',
  narrative: 'Verifies that a DVS block can be cleared later in the day. The analyst submits a setup with DVS 80 — the engine blocks. Later, the analyst resubmits with an updated setup showing DVS 52 (within the limit). The engine recognises the improved conditions and resumes watching for entries, without needing a manual reset.',
  narrativeIt: 'Verifica che un blocco DVS possa essere rimosso durante la giornata. L\'analista invia un setup con DVS 80 — il motore si blocca. Più tardi, l\'analista reinvia con un setup aggiornato che mostra DVS 52 (entro il limite). Il motore riconosce le condizioni migliorate e riprende a monitorare gli ingressi, senza necessità di un reset manuale.',
  setup: {
    dvs: 80, regime: 'extreme',
    futures_last: 7510, vwap: 7540,
    max_buy_1: 7475, max_buy_2: 7500, max_sell_1: null, max_sell_2: null,
    bias: 'neutral',
  },
  steps: [
    {
      type: 'submit-setup',
      label: 're-submit with valid DVS',
      note: 'Analyst sends a corrected setup with DVS 52. The engine clears the block and resumes watching.',
      noteIt: 'L\'analista invia un setup corretto con DVS 52. Il motore rimuove il blocco e riprende a monitorare.',
      setup: {
        dvs: 52, regime: 'normal',
        futures_last: 7510, vwap: 7540,
        max_buy_1: 7475, max_buy_2: 7500, max_sell_1: null, max_sell_2: null,
        bias: 'neutral',
      },
      expectState: 'watching',
      screenshot: true,
    },
  ],
  expectedFinalState: 'watching',
};
