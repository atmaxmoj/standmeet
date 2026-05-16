#!/bin/sh
# Start both Vite dev server (HMR preview) and Build API server.
# If either exits, the other is killed too.

set -e

echo "[start] Starting Vite dev server on :5173..."
npx vite dev --host &
VITE_PID=$!

echo "[start] Starting Build API server on :5174..."
node build-server.mjs &
BUILD_PID=$!

# Wait for either process to exit
wait -n $VITE_PID $BUILD_PID 2>/dev/null || true

# Kill remaining processes
kill $VITE_PID $BUILD_PID 2>/dev/null || true
wait 2>/dev/null || true
