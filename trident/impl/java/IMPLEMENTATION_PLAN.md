# Trident Java Implementation Plan

Reference blueprint for porting the Node.js Trident engine to Java.
Based on the Node.js impl at `../nodejs/` (~2,200 lines of TypeScript).

## Recommendation: Pure Java (no Spring)

This is a single-purpose, event-driven trading engine. Spring Boot adds ~30s
startup, 200MB+ memory, and abstraction layers that don't help here. Everything
needed is available in Java stdlib or lightweight libs.

## Dependencies

| Dependency | Purpose | Maven artifact |
|---|---|---|
| SnakeYAML | Signal file YAML parsing | `org.yaml:snakeyaml` |
| Jackson | JSON (cTrader WebSocket messages) | `com.fasterxml.jackson.core:jackson-databind` |
| Java-WebSocket | cTrader Open API connection | `org.java-websocket:Java-WebSocket` |
| SLF4J + Logback | Structured logging (console + file) | `ch.qos.logback:logback-classic` |
| JUnit 5 | Testing | `org.junit.jupiter:junit-jupiter` |

Build tool: **Gradle** (Kotlin DSL) or Maven — either works, Gradle is lighter.

Java version: **17+** (LTS, records, sealed classes, text blocks).

## Module Structure

```
impl/java/
├── build.gradle.kts
├── settings.gradle.kts
├── IMPLEMENTATION_PLAN.md        (this file)
├── .env.example
└── src/
    ├── main/java/com/quantumsage/trident/
    │   ├── Main.java                          # Entry point, wires everything
    │   ├── config/
    │   │   └── Config.java                    # Loads .env / system env vars
    │   ├── signal/
    │   │   ├── SignalFile.java                # Record classes matching YAML schema
    │   │   ├── SignalLoader.java              # WatchService-based file watcher
    │   │   └── SignalValidator.java           # 15 validation rules
    │   ├── pricefeed/
    │   │   ├── PriceFeed.java                 # Interface (onPrice callback)
    │   │   ├── CTraderPriceFeed.java          # WebSocket JSON client
    │   │   └── MockPriceFeed.java             # For testing
    │   ├── strategy/
    │   │   ├── TridentEngine.java             # Core state machine
    │   │   ├── StrategyCalculator.java        # Pure entry/exit logic
    │   │   └── StrategyTypes.java             # Position, Entry, enums
    │   └── notify/
    │       └── Notifier.java                  # Event logging / alerts
    └── test/java/com/quantumsage/trident/
        ├── signal/
        │   └── SignalValidatorTest.java
        └── strategy/
            └── StrategyCalculatorTest.java
```

## Component-by-Component Porting Notes

### 1. Signal Types (`signal/SignalFile.java`)
Port from: `nodejs/src/signal/types.ts` (83 lines)

Use Java records for immutable data:
```java
public record SignalMeta(
    String date,        // ISO 8601: YYYY-MM-DD
    String timestamp,   // 24-hour HH:MM
    int updateSeq,
    String contract,
    double futuresLast,
    double cashLast,
    double basis,
    String executionInstrument
) {}
```

Enums for constrained values:
```java
public enum VolatilityRegime { COMPRESSED, NORMAL, ELEVATED, EXTREME }
public enum BiasDirection { LONG, SHORT, NEUTRAL }
public enum BiasConfidence { LOW, MEDIUM, HIGH }
```

SnakeYAML maps YAML to nested `Map<String, Object>` — write a simple mapper
to construct records from the map (or use Jackson YAML module for direct binding).

### 2. Signal Loader (`signal/SignalLoader.java`)
Port from: `nodejs/src/signal/loader.ts` (57 lines)

Use `java.nio.file.WatchService`:
```java
WatchService watcher = FileSystems.getDefault().newWatchService();
signalDir.register(watcher, ENTRY_CREATE, ENTRY_MODIFY);

// In a dedicated thread:
while (true) {
    WatchKey key = watcher.take();  // blocks
    for (WatchEvent<?> event : key.pollEvents()) {
        Path filename = (Path) event.context();
        if (filename.toString().matches("^qs_signal_.+\\.yaml$")) {
            callback.accept(signalDir.resolve(filename));
        }
    }
    key.reset();
}
```

Run in a daemon thread so it doesn't block the main loop.

### 3. Signal Validator (`signal/SignalValidator.java`)
Port from: `nodejs/src/signal/validator.ts` (183 lines)

This is pure logic — almost line-for-line translation. Each rule is a method
returning `Optional<String>` (empty = pass, present = error message).

Key rules:
- Schema version == "1.0"
- Range ordering: `range_1_down < range_2_down < range_2_up < range_1_up`
- Buy levels: `max_buy_1 < max_buy_2` (when both non-null)
- Sell levels: `max_sell_2 < max_sell_1` (when both non-null)
- Price sanity: all prices > 0, within 20% of futures_last
- Basis: between -100 and +200, approximately equals futures_last - cash_last
- DVS: between 0 and 200
- Staleness: reject files older than 6 hours
- VWAP freshness: warn if > 90 minutes old

### 4. Price Feed Interface (`pricefeed/PriceFeed.java`)
Port from: `nodejs/src/price-feed/` (25 lines interface)

```java
public interface PriceFeed {
    void connect();
    void disconnect();
    void subscribe(String symbol);
    void onPrice(Consumer<PriceTick> handler);
}

public record PriceTick(String symbol, double bid, double ask, Instant timestamp) {}
```

### 5. cTrader Price Feed (`pricefeed/CTraderPriceFeed.java`)
Port from: `nodejs/src/price-feed/CTraderPriceFeed.ts` (619 lines)

This is the most complex component. The protocol:
1. Open WSS connection to cTrader Open API
2. Send auth (account credentials)
3. Send symbol list request (or use known symbolId)
4. Subscribe to spot prices
5. Parse incoming JSON messages, dispatch by payloadType

Payload types used:
- `PROTO_OA_APPLICATION_AUTH_REQ` / `_RES` (2100/2101)
- `PROTO_OA_ACCOUNT_AUTH_REQ` / `_RES` (2102/2103)
- `PROTO_OA_SYMBOL_BY_ID_REQ` / `_RES` (2114/2115)
- `PROTO_OA_SUBSCRIBE_SPOTS_REQ` / `_RES` (2127/2128)
- `PROTO_OA_SPOT_EVENT` (2131)
- `PROTO_OA_ERROR_RES` (2142)

Use Java-WebSocket library:
```java
var client = new WebSocketClient(new URI(endpoint)) {
    @Override
    public void onMessage(String message) {
        var json = objectMapper.readTree(message);
        int payloadType = json.get("payloadType").asInt();
        handleMessage(payloadType, json);
    }
};
```

### 6. Trident Engine (`strategy/TridentEngine.java`)
Port from: `nodejs/src/strategy/TridentEngine.ts` (581 lines)

The core state machine. States:
- `IDLE` — no signal loaded
- `WATCHING` — signal loaded, waiting for price to hit entry levels
- `IN_TRADE` — position open, monitoring exits
- `DAILY_LOCKED` — winning trade closed, done for the day

On each price tick (`onPriceUpdate`):
1. Check invalidation (void_above/void_below)
2. Check expiry
3. If WATCHING: check entry triggers (3-entry mean reversion)
4. If IN_TRADE: check exit conditions (stop, VWAP, +33pt, +25pt breakeven, 180min time, invalidation)

### 7. Strategy Calculator (`strategy/StrategyCalculator.java`)
Port from: `nodejs/src/strategy/calculator.ts` (102 lines)

Pure static methods — easiest to port:
- `calculateMidpoint(buy1, buy2)` → `(buy1 + buy2) / 2 + 2`
- `calculateAvgEntry(entries[])` → weighted average
- `shouldTriggerEntry(price, level, side)`
- `calculatePnL(avgEntry, currentPrice, side, quantity)`

### 8. Entry Point (`Main.java`)
Port from: `nodejs/src/index.ts` (185 lines)

```java
public class Main {
    public static void main(String[] args) {
        var config = Config.load();
        var engine = new TridentEngine(config);
        var priceFeed = new CTraderPriceFeed(config);

        // Start signal file watcher (daemon thread)
        SignalLoader.watch(config.signalDir(), path -> {
            engine.loadSignal(SignalLoader.parse(path));
        });

        // Connect price feed and wire to engine
        priceFeed.onPrice(engine::onPriceUpdate);
        priceFeed.connect();
        priceFeed.subscribe(config.symbol());
    }
}
```

## What's Easier in Java

- `WatchService` is built into `java.nio.file` — no third-party lib needed
- Strong typing with records + enums maps naturally from the TypeScript types
- `ScheduledExecutorService` for any timer-based logic (time exit, staleness)

## What's Slightly Harder in Java

- More boilerplate for the YAML-to-record mapping (SnakeYAML gives you maps, not typed objects)
- WebSocket client setup is a bit more verbose than the `ws` npm package
- No `dotenv` equivalent built in (but `System.getenv()` works if you set vars externally)

## Estimated Effort

| Component | Lines (est.) | Difficulty | Time |
|---|---|---|---|
| Signal types + records | ~120 | Easy | 30 min |
| Signal loader (WatchService) | ~80 | Easy | 30 min |
| Signal validator | ~220 | Easy (pure logic) | 1 hour |
| Price feed interface + mock | ~60 | Easy | 20 min |
| cTrader price feed | ~700 | Moderate | 2-3 hours |
| Trident engine | ~650 | Moderate (state machine) | 2-3 hours |
| Strategy calculator | ~120 | Easy (pure math) | 30 min |
| Config + logging + main | ~150 | Easy | 30 min |
| Tests | ~300 | Easy | 1 hour |
| Build setup (Gradle) | ~30 | Easy | 15 min |
| **Total** | **~2,400** | | **~1-2 days** |

## Testing Strategy

1. **Unit tests first**: Validator and Calculator are pure functions — port the
   existing Node.js tests directly
2. **Mock price feed**: Test the engine state machine without a live connection
3. **Integration**: Connect to Pepperstone demo with `LOG_LEVEL=DEBUG`, verify
   ticks flow through, drop a signal file, confirm engine picks it up
4. **Side-by-side**: Run both Node.js and Java engines simultaneously on the
   same price feed, compare decisions

## Config (.env)

Same env vars as Node.js:
```
CTRADER_HOST=live.ctraderapi.com
CTRADER_PORT=5035
CTRADER_CLIENT_ID=...
CTRADER_CLIENT_SECRET=...
CTRADER_ACCESS_TOKEN=...
CTRADER_ACCOUNT_ID=...
CTRADER_SYMBOL=US500
SIGNAL_DIR=./signals
LOG_LEVEL=info
```
