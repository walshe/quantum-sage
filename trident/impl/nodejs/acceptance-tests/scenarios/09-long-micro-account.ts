import type { Scenario } from '../types.js';

export const scenario: Scenario = {
  name: '09-long-micro-account',
  description: 'Long full trade on a €500 account — verifies minimum viable sizing (0.02 lots/tranche) works end-to-end',
  accountBalance: 500,
  narrative: 'Verifies the engine operates correctly at the smallest practical account size. With €500 balance and 0.5% daily risk, each tranche risks €0.81 — giving 0.02 lots per tranche (2 cTrader API units) at a 40-point stop. Total exposure is 0.06 lots at €0.06/point. This is effectively a live paper-trade: real orders hit the broker, real confirmation arrives back, but financial exposure is negligible. Useful for validating the full execution path before committing more capital.',
  narrativeIt: 'Verifica il funzionamento del motore alla dimensione minima praticabile. Con un saldo di €500 e un rischio giornaliero dello 0,5%, ogni tranche rischia €0,81 — pari a 0,02 lotti per tranche (2 unità API cTrader) con uno stop di 40 punti. L\'esposizione totale è di 0,06 lotti a €0,06/punto. Si tratta in pratica di un paper-trade live: gli ordini reali raggiungono il broker e arriva la conferma, ma l\'esposizione finanziaria è trascurabile. Utile per validare il percorso di esecuzione completo prima di impegnare più capitale.',
  setup: {
    dvs: 52, futures_last: 7510, vwap: 7560,
    max_buy_1: 7475, max_buy_2: 7500, max_sell_1: null, max_sell_2: null,
    bias: 'neutral',
  },
  steps: [
    {
      label: 'idle above entries',
      note: 'Account seeded at €500. Daily risk = €2.50 → 0.02 lots/tranche (2 API units) at a 40-pt stop.',
      noteIt: 'Conto impostato a €500. Rischio giornaliero = €2,50 → 0,02 lotti/tranche (2 unità API) con stop 40 pt.',
      price: 7510,
    },
    {
      label: 'entry 1 (buy inner)',
      note: 'Price touches 7500. Entry 1 opens at 0.02 lots.',
      noteIt: 'Il prezzo tocca 7500. Il primo ingresso apre a 0,02 lotti.',
      price: 7500, expectState: 'in_trade', screenshot: true,
    },
    {
      label: 'entry 2 (midpoint)',
      note: 'Price continues to 7489. Second tranche: 0.02 lots.',
      noteIt: 'Il prezzo scende a 7489. Seconda tranche: 0,02 lotti.',
      price: 7489, screenshot: true,
    },
    {
      label: 'entry 3 (buy outer)',
      note: 'Price reaches 7475. Full position: 0.06 lots total at €0.06/point.',
      noteIt: 'Il prezzo raggiunge 7475. Posizione completa: 0,06 lotti totali a €0,06/punto.',
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
      note: 'Price reaches VWAP at 7560. Position closes. P&L is real but tiny by design.',
      noteIt: 'Il prezzo raggiunge il VWAP a 7560. La posizione si chiude. Il P&L è reale ma minuscolo per scelta.',
      price: 7560, expectState: 'closed', screenshot: true,
    },
  ],
  expectedFinalState: 'closed',
};
