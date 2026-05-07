## Context

Trident is a Node.js/TypeScript app that runs a trading engine and serves a dashboard on port 3000. Currently it requires Node.js ≥ 20 and npm installed on the host. FB is a non-technical analyst on Mac who should be able to start and stop the app without any knowledge of Node or the terminal beyond the minimum. Docker Desktop provides a GUI and a single `docker compose up` command that handles everything.

The app has a few moving parts that need to survive container restarts:
- `config.yaml` — system parameters (rarely changes, but FB shouldn't lose edits)
- `.env` — cTrader OAuth tokens (rotated by the engine; must persist and be writable)
- `setups/` — YAML setup files submitted from the dashboard
- `logs/` — Winston JSON audit log

Source code and compiled output live inside the image. Data directories are bind-mounted from the host.

## Goals / Non-Goals

**Goals:**
- FB can start the app with `docker compose up` and stop it with `docker compose down`
- Data (config, env, setups, logs) persists across restarts and image rebuilds
- Dashboard accessible at `http://localhost:3000` as before
- Image is lean and builds in reasonable time on a Mac
- Emmett can ship an updated image and FB just pulls and restarts

**Non-Goals:**
- Remote/cloud deployment — this is local-only for now
- Multi-container setup (database, reverse proxy, etc.) — single service
- Automatic image updates / watchtower — manual pull for now
- Windows support

## Decisions

### Multi-stage build
Use a two-stage Dockerfile: `builder` stage installs deps and compiles TypeScript, `runner` stage copies only `dist/` and `node_modules` (production only). Keeps the final image small and free of TypeScript compiler tooling.

**Alternative considered:** Single stage — simpler but image is ~3× larger with dev deps and source files included. Not worth it.

### Base image: `node:20-alpine`
Alpine is small (~50 MB base vs ~350 MB for `node:20`). No native addons in this project so glibc vs musl is not a concern.

### Bind mounts for data directories
`config.yaml`, `.env`, `setups/`, `logs/`, and `screenshots/` are bind-mounted from the host directory alongside `docker-compose.yml`. This means FB's data is never inside the container and survives `docker compose down --rmi all`.

**Alternative considered:** Named Docker volumes — cleaner isolation but harder for FB to navigate to his setup files. Bind mounts let him find files where he expects them.

### `.env` handling
The engine reads `.env` at startup and the cTrader feed may rewrite it during token rotation. The bind mount keeps `.env` on the host. A `.env.example` is provided so FB can copy and fill in credentials once.

### Port
Port 3000 exposed as `3000:3000`. Matches current dev setup so no URL changes for FB.

## Risks / Trade-offs

- **cTrader token rotation writes to .env** — the bind-mounted `.env` on the host will be updated by the container process. This is the same behaviour as the non-Docker setup; no change in risk.
- **File permission on bind mounts** — Alpine runs as root by default; bind-mounted directories created by the container will be owned by root on the host. Mitigation: add a non-root `node` user in the Dockerfile and `chown` the working directory, or document that `sudo` may be needed to inspect logs.
- **Apple Silicon (ARM64)** — `node:20-alpine` has ARM64 builds; no emulation needed on M-series Macs. If FB is on Intel it works too.
- **First-time image build** — takes 1-2 min on first run (`docker compose up --build`). Subsequent starts are instant. Document this for FB so he isn't alarmed.

## Open Questions

- Does FB have Docker Desktop already, or do we need to include install instructions in `RUNNING.md`?
- Should `RUNNING.md` include a section on how to update to a new version (pull + rebuild)?
