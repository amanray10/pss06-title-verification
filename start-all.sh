#!/usr/bin/env bash
# ===========================================================================
#  PSS06 - PRGI Title Verification System
#  Starts the AI service, the backend and the frontend together.
#  Ctrl-C stops all three.
# ===========================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo
echo "  Starting PSS06 - PRGI Title Verification System"
echo "  ----------------------------------------------"

pids=()
cleanup() {
  echo
  echo "  stopping..."
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

( cd ai-service && python3 -m uvicorn main:app --host 127.0.0.1 --port 8000 ) &
pids+=($!)
echo "   1. AI service   -> http://127.0.0.1:8000   (loading the registry, ~10s)"
sleep 12

( cd backend && npm start ) &
pids+=($!)
echo "   2. Backend      -> http://localhost:5000"
sleep 4

( cd frontend && npm run dev ) &
pids+=($!)
echo "   3. Frontend     -> http://localhost:3000"
echo
echo "  Demo login: admin@prgi.gov / admin123"
echo

wait
