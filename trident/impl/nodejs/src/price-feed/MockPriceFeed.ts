import type { PriceFeed } from './PriceFeed.js';

export interface PriceTick {
  price: number;
  /** How long to wait after delivering this tick before the next one (ms). */
  delayMs?: number;
}

/**
 * A scripted price feed for testing and dry runs.
 *
 * Pass an array of price ticks. Each tick is delivered to the subscriber
 * after the specified delay (default: 500ms between ticks).
 *
 * Example:
 *   new MockPriceFeed([
 *     { price: 6478.00 },          // starting above entry zone
 *     { price: 6467.00 },          // Entry 1 triggers
 *     { price: 6455.50 },          // Entry 2 triggers
 *     { price: 6440.00 },          // Entry 3 triggers
 *     { price: 6555.00 },          // VWAP hit → close
 *   ])
 */
export class MockPriceFeed implements PriceFeed {
  private ticks: PriceTick[];
  private defaultDelayMs: number;
  private callback: ((price: number) => void) | null = null;
  private latestPrice: number | null = null;
  private running = false;

  constructor(ticks: PriceTick[], defaultDelayMs = 500) {
    this.ticks = ticks;
    this.defaultDelayMs = defaultDelayMs;
  }

  subscribe(callback: (price: number) => void): void {
    this.callback = callback;
  }

  getLatestPrice(): number | null {
    return this.latestPrice;
  }

  /** Connects and plays all ticks to completion before resolving. */
  async connect(): Promise<void> {
    this.running = true;
    await this.playTicks();
  }

  async disconnect(): Promise<void> {
    this.running = false;
  }

  private async playTicks(): Promise<void> {
    for (const tick of this.ticks) {
      if (!this.running) break;
      await sleep(tick.delayMs ?? this.defaultDelayMs);
      if (!this.running) break;
      this.latestPrice = tick.price;
      this.callback?.(tick.price);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
