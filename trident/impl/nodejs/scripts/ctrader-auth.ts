/**
 * scripts/ctrader-auth.ts
 *
 * One-time setup — run this once to get your cTrader access and refresh tokens.
 * Tokens are written to .env and from then on the engine uses them silently.
 *
 * Prerequisites:
 *   1. In the cTrader Open API portal, add this exact redirect URI to your app:
 *        http://127.0.0.1:3000/api/ctrader/callback
 *   2. Add your app credentials to .env (copy .env.example to get started):
 *        CTRADER_CLIENT_ID=your_client_id
 *        CTRADER_CLIENT_SECRET=your_client_secret
 *
 * Run:
 *   npm run auth:ctrader
 */

import http from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { exec } from 'child_process';
import { URL } from 'url';

const REDIRECT_URI = 'http://127.0.0.1:3000/api/ctrader/callback';
const AUTH_BASE    = 'https://id.ctrader.com/my/settings/openapi/grantingaccess/';
const TOKEN_URL    = 'https://openapi.ctrader.com/apps/token';
const ENV_FILE     = '.env';

// ── .env helpers ───────────────────────────────────────────────────────────

function readEnvFile(): Record<string, string> {
  if (!existsSync(ENV_FILE)) return {};
  return Object.fromEntries(
    readFileSync(ENV_FILE, 'utf8')
      .split('\n')
      .filter(line => line.trim() && !line.startsWith('#'))
      .map(line => {
        const idx = line.indexOf('=');
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
      })
      .filter(([k]) => k.length > 0)
  );
}

function writeEnvFile(updates: Record<string, string>): void {
  const merged = { ...readEnvFile(), ...updates };
  const content = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  writeFileSync(ENV_FILE, content, 'utf8');
}

// ── Local callback server ──────────────────────────────────────────────────
// Spins up temporarily on port 8000, catches the ?code= from cTrader,
// shows a success page in the browser, then shuts itself down.

function waitForAuthCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) return;

      const url   = new URL(req.url, 'http://localhost:3000');
      const code  = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (url.pathname !== '/api/ctrader/callback') {
        res.writeHead(404);
        res.end();
        return;
      }

      if (error || !code) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h2>❌ Authorisation failed</h2><p>You can close this tab.</p>');
        server.close();
        reject(new Error(error ?? 'No authorisation code in callback'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<h2>✅ Authorised!</h2>' +
        '<p>Tokens are being saved. You can close this tab and return to your terminal.</p>'
      );

      res.on('finish', () => server.close(() => resolve(code)));
    });

    server.listen(3000, '127.0.0.1', () =>
      console.log('Listening for cTrader callback on http://127.0.0.1:3000 ...')
    );

    server.on('error', reject);
  });
}

// ── Token exchange ─────────────────────────────────────────────────────────

interface TokenResponse {
  accessToken:  string;
  refreshToken: string;
  expiresIn:    number;
  tokenType:    string;
  errorCode:    string | null;
  description:  string | null;
}

async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string
): Promise<TokenResponse> {
  const url = new URL(TOKEN_URL);
  url.searchParams.set('grant_type',    'authorization_code');
  url.searchParams.set('code',          code);
  url.searchParams.set('redirect_uri',  REDIRECT_URI);
  url.searchParams.set('client_id',     clientId);
  url.searchParams.set('client_secret', clientSecret);

  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  });

  if (!res.ok) throw new Error(`Token request failed: HTTP ${res.status}`);

  return res.json() as Promise<TokenResponse>;
}

// ── Browser launcher ───────────────────────────────────────────────────────

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin' ? `open "${url}"` :
    process.platform === 'win32'  ? `start "" "${url}"` :
                                    `xdg-open "${url}"`;
  exec(cmd);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Merge .env file with actual environment (env vars take precedence)
  const env = { ...readEnvFile(), ...process.env };

  const clientId     = env['CTRADER_CLIENT_ID'];
  const clientSecret = env['CTRADER_CLIENT_SECRET'];

  if (!clientId || !clientSecret) {
    console.error(
      '\n❌  Missing credentials. Add these to .env before running:\n\n' +
      '   CTRADER_CLIENT_ID=your_client_id\n' +
      '   CTRADER_CLIENT_SECRET=your_client_secret\n\n' +
      'Copy .env.example to get started.\n'
    );
    process.exit(1);
  }

  // Build the cTrader authorisation URL
  const authUrl = new URL(AUTH_BASE);
  authUrl.searchParams.set('client_id',    clientId);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('scope',        'trading');
  authUrl.searchParams.set('product',      'web');

  console.log('\n── cTrader OAuth setup ──────────────────────────────\n');
  console.log('Opening your browser to the cTrader authorisation page...');
  console.log('If it does not open automatically, visit this URL:\n');
  console.log(authUrl.toString());
  console.log();

  openBrowser(authUrl.toString());

  // Wait for cTrader to redirect back with the auth code
  const code = await waitForAuthCode();
  console.log('\nAuthorisation code received — exchanging for tokens...');

  const tokens = await exchangeCodeForTokens(code, clientId, clientSecret);

  if (tokens.errorCode) {
    console.error(`\n❌  Token error: ${tokens.errorCode} — ${tokens.description}`);
    process.exit(1);
  }

  // Persist everything to .env (preserves any existing keys)
  const tokenExpiresAt = Math.floor(Date.now() / 1000) + tokens.expiresIn;
  writeEnvFile({
    CTRADER_CLIENT_ID:        clientId,
    CTRADER_CLIENT_SECRET:    clientSecret,
    CTRADER_ACCESS_TOKEN:     tokens.accessToken,
    CTRADER_REFRESH_TOKEN:    tokens.refreshToken,
    CTRADER_TOKEN_EXPIRES_AT: String(tokenExpiresAt),
  });

  const daysUntilExpiry = Math.round(tokens.expiresIn / 86400);
  console.log('\n✅  Done! Tokens saved to .env');
  console.log(`    Access token expires in: ${daysUntilExpiry} days`);
  console.log('    Refresh token:           never expires');
  console.log('\nYou can now run the engine with: npm run dev\n');
}

main().catch(err => {
  console.error('\n❌  Setup failed:', err.message);
  process.exit(1);
});
