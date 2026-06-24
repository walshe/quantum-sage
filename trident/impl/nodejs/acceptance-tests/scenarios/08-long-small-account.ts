import type { Scenario } from '../types.js';

export const scenario: Scenario = {
  name: '08-long-small-account',
  description: 'Long full trade on a €1,000 account — verifies 0.01-lot precision sizing works at small scale',
  accountBalance: 1_000,
  narrative: 'Verifies that the engine trades correctly on a small account. With €1,000 balance and 0.5% daily risk, each entry tier risks roughly €1.60 — which at a 40-point stop with €1/point/lot gives 0.04 lots per tranche (4 cTrader API units). This scenario confirms that fractional-lot sizing works end-to-end: orders are placed, breakeven moves, and the position closes at VWAP — all with the same logic as a full-size account, just at a much smaller scale suitable for live testing.',
  narrativeIt: 'Verifica che il motore operi correttamente su un conto di piccole dimensioni. Con un saldo di €1.000 e un rischio giornaliero dello 0,5%, ogni tranche rischia circa €1,60 — che con uno stop di 40 punti a €1/punto/lotto corrisponde a 0,04 lotti per tranche (4 unità API cTrader). Questo scenario conferma che il dimensionamento a lotti frazionari funziona end-to-end: gli ordini vengono piazzati, il breakeven si sposta e la posizione si chiude al VWAP — tutto con la stessa logica di un conto a piena dimensione, ma su scala molto ridotta, adatta ai test live.',
  setup: {
    dvs: 52, futures_last: 7510, vwap: 7560,
    max_buy_1: 7475, max_buy_2: 7500, max_sell_1: null, max_sell_2: null,
    bias: 'neutral',
  },
  steps: [
    {
      label: 'idle above entries',
      note: 'Price is above all buy levels. Account seeded at €1,000 — engine will size at 0.04 lots per tranche (4 cTrader API units).',
      noteIt: 'Il prezzo è sopra tutti i livelli buy. Conto impostato a €1.000 — il motore dimensionerà a 0,04 lotti per tranche (4 unità API cTrader).',
      price: 7510,
    },
    {
      label: 'entry 1 (buy inner)',
      note: 'Price touches 7500. Entry 1 opens at 0.04 lots (32.5% of €5 daily risk ÷ 40-pt stop).',
      noteIt: 'Il prezzo tocca 7500. Il primo ingresso apre a 0,04 lotti (32,5% di €5 rischio giornaliero ÷ stop 40 pt).',
      price: 7500, expectState: 'in_trade', screenshot: true,
    },
    {
      label: 'entry 2 (midpoint)',
      note: 'Price continues to 7489. Second tranche adds another 0.04 lots.',
      noteIt: 'Il prezzo scende a 7489. La seconda tranche aggiunge altri 0,04 lotti.',
      price: 7489, screenshot: true,
    },
    {
      label: 'entry 3 (buy outer)',
      note: 'Price reaches 7475. Full position: 0.12 lots total at €0.12/point.',
      noteIt: 'Il prezzo raggiunge 7475. Posizione completa: 0,12 lotti totali a €0,12/punto.',
      price: 7475, screenshot: true,
    },
    {
      label: 'breakeven trigger',
      note: 'Price rallies 25+ points above average entry. Stop moves to breakeven.',
      noteIt: 'Il prezzo sale di oltre 25 punti sopra il prezzo medio. Lo stop si sposta al pareggio.',
      price: 7514, screenshot: true,
    },
    {
      label: 'vwap close',
      note: 'Price reaches VWAP at 7560. Position closes. P&L reflects 0.12-lot sizing.',
      noteIt: 'Il prezzo raggiunge il VWAP a 7560. La posizione si chiude. Il P&L riflette il dimensionamento a 0,12 lotti.',
      price: 7560, expectState: 'closed', screenshot: true,
    },
  ],
  expectedFinalState: 'closed',
};
