# Running Trident

Everything you need to start, stop, and update the app. Instructions work for both **Mac** and **Windows**.

---

## 1. Install Docker Desktop (first time only)

1. Go to [https://www.docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop)
2. Download and install Docker Desktop for your operating system
3. Open Docker Desktop and wait for it to finish starting:
   - **Mac** — you'll see a small whale icon in the menu bar
   - **Windows** — you'll see a whale icon in the system tray (bottom-right)

You only need to do this once.

---

## 2. Authenticate with the image registry (first time only)

The Trident image is hosted privately on GitHub. You need to log in once so Docker can pull it.

You'll need a GitHub Personal Access Token with `read:packages` scope:

1. Go to `https://github.com/settings/tokens` → **Generate new token (classic)**
2. Tick **read:packages**, generate and copy the token
3. Run (replace `YOUR_TOKEN`):

```bash
echo YOUR_TOKEN | docker login ghcr.io -u walshe --password-stdin
```

You should see `Login Succeeded`. You only need to do this once per machine.

---

## 4. First-time setup (first time only)

Open a terminal and navigate to the Trident folder:

- **Mac** — open Terminal (or iTerm)
- **Windows** — open **PowerShell** or **Git Bash**

```bash
cd trident/impl/nodejs
```

Copy the example credentials file:

- **Mac / Git Bash:**
  ```bash
  cp .env.example .env
  ```
- **PowerShell:**
  ```powershell
  Copy-Item .env.example .env
  ```

Now open `.env` in a text editor and fill in your cTrader credentials:

```
CTRADER_CLIENT_ID=your_client_id
CTRADER_CLIENT_SECRET=your_client_secret
```

The access token lines will be filled in during the authentication step — ask Emmett if you haven't done this yet.

> **Windows:** save `.env` with **LF line endings**, not CRLF. In VS Code, click the `CRLF` indicator in the bottom-right status bar and switch it to `LF`. In Notepad, use *File → Save As → Encoding → UTF-8*.

You only need to do this once. Your credentials stay on your machine and never go inside the container.

---

## 5. Daily start

Make sure Docker Desktop is running (whale icon in menu bar / system tray), then:

```bash
cd trident/impl/nodejs
docker compose pull
docker compose up -d
```

The `docker compose pull` fetches the latest image. The `-d` flag runs it in the background so your terminal stays free.

The **first time** this will download the image, which takes a minute or two depending on your connection. After that, starts are instant.

---

## 6. Open the dashboard

Once the container is running, open your browser and go to:

**[http://localhost:3000](http://localhost:3000)**

---

## 7. Daily stop

```bash
cd trident/impl/nodejs
docker compose down
```

Your data is saved locally in the same folder as `docker-compose.yml` and is never affected by stopping the container:

| Folder | Contents |
|---|---|
| `setups/` | Setup YAML files submitted via the dashboard |
| `logs/` | Engine audit log (`trident.log`) and crash-recovery snapshot |
| `screenshots/` | Chart images uploaded via Import from screenshots |

---

## 8. Updating to a new version

When Emmett has published an update, the same two commands handle it:

```bash
cd trident/impl/nodejs
docker compose pull
docker compose up -d
```

`docker compose pull` downloads the new image and `up -d` restarts the container with it. Your data (`.env`, `config.yaml`, `setups/`, `logs/`) is untouched.

---

## Auto-execution / Phase 2 (optional)

By default, Trident is purely **advisory** — it signals when to trade but does not place orders at the broker. To enable automated order placement:

1. Edit `config.yaml` and add the `execution` section:
   ```yaml
   execution:
     auto_execute: true
     point_value_eur: 1    # EUR per index point per lot — confirm with Emmett for your instrument
   ```

2. Ensure `CTRADER_SYMBOL_ID` is set in your `.env` file. This is the numeric symbol ID for the instrument (e.g. `2549` for US500-F). The app logs this on startup when the price feed connects — check `docker compose logs | grep symbolId` after connecting once without auto-execution.

3. Restart the container:
   ```bash
   docker compose down
   docker compose up -d
   ```

When auto-execution is active the live log will show `ORDER FAILED` in red if any order is rejected by the broker — check your broker position manually if you see this.

> **Disable at any time** by setting `auto_execute: false` (or removing the `execution` section) in `config.yaml` and restarting. No code change needed.

---

## Observability (optional)

Trident can export real-time metrics — connection status, tick rate, engine state, entries, closes, and P&L — to a monitoring dashboard. Two paths are available:

### Self-hosted (Prometheus + Grafana, recommended for local use)

1. Add the following line to your `.env` file:
   ```
   TRIDENT_OBSERVABILITY=prometheus
   ```

2. Start Trident with the observability profile:
   ```bash
   docker compose --profile observability up -d
   ```

   This starts three containers: `trident` (as normal), `prometheus` (scrapes metrics every 15s), and `grafana` (pre-provisioned dashboard).

3. Open Grafana at **[http://localhost:3001](http://localhost:3001)**
   - Username: `admin` / Password: `trident`
   - The **Trident Engine** dashboard is pre-loaded under Dashboards

   The `/metrics` endpoint on the Trident container is at **[http://localhost:3000/metrics](http://localhost:3000/metrics)** if you want to inspect raw metrics.

4. To stop:
   ```bash
   docker compose --profile observability down
   ```

---

### Grafana Cloud (free tier, recommended for remote/VPS deployments)

Grafana Cloud's free tier includes hosted Prometheus storage, dashboards, alerting, and 14-day retention at no cost — no self-hosted infrastructure needed.

**One-time setup:**

1. Create a free account at [https://grafana.com/auth/sign-up](https://grafana.com/auth/sign-up) and create a stack (e.g. `mystack`).

2. In Grafana Cloud, go to **Home → Connections → Add new connection → OpenTelemetry (OTLP)**.
   Copy the endpoint URL and generate a token with **MetricsPublisher** role.

3. Add these lines to your `.env` file (replace with your actual values):
   ```
   TRIDENT_OBSERVABILITY=otel
   OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-eu-west-0.grafana.net/otlp
   OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64-encoded-instanceid:token>
   OTEL_SERVICE_NAME=trident
   ```
   > The endpoint and token format are shown on the Grafana Cloud OTLP connection page.

4. Restart normally (no extra profile needed — the standard `docker compose up -d` applies):
   ```bash
   docker compose up -d
   ```
   Metrics will appear in Grafana Cloud within ~2 minutes.

5. Import the pre-built dashboard:
   - In Grafana Cloud, go to **Dashboards → New → Import**
   - Upload `docker/grafana/dashboards/trident.json` from this folder
   - Select your Prometheus datasource when prompted

---

## Acceptance Test Report

The latest acceptance test report shows each scenario the engine was validated against (entries, breakeven, close, small accounts, DVS blocking, etc.) — with screenshots of the UI at each step.

**[Download the latest report](https://github.com/walshe/quantum-sage/raw/main/trident/impl/nodejs/acceptance-results/latest/report.html)**

> **To view it:** right-click the link above and choose **Save Link As...** (Chrome/Firefox) or **Save Linked Content As...** (Opera/Safari) → save the `.html` file to your desktop → double-click to open in your browser. It won't display correctly if you try to open it directly in the browser tab without downloading first.

---

## Troubleshooting

**Dashboard not loading?**
Check the container is running:
```bash
docker compose ps
```

**See what the app is doing (raw terminal):**
```bash
docker compose logs -f
```
Press `Ctrl+C` to stop following the logs.

**See structured logs in Grafana (when observability profile is running):**

Open **[http://localhost:3001/a/grafana-lokiexplore-app/](http://localhost:3001/a/grafana-lokiexplore-app/)**, select the **Loki** datasource, then filter by `service = trident`. All log lines from the app appear here with structured fields (level, module, message, and any metadata) that you can filter and search.

> Logs are collected by Promtail from the Docker container's stdout and shipped to Loki automatically — no extra configuration needed when the observability profile is active.

**Something broken, want a clean restart:**
```bash
docker compose down
docker compose up -d
```

**Windows: container starts but behaves oddly?**
Check your `.env` file has LF line endings (see step 2 above).

---

## VPS / Hetzner Deployment

For remote server deployment (e.g. Hetzner VPS), see **[HETZNER.md](./HETZNER.md)** for step-by-step instructions including all scp commands, authentication, and troubleshooting.
