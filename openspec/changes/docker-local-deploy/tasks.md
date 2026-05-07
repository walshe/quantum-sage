## 1. Dockerfile

- [x] 1.1 Create `trident/impl/nodejs/Dockerfile` with a two-stage build: `builder` stage installs all deps and runs `tsc`; `runner` stage copies `dist/` and production `node_modules/` from builder using `node:20-alpine`
- [x] 1.2 Add a non-root `node` user in the runner stage and set `USER node` so the container doesn't run as root
- [x] 1.3 Set `WORKDIR /app`, `EXPOSE 3000`, and `CMD ["node", "dist/index.js"]` in the runner stage

## 2. Docker Compose

- [x] 2.1 Create `trident/impl/nodejs/docker-compose.yml` defining the `trident` service built from the local Dockerfile
- [x] 2.2 Add `env_file: .env` to the service so cTrader credentials are loaded from the host `.env`
- [x] 2.3 Add port mapping `"3000:3000"`
- [x] 2.4 Add bind mounts for `./config.yaml:/app/config.yaml`, `./.env:/app/.env`, `./setups:/app/setups`, `./logs:/app/logs`, `./screenshots:/app/screenshots`
- [x] 2.5 Add `restart: unless-stopped` so the container recovers from crashes without manual intervention

## 3. Supporting files

- [x] 3.1 Create `trident/impl/nodejs/.dockerignore` excluding: `node_modules`, `dist`, `logs`, `screenshots`, `setups`, `.env`, `*.log`
- [x] 3.2 Create `trident/impl/nodejs/.env.example` listing all required env vars with placeholder values and a comment for each

## 4. Operator instructions

- [x] 4.1 Create `trident/impl/nodejs/RUNNING.md` with plain-English sections: Install Docker Desktop, First-time setup (copy `.env.example` → `.env`, fill in credentials), Daily start (`docker compose up -d`), Open dashboard (`http://localhost:3000`), Daily stop (`docker compose down`), Updating to a new version (`docker compose down`, `git pull`, `docker compose up --build -d`)

## 5. Verify

- [x] 5.1 Run `docker compose up --build` from `trident/impl/nodejs/` and confirm the container starts without errors
- [x] 5.2 Open `http://localhost:3000` and confirm the dashboard loads
- [x] 5.3 Submit a test setup via the dashboard and confirm the YAML file appears in the host `setups/` directory
- [x] 5.4 Run `docker compose down` and confirm `logs/trident.log` still exists on the host
- [x] 5.5 Run `docker compose up` (no `--build`) and confirm it starts immediately from the cached image
