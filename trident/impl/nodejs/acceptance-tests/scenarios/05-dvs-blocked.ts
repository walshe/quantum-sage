import type { Scenario } from '../types.js';

export const scenario: Scenario = {
  name: '05-dvs-blocked',
  description: 'DVS above gate (80 > 75) → engine blocked, no trade possible',
  narrative: 'Verifies the DVS volatility gate. DVS (Daily Volatility Score) measures how volatile the market is. When DVS exceeds the configured limit (75), the engine refuses to trade for the rest of the day — regardless of price levels. Here DVS is 80, which is above the gate, so the engine blocks immediately on loading the setup and no entries can fire.',
  narrativeIt: 'Verifica il gate di volatilità DVS. Il DVS (Daily Volatility Score) misura la volatilità del mercato. Quando il DVS supera il limite configurato (75), il motore si rifiuta di operare per il resto della giornata — indipendentemente dai livelli di prezzo. Qui il DVS è 80, sopra il gate, quindi il motore si blocca immediatamente al caricamento del setup e nessun ingresso può scattare.',
  setup: {
    dvs: 80, regime: 'extreme',
    futures_last: 7510, vwap: 7540,
    max_buy_1: 7475, max_buy_2: 7500, max_sell_1: null, max_sell_2: null,
    bias: 'neutral',
  },
  steps: [],
  expectedFinalState: 'blocked',
};
