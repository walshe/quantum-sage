import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { AddressInfo } from 'net';
import { WebSocketNotifier, type Bootstrap } from '../src/notifier/WebSocketNotifier.js';
import type { NotificationEvent } from '../src/notifier/Notifier.js';

const bootstrap: Bootstrap = {
  serverTime: '2026-04-21T10:00:00.000Z',
  state: 'idle',
  dailyLocked: false,
  currentSignal: null,
  position: null,
};

function waitForMessage(ws: WebSocket, predicate: (msg: unknown) => boolean, timeoutMs = 500): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for message')), timeoutMs);
    const handler = (data: WebSocket.RawData) => {
      const parsed = JSON.parse(data.toString());
      if (predicate(parsed)) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(parsed);
      }
    };
    ws.on('message', handler);
  });
}

let wss: WebSocketServer;
let port: number;
let notifier: WebSocketNotifier;

beforeEach(async () => {
  wss = new WebSocketServer({ port: 0 });
  await new Promise<void>(resolve => wss.on('listening', () => resolve()));
  port = (wss.address() as AddressInfo).port;
  notifier = new WebSocketNotifier(wss, () => bootstrap);
});

afterEach(() => {
  return new Promise<void>(resolve => {
    wss.close(() => resolve());
  });
});

describe('WebSocketNotifier', () => {
  it('sends a bootstrap envelope on client connect', async () => {
    const client = new WebSocket(`ws://localhost:${port}`);
    const msg = await waitForMessage(client, m => (m as { kind: string }).kind === 'bootstrap');
    expect(msg).toEqual({ kind: 'bootstrap', data: bootstrap });
    client.close();
  });

  it('broadcasts notify() events to connected clients', async () => {
    const client = new WebSocket(`ws://localhost:${port}`);
    await waitForMessage(client, m => (m as { kind: string }).kind === 'bootstrap');

    const event: NotificationEvent = { type: 'DAILY_LOCK', reason: 'one winning trade' };
    const received = waitForMessage(client, m => (m as { kind: string }).kind === 'event');
    await notifier.notify(event);

    const msg = await received as { kind: string; data: { type: string; tag: string; headline: string; raw: unknown } };
    expect(msg.kind).toBe('event');
    expect(msg.data.type).toBe('DAILY_LOCK');
    expect(msg.data.tag).toBe('LOCK');
    expect(msg.data.headline).toContain('one winning trade');
    expect(msg.data.raw).toEqual(event);

    client.close();
  });

  it('suppresses PRICE_UPDATE by default', async () => {
    const client = new WebSocket(`ws://localhost:${port}`);
    await waitForMessage(client, m => (m as { kind: string }).kind === 'bootstrap');

    let gotPriceEvent = false;
    client.on('message', data => {
      const parsed = JSON.parse(data.toString());
      if (parsed.kind === 'event' && parsed.data.type === 'PRICE_UPDATE') gotPriceEvent = true;
    });
    await notifier.notify({ type: 'PRICE_UPDATE', price: 7160.10 });

    // Give the event loop a moment in case a stray broadcast fires.
    await new Promise(r => setTimeout(r, 50));
    expect(gotPriceEvent).toBe(false);

    client.close();
  });

  it('tracks client count across connect/disconnect', async () => {
    expect(notifier.clientCount()).toBe(0);

    const a = new WebSocket(`ws://localhost:${port}`);
    await new Promise(r => a.once('open', r));
    // one tick for the server-side 'connection' handler to run
    await new Promise(r => setImmediate(r));
    expect(notifier.clientCount()).toBe(1);

    const b = new WebSocket(`ws://localhost:${port}`);
    await new Promise(r => b.once('open', r));
    await new Promise(r => setImmediate(r));
    expect(notifier.clientCount()).toBe(2);

    a.close();
    await new Promise(r => setTimeout(r, 50));
    expect(notifier.clientCount()).toBe(1);

    b.close();
  });
});
