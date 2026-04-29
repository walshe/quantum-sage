import { describe, it, expect } from 'vitest';
import type { Notifier, NotificationEvent } from '../src/notifier/Notifier.js';
import { MultiNotifier } from '../src/notifier/MultiNotifier.js';

class RecordingNotifier implements Notifier {
  received: NotificationEvent[] = [];
  async notify(event: NotificationEvent): Promise<void> {
    this.received.push(event);
  }
}

class ThrowingNotifier implements Notifier {
  async notify(): Promise<void> {
    throw new Error('boom');
  }
}

const event: NotificationEvent = {
  type: 'DAILY_LOCK',
  reason: 'test',
};

describe('MultiNotifier', () => {
  it('broadcasts each event to every child', async () => {
    const a = new RecordingNotifier();
    const b = new RecordingNotifier();
    const c = new RecordingNotifier();
    const multi = new MultiNotifier([a, b, c]);

    await multi.notify(event);

    expect(a.received).toEqual([event]);
    expect(b.received).toEqual([event]);
    expect(c.received).toEqual([event]);
  });

  it('one child throwing does not block the others', async () => {
    const before = new RecordingNotifier();
    const after = new RecordingNotifier();
    const multi = new MultiNotifier([before, new ThrowingNotifier(), after]);

    await expect(multi.notify(event)).resolves.toBeUndefined();

    expect(before.received).toEqual([event]);
    expect(after.received).toEqual([event]);
  });

  it('works with zero children (no-op)', async () => {
    const multi = new MultiNotifier([]);
    await expect(multi.notify(event)).resolves.toBeUndefined();
  });
});
