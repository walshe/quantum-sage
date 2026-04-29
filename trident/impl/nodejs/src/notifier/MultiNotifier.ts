import type { Notifier, NotificationEvent } from './Notifier.js';
import { getLogger } from '../logger.js';

const log = getLogger('MultiNotifier');

/**
 * Fan-out notifier: broadcasts each event to every child notifier in parallel.
 * One child throwing does not block the others — the error is logged and the
 * rest still receive the event. Used to route engine events to console + web
 * (and later, Telegram) from a single call site in TridentEngine.
 */
export class MultiNotifier implements Notifier {
  constructor(private readonly children: Notifier[]) {}

  async notify(event: NotificationEvent): Promise<void> {
    const results = await Promise.allSettled(
      this.children.map(child => child.notify(event))
    );
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === 'rejected') {
        log.error('Child notifier threw', {
          child: this.children[i].constructor.name,
          eventType: event.type,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
        });
      }
    }
  }
}
