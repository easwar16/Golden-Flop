#!/bin/sh
set -e

echo "[entrypoint] Running Prisma migrations..."
cd /app/apps/server
npx prisma migrate deploy

echo "[entrypoint] Starting server..."
cd /app
exec node apps/server/dist/index.js
