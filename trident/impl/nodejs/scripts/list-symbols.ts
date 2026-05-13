/**
 * scripts/list-symbols.ts
 *
 * Connects to cTrader, dumps every symbol available on the account, then exits.
 * Use this to find the correct CTRADER_SYMBOL name for your broker.
 *
 * Run:
 *   npm run list:symbols
 *
 * Optional filter (case-insensitive substring match):
 *   npm run list:symbols -- es
 *   npm run list:symbols -- mini
 */

import WebSocket from 'ws';
import { readFileSync, existsSync } from 'fs';

const WS_URL   = process.env.CTRADER_WS_URL ?? 'wss://live.ctraderapi.com:5036';
const ENV_FILE = '.env';

const PT = {
  APP_AUTH_REQ:    2100,
  APP_AUTH_RES:    2101,
  GET_ACCOUNTS_REQ: 2149,
  GET_ACCOUNTS_RES: 2150,
  ACCOUNT_AUTH_REQ: 2102,
  ACCOUNT_AUTH_RES: 2103,
  SYMBOL_LIST_REQ:  2114,
  SYMBOL_LIST_RES:  2115,
  ERROR_RES:        2142,
} as const;

// ── .env loader ──────────────────────────────────────────────────────────────

function readEnv(): Record<string, string> {
  const base: Record<string, string> = {};
  if (existsSync(ENV_FILE)) {
    for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx < 1) continue;
      base[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
    }
  }
  return { ...base, ...process.env } as Record<string, string>;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const env          = readEnv();
  const clientId     = env['CTRADER_CLIENT_ID'];
  const clientSecret = env['CTRADER_CLIENT_SECRET'];
  const accessToken  = env['CTRADER_ACCESS_TOKEN'];
  const accountId    = env['CTRADER_ACCOUNT_ID'] ? Number(env['CTRADER_ACCOUNT_ID']) : undefined;

  if (!clientId || !clientSecret || !accessToken) {
    console.error(
      '\n❌  Missing credentials. Run `npm run auth:ctrader` first, or check your .env.\n'
    );
    process.exit(1);
  }

  const filter = process.argv[2]?.toLowerCase() ?? '';
  if (filter) console.log(`\nFiltering for: "${filter}"\n`);

  let counter = 0;
  const send = (ws: WebSocket, payload: object) => {
    ws.send(JSON.stringify({ clientMsgId: String(++counter), ...payload }));
  };

  await new Promise<void>((resolve, reject) => {
    console.log(`Connecting to ${WS_URL} …`);
    const ws = new WebSocket(WS_URL);
    let accountCtid: number | null = null;

    ws.on('open', () => {
      send(ws, { payloadType: PT.APP_AUTH_REQ, payload: { clientId, clientSecret } });
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      const msg = JSON.parse(raw.toString()) as {
        payloadType: number;
        payload?: Record<string, unknown>;
      };

      switch (msg.payloadType) {
        case PT.APP_AUTH_RES:
          send(ws, { payloadType: PT.GET_ACCOUNTS_REQ, payload: { accessToken } });
          break;

        case PT.GET_ACCOUNTS_RES: {
          const accounts = (msg.payload?.ctidTraderAccount ?? []) as Array<{
            ctidTraderAccountId: number;
            isLive: boolean;
            traderLogin: number;
          }>;
          const account = accountId
            ? accounts.find(a => a.ctidTraderAccountId === accountId)
            : accounts.find(a => a.isLive) ?? accounts[0];
          if (!account) { reject(new Error('No matching account found')); return; }
          accountCtid = account.ctidTraderAccountId;
          console.log(`Using account ${account.traderLogin} (id ${accountCtid}, live=${account.isLive})`);
          send(ws, { payloadType: PT.ACCOUNT_AUTH_REQ, payload: { ctidTraderAccountId: accountCtid, accessToken } });
          break;
        }

        case PT.ACCOUNT_AUTH_RES:
          // Demo servers need a short settle delay before accepting SYMBOL_LIST_REQ
          setTimeout(() => {
            send(ws, { payloadType: PT.SYMBOL_LIST_REQ, payload: { ctidTraderAccountId: accountCtid } });
          }, 2000);
          break;

        case PT.SYMBOL_LIST_RES: {
          const symbols = (msg.payload?.symbol ?? []) as Array<{
            symbolId: number;
            symbolName: string;
          }>;

          const matches = filter
            ? symbols.filter(s => s.symbolName.toLowerCase().includes(filter))
            : symbols;

          matches.sort((a, b) => a.symbolName.localeCompare(b.symbolName));

          console.log(`\n${matches.length} symbol(s)${filter ? ` matching "${filter}"` : ''} (${symbols.length} total on account):\n`);
          for (const s of matches) {
            console.log(`  ${s.symbolName.padEnd(30)} id=${s.symbolId}`);
          }
          console.log();
          ws.close();
          resolve();
          break;
        }

        case PT.ERROR_RES: {
          const code = msg.payload?.errorCode ?? 'UNKNOWN';
          const desc = String(msg.payload?.description ?? '');
          // SymbolsForConversion errors are noise — ignore
          if (desc.includes('SymbolsForConversion')) break;
          reject(new Error(`cTrader error ${code}: ${desc}`));
          ws.close();
          break;
        }
      }
    });

    ws.on('error', reject);
    ws.on('close', resolve);
  });
}

main().catch(err => {
  console.error('\n❌', err.message);
  process.exit(1);
});
