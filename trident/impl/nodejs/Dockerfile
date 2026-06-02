# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /build

COPY package*.json ./
# Build tools needed for native dev modules (e.g. better-sqlite3 via mongoose)
RUN apk add --no-cache python3 make g++
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Stage 2: run ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Production deps only
COPY package*.json ./
RUN npm ci --omit=dev

# Compiled app
COPY --from=builder /build/dist ./dist

# Static web assets (served from src/web/public relative to CWD)
COPY --from=builder /build/src/web/public ./src/web/public

# Runtime directories — all bind-mounted from host, created here so the
# container starts cleanly if the host paths don't exist yet
RUN mkdir -p setups logs screenshots

EXPOSE 3000

USER node

CMD ["node", "--experimental-vm-modules", "dist/index.js"]
