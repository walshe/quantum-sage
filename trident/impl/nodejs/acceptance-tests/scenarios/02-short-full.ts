import type { Scenario } from '../types.js';

export const scenario: Scenario = {
  name: '02-short-full',
  description: 'Short: all 3 entries fill → breakeven → VWAP close',
  narrative: 'Verifies the complete short trade lifecycle. Price walks up through all three sell levels, filling the position in three tranches. Once price drops 25 points below average entry, the stop is moved to average entry (breakeven). The trade closes in full when price falls back to the VWAP target.',
  narrativeIt: 'Verifica il ciclo completo di un\'operazione short. Il prezzo sale attraverso tutti e tre i livelli sell, riempiendo la posizione in tre tranche. Quando il prezzo scende di oltre 25 punti sotto il prezzo medio di carico, lo stop viene spostato al pareggio. L\'operazione si chiude completamente quando il prezzo scende fino al target VWAP.',
  setup: {
    dvs: 52, futures_last: 7540, vwap: 7540,
    max_buy_1: null, max_buy_2: null, max_sell_1: 7590, max_sell_2: 7565,
    bias: 'neutral',
  },
  steps: [
    {
      label: 'idle below entry 1',
      note: 'Price is below all sell levels — engine is watching but no order fires yet.',
      noteIt: 'Il prezzo è sotto tutti i livelli sell — il motore è in attesa ma non scatta ancora nessun ordine.',
      price: 7555,
    },
    {
      label: 'entry 1 (sell inner)',
      note: 'Price rises to the inner sell level (7565). Entry 1 opens a short position at 32.5% of full size.',
      noteIt: 'Il prezzo sale fino al livello sell interno (7565). Il primo ingresso apre una posizione short al 32,5% della dimensione totale.',
      price: 7565, expectState: 'in_trade', screenshot: true,
    },
    {
      label: 'entry 2 (midpoint)',
      note: 'Price continues higher to the midpoint (7576). A second short tranche is added at 35% size.',
      noteIt: 'Il prezzo continua a salire verso il punto medio (7576). Si aggiunge una seconda tranche short al 35% della dimensione.',
      price: 7576, screenshot: true,
    },
    {
      label: 'entry 3 (sell outer)',
      note: 'Price reaches the outer sell level (7590). The final tranche fills, completing the full short position. Average entry is now ~7577.',
      noteIt: 'Il prezzo raggiunge il livello sell esterno (7590). L\'ultima tranche viene eseguita, completando la posizione short intera. Il prezzo medio di carico è ora ~7577.',
      price: 7590, screenshot: true,
    },
    {
      label: 'breakeven trigger',
      note: 'Price drops 25+ points below average entry (~7552). The stop is moved to average entry — the trade can no longer close at a loss.',
      noteIt: 'Il prezzo scende di oltre 25 punti sotto il prezzo medio (~7552). Lo stop viene spostato al prezzo medio — l\'operazione non può più chiudersi in perdita.',
      price: 7551, screenshot: true,
    },
    {
      label: 'vwap close',
      note: 'Price reaches the VWAP target (7540). The engine closes the entire short position for a profit.',
      noteIt: 'Il prezzo raggiunge il target VWAP (7540). Il motore chiude l\'intera posizione short in profitto.',
      price: 7540, expectState: 'closed', screenshot: true,
    },
  ],
  expectedFinalState: 'closed',
};
