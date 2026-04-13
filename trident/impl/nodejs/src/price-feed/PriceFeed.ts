/**
 * Abstraction over any live price feed.
 *
 * Implementations swap in without touching strategy logic:
 *   - MockPriceFeed       — scripted prices, used in tests and dry runs
 *   - DatabentoPriceFeed  — real CME ES futures data (future)
 *   - TradovatePriceFeed  — free with Tradovate account (future)
 *   - IBKRPriceFeed       — TWS API via IB Gateway (future)
 */
export interface PriceFeed {
  /** Open the connection / start the feed. */
  connect(): Promise<void>;

  /** Cleanly shut down the connection. */
  disconnect(): Promise<void>;

  /**
   * Register a callback that fires on every price update.
   * Only one subscriber is supported (the engine).
   */
  subscribe(callback: (price: number) => void): void;

  /** Fetch the latest known price on demand. */
  getLatestPrice(): number | null;
}
