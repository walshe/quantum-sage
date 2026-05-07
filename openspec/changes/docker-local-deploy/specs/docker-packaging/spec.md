## ADDED Requirements

### Requirement: App builds as a Docker image
The project SHALL include a multi-stage `Dockerfile` in `trident/impl/nodejs/` that compiles TypeScript in a builder stage and produces a lean production image using `node:20-alpine`.

#### Scenario: Image builds successfully
- **WHEN** `docker compose up --build` is run from `trident/impl/nodejs/`
- **THEN** the image builds without error and the container starts

#### Scenario: Image contains only production artefacts
- **WHEN** the built image is inspected
- **THEN** it contains `dist/` and production `node_modules/` but NOT `src/`, `tests/`, or dev dependencies

### Requirement: App runs via Docker Compose
A `docker-compose.yml` SHALL be provided in `trident/impl/nodejs/` that starts the Trident service with a single command.

#### Scenario: Dashboard is reachable after compose up
- **WHEN** `docker compose up` completes
- **THEN** the dashboard is accessible at `http://localhost:3000`

#### Scenario: Container restarts without losing data
- **WHEN** `docker compose down` followed by `docker compose up` is run
- **THEN** all files in `config.yaml`, `.env`, `setups/`, and `logs/` are present and unchanged

### Requirement: Data directories are bind-mounted from the host
`config.yaml`, `.env`, `setups/`, `logs/`, and `screenshots/` SHALL be bind-mounted from the host directory so data persists independently of the container lifecycle.

#### Scenario: Setup file written from dashboard is visible on host
- **WHEN** a setup is submitted via the dashboard inside the container
- **THEN** the resulting YAML file appears in the host `setups/` directory

#### Scenario: Log file persists after container is removed
- **WHEN** `docker compose down` is run (container removed)
- **THEN** `logs/trident.log` still exists on the host

### Requirement: Credentials are supplied via .env file
An `.env.example` SHALL be provided listing all required environment variables. The `docker-compose.yml` SHALL reference `.env` via `env_file` so credentials are never baked into the image.

#### Scenario: Missing .env prevents startup with a clear error
- **WHEN** `docker compose up` is run without a `.env` file present
- **THEN** the container fails to start and logs a message indicating the missing file

### Requirement: Non-technical operator instructions are provided
A `RUNNING.md` file SHALL be provided in `trident/impl/nodejs/` with plain-English instructions for FB covering: installing Docker Desktop, first-time setup, daily start/stop, and how to update to a new version.

#### Scenario: Instructions cover the full daily workflow
- **WHEN** a non-technical user follows `RUNNING.md` from scratch
- **THEN** they can install Docker Desktop, start the app, open the dashboard, and stop the app without additional guidance
