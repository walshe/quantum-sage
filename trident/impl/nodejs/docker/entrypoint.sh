#!/bin/sh
set -e
# Fix ownership of bind-mounted directories so the node user can write to them.
# Docker creates missing host directories as root; this corrects it at startup.
chown -R node:node /app/setups /app/logs /app/screenshots 2>/dev/null || true
exec su-exec node "$@"
