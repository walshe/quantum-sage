import type { Scenario } from '../types.js';

export const scenario: Scenario = {
  name: '04-long-time-exit',
  description: 'Long: entry 1 fires, time limit elapses → closed by time exit',
  narrative: 'Verifies the time-based safety exit. Entry 1 opens the position, but price drifts without reaching entries 2 or 3. After the configured time limit (30 seconds in test mode), the engine automatically closes whatever is open — it does not wait for VWAP or a stop hit. This prevents a partial position from being held indefinitely.',
  narrativeIt: 'Verifica l\'uscita automatica per scadenza temporale. Il primo ingresso apre la posizione, ma il prezzo deriva senza raggiungere gli ingressi 2 o 3. Dopo il limite di tempo configurato (30 secondi in modalità test), il motore chiude automaticamente ciò che è aperto — non attende il VWAP né uno stop. Questo evita che una posizione parziale venga mantenuta indefinitamente.',
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
      note: 'Price touches 7500. Entry 1 opens at 32.5% size. The time exit clock starts.',
      noteIt: 'Il prezzo tocca 7500. Il primo ingresso apre al 32,5% della dimensione. Il conto alla rovescia per l\'uscita temporale inizia.',
      price: 7500, expectState: 'in_trade', screenshot: true,
    },
    {
      label: 'wait for time exit',
      note: 'Price drifts slightly. After 32 seconds the time limit expires and the engine closes the position automatically.',
      noteIt: 'Il prezzo deriva leggermente. Dopo 32 secondi il limite di tempo scade e il motore chiude la posizione automaticamente.',
      price: 7498, delayMs: 32_000, expectState: 'closed', screenshot: true,
    },
  ],
  expectedFinalState: 'closed',
};
