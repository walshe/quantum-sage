import type { Scenario } from '../types.js';

export const scenario: Scenario = {
  name: '03-long-stopped-out',
  description: 'Long: all 3 entries fill, price reverses through stop → stopped out',
  narrative: 'Verifies the stop loss works correctly. All three buy entries fill as normal, but instead of rallying, price reverses and falls below the stop level (average entry minus 40 points, ~7448). The engine closes the position at a loss and protects the account from further drawdown.',
  narrativeIt: 'Verifica che lo stop loss funzioni correttamente. Tutti e tre gli ingressi buy vengono eseguiti normalmente, ma invece di salire, il prezzo inverte e scende sotto il livello di stop (prezzo medio meno 40 punti, ~7448). Il motore chiude la posizione in perdita e protegge il conto da ulteriori ribassi.',
  setup: {
    dvs: 52, futures_last: 7510, vwap: 7560,
    max_buy_1: 7475, max_buy_2: 7500, max_sell_1: null, max_sell_2: null,
    bias: 'neutral',
  },
  steps: [
    {
      label: 'idle above entry 1',
      note: 'Price is above all buy levels — engine is watching.',
      noteIt: 'Il prezzo è sopra tutti i livelli buy — il motore è in attesa.',
      price: 7510,
    },
    {
      label: 'entry 1',
      note: 'Price touches 7500. Entry 1 fills at 32.5% size. Stop is set 40 pts below the current average entry.',
      noteIt: 'Il prezzo tocca 7500. Il primo ingresso viene eseguito al 32,5% della dimensione. Lo stop è posto 40 punti sotto il prezzo medio corrente.',
      price: 7500, expectState: 'in_trade', screenshot: true,
    },
    {
      label: 'entry 2',
      note: 'Price drops to 7489. Second tranche fills at 35% size. Stop moves down with the new average.',
      noteIt: 'Il prezzo scende a 7489. La seconda tranche viene eseguita al 35% della dimensione. Lo stop si abbassa con il nuovo prezzo medio.',
      price: 7489, screenshot: true,
    },
    {
      label: 'entry 3',
      note: 'Price reaches 7475. Final tranche fills at 32.5% size. Average entry is now ~7488, stop is at ~7448.',
      noteIt: 'Il prezzo raggiunge 7475. L\'ultima tranche viene eseguita al 32,5% della dimensione. Il prezzo medio è ora ~7488, lo stop è a ~7448.',
      price: 7475, screenshot: true,
    },
    {
      label: 'price reverses',
      note: 'Price is falling toward the stop level. No action yet — still above 7448.',
      noteIt: 'Il prezzo si sta avvicinando al livello di stop. Nessuna azione ancora — siamo ancora sopra 7448.',
      price: 7455, screenshot: true,
    },
    {
      label: 'stop hit',
      note: 'Price breaks below the stop (~7448). The engine closes the full position at a loss.',
      noteIt: 'Il prezzo sfonda lo stop (~7448). Il motore chiude l\'intera posizione in perdita.',
      price: 7447, expectState: 'closed', screenshot: true,
    },
  ],
  expectedFinalState: 'closed',
};
