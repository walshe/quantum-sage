## Why

FB (the analyst) needs to run Trident on his own Mac without installing Node.js, managing versions, or touching the terminal beyond a single command. Docker packages the app and all its dependencies into a single unit he can start and stop with Docker Desktop.

## What Changes

- Add `Dockerfile` to build the Trident Node.js app into a container image
- Add `docker-compose.yml` to define the service, port binding, volume mounts, and env file wiring
- Add `.dockerignore` to keep the image lean (exclude `node_modules`, `dist`, `logs`, `screenshots`, `setups`)
- Add a short `RUNNING.md` in `trident/impl/nodejs/` with FB-friendly start/stop instructions (open Docker Desktop, run one command, open browser)

## Capabilities

### New Capabilities
- `docker-packaging`: Containerised build and run setup for the Trident Node.js app — Dockerfile, Compose file, and operator instructions targeting a non-technical user on Mac

### Modified Capabilities
<!-- none -->

## Impact

- `trident/impl/nodejs/` — new `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `RUNNING.md`
- No changes to application source code
- `config.yaml`, `.env`, `setups/`, and `logs/` are bind-mounted so FB's data persists across container restarts and image updates
- Port 3000 exposed on localhost (dashboard access unchanged)
