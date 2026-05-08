import type { Notifier, NotificationEvent } from '../notifier/Notifier.js';
import type { MetricsBackend } from './types.js';

export class MetricsNotifier implements Notifier {
  constructor(private readonly backend: MetricsBackend) {}

  async notify(event: NotificationEvent): Promise<void> {
    switch (event.type) {
      case 'SIGNAL_LOADED':
        this.backend.recordSignalLoaded(true);
        break;
      case 'SIGNAL_INVALID':
        this.backend.recordSignalLoaded(false);
        break;
      case 'DVS_GATE_BLOCKED':
        this.backend.recordEngineState('blocked');
        break;
      case 'SETUP_READY':
        this.backend.recordEngineState('watching');
        break;
      case 'ENTRY_TRIGGERED':
        if (event.entryNumber === 1) this.backend.recordEngineState('in_trade');
        this.backend.recordEntry(event.entryNumber, event.direction);
        break;
      case 'POSITION_CLOSED':
        this.backend.recordEngineState('closed');
        this.backend.recordClose(event.reason, event.pnlPoints);
        break;
    }
  }
}
