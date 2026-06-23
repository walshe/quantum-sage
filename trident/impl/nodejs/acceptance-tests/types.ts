export type EngineState = 'idle' | 'watching' | 'in_trade' | 'closed' | 'blocked';

export interface SetupFields {
  dvs: number;
  regime?: string;
  futures_last: number;
  vwap: number;
  max_buy_1: number | null;
  max_buy_2: number | null;
  max_sell_1: number | null;
  max_sell_2: number | null;
  bias: 'long' | 'short' | 'neutral';
}

export interface AccountUpdate {
  balance: number;
  unrealizedPnl: number;
  currency?: string;
}

export interface PriceStep {
  type?: 'price';
  label: string;
  note?: string;    // English explanation shown in report
  noteIt?: string;  // Italian translation
  price: number;
  accountUpdate?: AccountUpdate;
  screenshot?: true;
  expectState?: EngineState;
  delayMs?: number;
}

export interface SubmitSetupStep {
  type: 'submit-setup';
  label: string;
  note?: string;
  noteIt?: string;
  setup: SetupFields;
  expectState?: EngineState;
  screenshot?: true;
}

export type ScenarioStep = PriceStep | SubmitSetupStep;

export interface Scenario {
  name: string;
  description: string;
  /** Plain-English paragraph for the report — what this scenario proves. */
  narrative?: string;
  /** Italian translation of narrative. */
  narrativeIt?: string;
  setup: SetupFields;
  steps: ScenarioStep[];
  expectedFinalState: EngineState;
}
