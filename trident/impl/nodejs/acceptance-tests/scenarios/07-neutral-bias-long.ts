import type { Scenario } from '../types.js';

export const scenario: Scenario = {
  name: '07-neutral-bias-long',
  description: 'Neutral bias, both sides loaded: price drops to buy levels → full long trade',
  narrative: 'Verifies neutral bias with both buy and sell levels active simultaneously. Even though sell levels are present in the setup, price moves down to the buy side and a full long trade executes normally — entries, breakeven, and VWAP close. This confirms the engine correctly trades whichever side price reaches first when no directional bias is applied.',
  narrativeIt: 'Verifica il bias neutro con livelli buy e sell entrambi attivi contemporaneamente. Anche se i livelli sell sono presenti nel setup, il prezzo scende verso il lato buy e un\'operazione long completa si esegue normalmente — ingressi, pareggio e chiusura al VWAP. Questo conferma che il motore opera correttamente sul lato raggiunto per primo dal prezzo quando non viene applicato alcun bias direzionale.',
  setup: {
    dvs: 52, futures_last: 7552, vwap: 7540,
    max_buy_1: 7475, max_buy_2: 7500, max_sell_1: 7590, max_sell_2: 7565,
    bias: 'neutral',
  },
  steps: [
    {
      label: 'idle in range',
      note: 'Price is between the buy and sell levels — both sides are loaded but no order fires yet.',
      noteIt: 'Il prezzo è tra i livelli buy e sell — entrambi i lati sono caricati ma nessun ordine scatta ancora.',
      price: 7552,
    },
    {
      label: 'entry 1 (buy inner)',
      note: 'Price drops to the inner buy level (7500). Entry 1 opens a long position at 32.5% size, ignoring the sell levels above.',
      noteIt: 'Il prezzo scende al livello buy interno (7500). Il primo ingresso apre una posizione long al 32,5% della dimensione, ignorando i livelli sell sopra.',
      price: 7500, expectState: 'in_trade', screenshot: true,
    },
    {
      label: 'entry 2 (midpoint)',
      note: 'Price continues lower to the midpoint (7489). Second tranche adds at 35% size.',
      noteIt: 'Il prezzo continua a scendere verso il punto medio (7489). La seconda tranche si aggiunge al 35% della dimensione.',
      price: 7489, screenshot: true,
    },
    {
      label: 'entry 3 (buy outer)',
      note: 'Price reaches the outer buy level (7475). Final tranche fills, completing the full long position.',
      noteIt: 'Il prezzo raggiunge il livello buy esterno (7475). L\'ultima tranche viene eseguita, completando la posizione long intera.',
      price: 7475, screenshot: true,
    },
    {
      label: 'breakeven trigger',
      note: 'Price rallies 25+ points above average entry. Stop moves to average entry.',
      noteIt: 'Il prezzo sale di oltre 25 punti sopra il prezzo medio. Lo stop si sposta al prezzo medio.',
      price: 7514, screenshot: true,
    },
    {
      label: 'vwap close',
      note: 'Price reaches the VWAP target (7540). The long position closes for a profit.',
      noteIt: 'Il prezzo raggiunge il target VWAP (7540). La posizione long si chiude in profitto.',
      price: 7540, expectState: 'closed', screenshot: true,
    },
  ],
  expectedFinalState: 'closed',
};
