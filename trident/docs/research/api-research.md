

-------------------
## Interactive Brokers 


### Based on the goals of QS and IF we decided to build a standalone trading process then which of the interactive broker api solutions would be the most appropriate to use here? : https://www.interactivebrokers.ie/en/trading/ib-api.php#api-software Also let me know if there are more suitable apis out there     

**The four IBKR APIs:**

**1. TWS API (Trader Workstation API)** — A socket-based API that requires either Trader Workstation (the desktop app) or IB Gateway (a lightweight headless version) to be running. It's a TCP socket protocol based on connectivity to TWS or IB Gateway, with official client libraries in Python, Java, C++, C#, and ActiveX. This is the workhorse for retail algo traders.

**2. Web API (Client Portal API)** — A REST/WebSocket API that talks directly to IBKR infrastructure over HTTPS. It supports OAuth 1.0a, OAuth 2.0, SSO, and the Java-based CP Gateway tool for authentication. No desktop software needed in theory, but in practice you usually still run a small Java gateway for authentication. IBKR is currently merging Client Portal API, Digital Account Management, and Flex Web Service into a unified IBKR Web API with OAuth 2.0, so this is the future direction.

**3. Excel API (DDE/RTD/ActiveX)** — For traders who want to integrate Excel with TWS. Not relevant for QS.

**4. FIX API** — Institutional protocol for high-frequency trading. Designed for institutions creating trading systems via VPN, extranet, leased line or cross-connect connection. Massive overkill for QS and probably has minimum account requirements.

**For QS specifically, my recommendation: TWS API via IB Gateway**

Here's why:

The TWS API is the most mature, has the best community support, the most code samples, and is what 90% of retail Python algo traders use. Minimum Python version is 3.11.0 which is fine. You run **IB Gateway** (not the full TWS desktop app) — it's a stripped-down headless version that just maintains the connection. Lower memory footprint, no GUI noise, perfect for a server.

The flow looks like: Your Python QS process → talks to local IB Gateway → which talks to IBKR servers. Gateway handles auth, session management, and reconnection. Your code just sends order messages and receives market data.

For ES futures specifically — which is your buddy's primary instrument — TWS API is the standard choice. There are battle-tested Python wrappers (`ib_insync` was popular but is unmaintained now; the official `ibapi` package is what to use).

**Why not the Web API:**
- Still pretty new and changing (the unification effort is ongoing)
- More complex authentication (OAuth flows)
- Has the two-tiered session model — read-only session plus brokerage session — which adds complexity
- Less community support and fewer code examples

The Web API is great if you want zero local infrastructure and a pure cloud architecture. But TWS API + IB Gateway is simpler to start with for a project like QS.

**One critical caveat from the docs:**

IBKR Canada (IBC) does not allow API trading for products on Canadian exchanges due to CIRO regulations. This applies to TradingView, NinjaTrader, and any third-party automated systems. This shouldn't affect you since QS trades ES futures (US exchange), but worth knowing if your buddy ever wants to trade Canadian instruments.

**Alternative brokers worth considering:**

**Tradovate** — Specifically designed for futures traders, REST and WebSocket API, much simpler than IBKR, lower minimum account, modern developer experience. If your buddy is futures-only, Tradovate is genuinely worth considering over IBKR.

**TastyTrade API** — Modern REST API, good for futures and options, growing community, but newer.

**Rithmic** — The professional choice for serious futures traders. Lowest latency, used by funds. More expensive and complex to set up.

**MetaTrader 5** — If your buddy is trading CFDs instead of futures (US500.cash style), MT5 is the de facto standard. Built-in MQL5 environment if you wanted to go the platform-native route, or you can connect external Python via the `MetaTrader5` package.

**My honest take:**

For Phase 1 of QS (signal engine only, no execution), you don't need any of these yet. You just need a price feed.

For Phase 2 (qs-trader with auto execution), the question becomes: **what does your buddy actually trade and where?** That's the deciding factor:

- ES futures on IBKR → **TWS API + IB Gateway** (Python, official `ibapi`)
- ES futures on Tradovate → **Tradovate REST API** (simpler, more modern)
- US500 CFD on a MetaTrader broker → **MT5 Python integration** or write qs-trader as an MQL5 EA
- Mixed/multi-broker future → **TWS API** since IBKR covers the most instruments

Worth asking your buddy directly: **"What broker and account type are you trading this strategy on right now? And are you happy with that broker long-term?"** That answer collapses the whole decision tree.

------

## Price Feed only

### If I just need a price feed for now then might any of the discussion here aid me ? https://www.reddit.com/r/algotrading/comments/1qehfh3/live_price_data_for_thousands_of_tickersstocks/

Key takeaways that DO apply to QS:
1. IBKR market data is widely disliked. Multiple commenters call it "terrible for market data." One person describes wasting 10 hours debugging "Need Valid Subscription for CBOE/AMEX/ETC" errors before adding every add-on subscription. This pushes back on my earlier suggestion of "just use IBKR for both data and execution." The reality is IBKR is fine for execution but its data feed is fiddly and limited (50 subscriptions/sec, complex add-on subscriptions, inconsistent quality).
2. Databento and Massive (formerly Polygon) are the two top recommendations. Both get strong endorsements from people actually using them in production. Databento is positioned as the higher-end option ($199/mo+), Massive as the more flexible/affordable a la carte option (~$100 for equities, extra for futures/options).
3. Tradier got mentioned at the end as a surprise — "real-time streaming data without any restrictions, full-fat tick stream." Worth investigating.
4. DTN IQFeed comes up as a futures-friendly option (~$108/mo, includes equities/options/futures) but one commenter says "IQFeed sucks as well" — mixed reviews.
Specifically for ES futures (your case):
The thread doesn't focus on futures, but the providers mentioned that handle futures well are:

Databento — Widely praised, has CME data, modern API. Probably the cleanest option.
DTN IQFeed — Long-standing futures-focused provider, but mixed reviews
Rithmic — Mentioned as a serious option, professional-grade
Tradovate — Not in the thread but worth knowing about; their data comes free with the trading account

What this changes about my earlier advice:
I'd downgrade my "just use IBKR for everything" suggestion. The community consensus is that IBKR's market data is the weakest part of their stack. For QS, a better split might be:

Data feed: Databento (or Tradovate's free feed if you go with them as broker)
Execution (Phase 2): Whatever broker your buddy actually trades on

You don't need to use the same provider for data and execution. They're separate concerns.
One concrete cost reality check:
Databento for ES futures real-time tick data is going to run you maybe $50-100/month depending on what level of data you need. Top of book only is cheaper than full depth. For Phase 1 development (where you might just be polling current price every few seconds), even cheaper options exist.
Honestly though — for Phase 1 prototyping, you might not even need a paid feed yet. You could start with delayed data (free from IBKR or Yahoo), validate that qs-signal-engine logic works correctly against historical replay, and only switch to a real-time paid feed when you're ready to test against live markets. The signal engine doesn't care if data is delayed by 15 minutes during development.

