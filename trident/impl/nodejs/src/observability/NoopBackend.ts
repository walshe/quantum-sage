import type { MetricsBackend } from './types.js';

export class NoopBackend implements MetricsBackend {
  recordTick(_price: number): void {}
  recordSignalLoaded(_valid: boolean): void {}
  recordEngineState(_state: string): void {}
  recordEntry(_entryNum: number, _direction: string): void {}
  recordClose(_reason: string, _pnlPoints: number): void {}
  recordConnectionState(_connected: boolean): void {}
  setTickRate(_ticksPerMinute: number): void {}
}
