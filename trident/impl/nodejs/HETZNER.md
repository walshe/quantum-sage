# Hetzner Server Setup — QS-TRIDENT-DEMO

Notes on how the Hetzner VPS is configured to run Trident, specifically the
Tailscale networking and Docker port isolation that differs from a standard deployment.

---

## Server details

- **Provider:** Hetzner
- **Hostname:** QS-TRIDENT-DEMO
- **Public IP:** 37.27.92.200
- **Tailscale IP:** 100.83.1.83
- **Working directory:** `~/trident/impl/nodejs/`

---

## Files on the server

```
~/trident/impl/nodejs/
  docker-compose.yml            ← base file (pulled from repo, don't edit)
  docker-compose.override.yml   ← server-specific overrides (NOT in repo)
  .env                          ← credentials (NOT in repo)
  config.yaml                   ← engine config (NOT in repo)
  setups/
  logs/
  screenshots/
```

---

## docker-compose.override.yml

Docker Compose automatically merges this file with `docker-compose.yml` on every
`docker compose up`. It is NOT checked into the repo — it lives only on this server.

Current contents:

```yaml
services:
  trident:
    ports:
      - "3000:3000"
    dns:
      - 8.8.8.8
      - 8.8.4.4
```

The `dns` entries fix Docker's inability to resolve external hostnames (needed for
the cTrader WebSocket connection to `demo.ctraderapi.com`).

---

## Firewall — blocking public access to port 3000

The app binds on `0.0.0.0:3000` so Docker can route properly, but the public
Hetzner IP must not be accessible from the internet. This is enforced via iptables
in the `DOCKER-USER` chain (the correct chain for Docker port-mapping rules —
the INPUT chain is bypassed by Docker).

The rule that blocks public access:

```bash
iptables -I DOCKER-USER -i eth0 -p tcp --dport 3000 -j DROP
```

This drops traffic arriving on `eth0` (the public Hetzner interface) to port 3000,
while leaving Tailscale (`tailscale0`) and localhost unaffected.

### Making it persistent across reboots

```bash
apt install iptables-persistent
netfilter-persistent save
```

Rules are saved to `/etc/iptables/rules.v4` and restored automatically on boot.

### Verifying the rule is active

```bash
iptables -L DOCKER-USER -n --line-numbers
```

Should show the DROP rule for `eth0` on dpt:3000.

---

## Tailscale access

The app is accessible within the Tailnet at:

```
http://100.83.1.83:3000
```

No Tailscale serve or funnel is needed — binding Docker to port 3000 and blocking
eth0 via iptables is sufficient. Any device on the Tailnet can reach the dashboard
directly via the Tailscale IP.

> **Do not run `tailscale serve` pointing at port 3000** — it will conflict with
> Docker's port binding and cause startup failures.

---

## Daily operations

```bash
cd ~/trident/impl/nodejs
docker compose pull        # fetch latest image
docker compose down
docker compose up -d
docker compose logs -f     # watch logs
```

---

## After a reboot

1. Verify iptables rule survived: `iptables -L DOCKER-USER -n | grep 3000`
2. If missing, re-add: `iptables -I DOCKER-USER -i eth0 -p tcp --dport 3000 -j DROP`
3. Verify Tailscale is up: `tailscale status`
4. Start the app: `docker compose up -d`
