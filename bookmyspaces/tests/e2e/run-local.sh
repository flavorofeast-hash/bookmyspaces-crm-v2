#!/usr/bin/env bash
# Full local end-to-end run: fresh sample database, production build, mock Meta API, real Chrome.
set -euo pipefail
cd "$(dirname "$0")/../.."
source /tmp/e2e.env
pkill -f "next-server|next start" 2>/dev/null || true; pkill -f mock-graph.mjs 2>/dev/null || true; sleep 1
psql -h /tmp -p 5433 -U postgres -q -c "DROP DATABASE IF EXISTS crm_demo" -c "CREATE DATABASE crm_demo"
ALLOW_SAMPLE_SEED=yes npm run -s db:seed-sample 2>&1 | grep -v Deprecation | tail -1
npm run -s build > /tmp/build.out 2>&1 || { tail -30 /tmp/build.out; exit 1; }
node tests/e2e/mock-graph.mjs > /tmp/mock.out 2>&1 &
nohup npx next start -p 3000 > /tmp/next.out 2>&1 &
for i in $(seq 1 30); do curl -sf localhost:3000/api/health >/dev/null && break; sleep 1; done
rm -rf test-artifacts
node tests/e2e/acceptance.mjs
