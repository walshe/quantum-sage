import type { Scenario } from '../types.js';

export const scenario: Scenario = {
  name: '01-long-full',
  description: 'Long: all 3 entries fill → breakeven → VWAP close',
  narrative: 'Verifies the complete long trade lifecycle. Price walks down through all three buy levels, filling the position in three tranches. Once price rallies 25 points above the average entry, the stop is automatically moved to average entry (breakeven), eliminating further downside risk. The trade then closes in full when price reaches the VWAP target.',
  narrativeIt: 'Verifica il ciclo completo di un\'operazione long. Il prezzo scende attraverso tutti e tre i livelli buy, riempiendo la posizione in tre tranche. Quando il prezzo risale di oltre 25 punti sopra il prezzo medio di carico, lo stop viene automaticamente spostato al pareggio, eliminando il rischio di perdita. L\'operazione si chiude completamente quando il prezzo raggiunge il target VWAP.',
  setup: {
    dvs: 52, futures_last: 7520, vwap: 7540,
    max_buy_1: 7475, max_buy_2: 7500, max_sell_1: null, max_sell_2: null,
    bias: 'neutral',
  },
  steps: [
    {
      label: 'idle above entry 1',
      note: 'Price is above all buy levels — engine is watching but no order fires yet.',
      noteIt: 'Il prezzo è sopra tutti i livelli buy — il motore è in attesa ma non scatta ancora nessun ordine.',
      price: 7510,
    },
    {
      label: 'entry 1 (buy inner)',
      note: 'Price touches the inner buy level (7500). Entry 1 opens the position at 32.5% of full size.',
      noteIt: 'Il prezzo tocca il livello buy interno (7500). Il primo ingresso apre la posizione al 32,5% della dimensione totale.',
      price: 7500, expectState: 'in_trade', screenshot: true,
    },
    {
      label: 'entry 2 (midpoint)',
      note: 'Price continues lower to the midpoint (7489). A second tranche is added at 35% size.',
      noteIt: 'Il prezzo continua a scendere verso il punto medio (7489). Si aggiunge una seconda tranche al 35% della dimensione.',
      price: 7489, screenshot: true,
    },
    {
      label: 'entry 3 (buy outer)',
      note: 'Price reaches the outer buy level (7475). The final tranche fills, completing the full position. Average entry is now ~7488.',
      noteIt: 'Il prezzo raggiunge il livello buy esterno (7475). L\'ultima tranche viene eseguita, completando la posizione intera. Il prezzo medio di carico è ora ~7488.',
      price: 7475, screenshot: true,
    },
    {
      label: 'breakeven trigger',
      note: 'Price rallies 25+ points above average entry (~7513). The engine moves the stop to average entry — the trade can no longer close at a loss.',
      noteIt: 'Il prezzo sale di oltre 25 punti sopra il prezzo medio (~7513). Il motore sposta lo stop al prezzo medio — l\'operazione non può più chiudersi in perdita.',
      price: 7514, screenshot: true,
    },
    {
      label: 'vwap close',
      note: 'Price reaches the VWAP target (7540). The engine closes the entire position for a profit.',
      noteIt: 'Il prezzo raggiunge il target VWAP (7540). Il motore chiude l\'intera posizione in profitto.',
      price: 7540, expectState: 'closed', screenshot: true,
    },
  ],
  expectedFinalState: 'closed',
};
