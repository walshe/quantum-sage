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

## Troubleshooting

**Dashboard not loading?**
Check the container is running:
```bash
docker compose ps
```

**See what the app is doing:**
```bash
docker compose logs -f
```
Press `Ctrl+C` to stop following the logs.

**Something broken, want a clean restart:**
```bash
docker compose down
docker compose up -d
```

**Windows: container starts but behaves oddly?**
Check your `.env` file has LF line endings (see step 2 above).
