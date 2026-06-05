/**
 * Smoke test: places a single 1-lot MARKET BUY order on the configured symbol
 * and waits for the broker execution event. Closes the position immediately after.
 *
 * Usage:
 *   npx tsx scripts/smoke-order.ts
 *
 * Reads credentials from .env. Set CTRADER_SYMBOL, CTRADER_ACCOUNT_ID etc as usual.
 * Safe to run on a demo account — places the smallest possible order (1 lot = 100 units).
 */

import 'dotenv/config';
import { CTraderSession, PT } from '../src/price-feed/CTraderSession.js';

const env = process.env;

if (!env.CTRADER_CLIENT_ID || !env.CTRADER_CLIENT_SECRET || !env.CTRADER_ACCESS_TOKEN) {
  console.error('Missing cTrader credentials in .env');
  process.exit(1);
}

const SYMBOL_NAME = env.SMOKE_SYMBOL ?? env.CTRADER_SYMBOL ?? 'GBPJPY';
const VOLUME     = Number(process.env.SMOKE_VOLUME ?? '1000'); // override with SMOKE_VOLUME env var

const session = new CTraderSession({
  clientId:       env.CTRADER_CLIENT_ID,
  clientSecret:   env.CTRADER_CLIENT_SECRET,
  accessToken:    env.CTRADER_ACCESS_TOKEN,
  accountId:      env.CTRADER_ACCOUNT_ID ? Number(env.CTRADER_ACCOUNT_ID) : undefined,
  wsUrl:          env.CTRADER_WS_URL,
  noHeartbeat:    env.CTRADER_NO_HEARTBEAT === 'true',
});

let positionId: number | null = null;
let symbolId:   number | null = null;

session.onMessage(PT.EXECUTION_EVENT, msg => {
  console.log('\n📨 EXECUTION_EVENT (2126) raw:', JSON.stringify(msg, null, 2));
  const payload  = msg.payload ?? {};
  const execType = payload['executionType'] as string | undefined;
  const position = payload['position'] as Record<string, unknown> | undefined;
  const order    = payload['order']    as Record<string, unknown> | undefined;

  // executionType 3 = ORDER_FILLED, 4 = ORDER_REJECTED
  if (execType === 3 || execType === 'ORDER_FILLED' || execType === 'POSITION_OPENED') {
    positionId = position?.['positionId'] as number;
    console.log('\n✅ Order filled! positionId:', positionId);
    console.log('Closing position in 2 seconds...');
    setTimeout(() => closePosition(), 2000);
  } else if (execType === 4 || execType === 'ORDER_REJECTED') {
    console.error('\n❌ Order rejected:', order?.['rejectReason'] ?? payload['rejectReason']);
    process.exit(1);
  }
});

session.onMessage(PT.ERROR_RES, msg => {
  console.error('\n❌ ERROR_RES from broker:', JSON.stringify(msg.payload, null, 2));
  process.exit(1);
});

async function resolveSymbolId(): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Symbol lookup timed out')), 10_000);
    session.onMessage(PT.SYMBOL_LIST_RES, msg => {
      clearTimeout(timer);
      const symbols = (msg.payload?.['symbol'] ?? []) as Array<Record<string, unknown>>;
      const found = symbols.find(s =>
        String(s['symbolName']).toUpperCase() === SYMBOL_NAME.toUpperCase()
      );
      if (!found) {
        const names = symbols.map(s => s['symbolName']).join(', ');
        reject(new Error(`Symbol "${SYMBOL_NAME}" not found. Available: ${names}`));
      } else {
        resolve(found['symbolId'] as number);
      }
    });
    session.send({ payloadType: PT.SYMBOL_LIST_REQ, payload: { ctidTraderAccountId: session.accountId } });
  });
}

function placeOrder() {
  // Register handlers for every possible response payloadType so nothing is missed.
  for (let pt = 2100; pt <= 2200; pt++) {
    const capturedPt = pt;
    if (capturedPt === PT.EXECUTION_EVENT || capturedPt === PT.ERROR_RES || capturedPt === PT.SYMBOL_LIST_RES) continue;
    session.onMessage(capturedPt, msg => {
      console.log(`\n📨 Message payloadType ${capturedPt}:`, JSON.stringify(msg.payload ?? {}, null, 2));
    });
  }

  console.log(`\n📤 Placing MARKET BUY order — symbol: ${SYMBOL_NAME} (id: ${symbolId}), volume: ${VOLUME}`);
  const msgId = session.send({
    payloadType: PT.NEW_ORDER_REQ,
    payload: {
      ctidTraderAccountId: session.accountId,
      symbolId,
      orderType: 1,  // MARKET = 1 in cTrader proto enum
      tradeSide: 1,  // BUY = 1 in cTrader proto enum
      volume:    VOLUME,
    },
  });
  console.log(`⏳ Sent with clientMsgId: ${msgId} — waiting for execution event (10s timeout)...`);
  console.log('(Note: payloadType 2105 = ProtoOANewOrderRes — means order accepted for processing)');

  // Register reconcile response handler to check if the order actually opened a position
  session.onMessage(PT.RECONCILE_RES, msg => {
    console.log('\n📨 RECONCILE_RES (open positions/orders):', JSON.stringify(msg.payload, null, 2));
  });

  // Poll for positions after 3 seconds
  setTimeout(() => {
    console.log('\n🔍 Sending RECONCILE_REQ to check open positions...');
    session.send({
      payloadType: PT.RECONCILE_REQ,
      payload: { ctidTraderAccountId: session.accountId },
    });
  }, 3000);

  setTimeout(() => {
    if (!positionId) {
      console.error('\n❌ No execution event received within 30s — order accepted but no fill confirmation');
      process.exit(1);
    }
  }, 30_000);
}

function closePosition() {
  if (!positionId) return;
  console.log('\n📤 Closing position', positionId);
  session.send({
    payloadType: PT.CLOSE_POSITION_REQ,
    payload: {
      ctidTraderAccountId: session.accountId,
      positionId,
      volume: VOLUME,
    },
  });
  setTimeout(() => {
    console.log('\n✅ Done — check your broker platform to confirm.');
    process.exit(0);
  }, 3000);
}

async function main() {
  console.log('🔌 Connecting to cTrader...');
  await session.connect();
  console.log(`✅ Connected — account: ${session.accountId}`);

  console.log('🔍 Resolving symbol...');
  symbolId = await resolveSymbolId();
  console.log(`✅ Symbol resolved: ${SYMBOL_NAME} → id ${symbolId}`);

  placeOrder();
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
