export interface MetricsBackend {
  recordTick(price: number): void;
  recordSignalLoaded(valid: boolean): void;
  recordEngineState(state: string): void;
  recordEntry(entryNum: number, direction: string): void;
  recordClose(reason: string, pnlPoints: number): void;
  recordConnectionState(connected: boolean): void;
  setTickRate(ticksPerMinute: number): void;
}
