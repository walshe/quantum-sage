# Deploying Trident to Hetzner / VPS

Instructions for deploying Trident to a remote Linux server (e.g. Hetzner VPS) with full observability (Prometheus + Grafana).

---

## Prerequisites

- SSH access to the VPS (e.g. `root@100.83.1.83`)
- Docker and Docker Compose installed on the VPS
- GitHub token with `read:packages` scope for pulling the private image
- Local copy of the `quantum-sage` repository with all config files

---

## Fresh Deployment (From Local Machine)

### 1. Prepare local files

On your **local machine**, ensure these files exist:

```bash
cd /path/to/quantum-sage/trident/impl/nodejs
ls -la docker-compose.yml config.yaml .env
ls -la docker/grafana/provisioning/
ls -la docker/loki/
ls -la docker/prometheus/
ls -la docker/promtail/
```

If any are missing, check out the `feature/grafana-provisioning` branch first.

### 2. Create remote directories

```bash
ssh root@YOUR_VPS_IP "mkdir -p /root/trident/impl/nodejs/docker/{grafana,loki,prometheus,promtail}"
```

### 3. Copy all files to VPS

From your local machine:

```bash
cd /path/to/quantum-sage/trident/impl/nodejs

# Docker compose and config files
scp docker-compose.yml root@YOUR_VPS_IP:/root/trident/impl/nodejs/
scp docker-compose.override.hetzner.yml root@YOUR_VPS_IP:/root/trident/impl/nodejs/
scp config.yaml root@YOUR_VPS_IP:/root/trident/impl/nodejs/
scp .env root@YOUR_VPS_IP:/root/trident/impl/nodejs/

# Provisioning configs
scp -r docker/grafana/provisioning root@YOUR_VPS_IP:/root/trident/impl/nodejs/docker/grafana/
scp -r docker/loki root@YOUR_VPS_IP:/root/trident/impl/nodejs/docker/
scp -r docker/prometheus root@YOUR_VPS_IP:/root/trident/impl/nodejs/docker/
scp -r docker/promtail root@YOUR_VPS_IP:/root/trident/impl/nodejs/docker/
```

### 4. Authenticate and start on VPS

SSH into the VPS:

```bash
ssh root@YOUR_VPS_IP
cd /root/trident/impl/nodejs

# One-time: authenticate with GitHub container registry
echo YOUR_GITHUB_TOKEN | docker login ghcr.io -u walshe --password-stdin
```

Verify you see: `Login Succeeded`

Then start the stack:

```bash
docker compose -f docker-compose.yml -f docker-compose.override.hetzner.yml --profile observability up -d
sleep 3
docker ps
```

You should see 4 containers running:
- `nodejs-trident-1` (the trading engine)
- `nodejs-prometheus-1` (metrics collection)
- `nodejs-grafana-1` (dashboard)
- `nodejs-loki-1` (log aggregation)

### 5. Access the dashboards

- **Trident UI**: `http://YOUR_VPS_IP:3000`
- **Grafana**: `http://YOUR_VPS_IP:3001` (username: `admin`, password: `trident`)
  - The **Trident Trading Engine** dashboard is pre-loaded
- **Prometheus**: `http://YOUR_VPS_IP:9090`

---

## What the Hetzner Override Does

`docker-compose.override.hetzner.yml` disables optional services that require complex setup, keeping only essentials:

**Disabled:**
- ❌ Loki (log aggregation) — optional for this use case
- ❌ Promtail (log shipper) — optional for this use case

**Enabled:**
- ✓ Trident (trading engine with TRIDENT_OBSERVABILITY=prometheus)
- ✓ Prometheus (metrics scraper)
- ✓ Grafana (dashboard with auto-provisioned Prometheus datasource and Trident dashboard)

All Grafana configuration is automatic — the datasource and dashboard load on first access. No manual setup needed.

---

## Restoring Data from Old Deployment

If migrating from a previous Hetzner instance and want to preserve logs, setups, and screenshots:

```bash
ssh root@YOUR_VPS_IP
cd /root/trident/impl/nodejs

# Restore from backup (if it exists)
cp -r /root/trident.backup/impl/nodejs/logs . 2>/dev/null || true
cp -r /root/trident.backup/impl/nodejs/setups . 2>/dev/null || true
cp -r /root/trident.backup/impl/nodejs/screenshots . 2>/dev/null || true
```

---

## Daily Operations

### Check Status

```bash
ssh root@YOUR_VPS_IP
cd /root/trident/impl/nodejs
docker ps
docker compose logs -f trident
```

Press `Ctrl+C` to stop following logs.

### Stop Everything

```bash
docker compose down
```

Your data (`.env`, `config.yaml`, `setups/`, `logs/`, `screenshots/`) is safely stored on disk and persists across restarts.

### Restart

```bash
docker compose -f docker-compose.yml -f docker-compose.override.hetzner.yml --profile observability up -d
```

---

## Updating to Latest Version

When a new version is published:

```bash
ssh root@YOUR_VPS_IP
cd /root/trident/impl/nodejs

# Pull the latest image
docker compose pull

# Restart with latest
docker compose -f docker-compose.yml -f docker-compose.override.hetzner.yml --profile observability up -d
```

Your data is never affected — `.env`, `config.yaml`, `setups/`, `logs/` all persist.

---

## Troubleshooting

**Container won't start / fails immediately:**
```bash
docker compose logs nodejs-trident-1
```

Check for missing config files or credential issues.

**Grafana not loading:**
```bash
docker compose logs nodejs-grafana-1
```

Verify the Prometheus datasource is configured correctly in Grafana → Connections → Data sources.

**Prometheus not scraping metrics:**
1. Check target status: `http://YOUR_VPS_IP:9090/targets`
2. Verify Trident is running: `docker ps | grep trident`
3. Check if metrics endpoint is responding: `curl http://YOUR_VPS_IP:3000/metrics | head -20`

**Clean restart (nuclear option):**
```bash
docker compose down
docker system prune -f
docker compose -f docker-compose.yml -f docker-compose.override.hetzner.yml --profile observability up -d
```

---

## File Structure on VPS

After deployment, your `/root/trident/impl/nodejs` should look like:

```
.env                                    (secrets - never commit)
config.yaml                             (app configuration)
docker-compose.yml                      (main orchestration)
docker-compose.override.hetzner.yml     (VPS production tweaks)
docker/
  ├── grafana/
  │   └── provisioning/
  │       ├── datasources/prometheus.yml
  │       └── dashboards/
  │           ├── dashboards.yml
  │           └── trident.json
  ├── loki/
  │   └── loki-config.yml
  ├── prometheus/
  │   └── prometheus.yml
  └── promtail/
      └── promtail-config.yml
logs/                                   (engine logs and state snapshots)
setups/                                 (trading setup YAML files)
screenshots/                            (uploaded chart images)
```

---

## Support

For issues or questions:
- Check logs: `docker compose logs <service-name>`
- Review Trident UI error messages: `http://YOUR_VPS_IP:3000`
- Check Grafana dashboard for metric gaps: `http://YOUR_VPS_IP:3001`

Contact Emmett if something fails during deployment.
