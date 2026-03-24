#!/bin/bash
# Start Cloudflare tunnels for local dev testing with remote MCP clients
# (e.g. ChatGPT, Claude Desktop) that can't reach localhost.
#
# Tunnels:
#   - Umbraco (reads HTTPS port from .dev.vars UMBRACO_BASE_URL)
#   - Wrangler worker (http://localhost:8787)
#
# Automatically patches:
#   - .dev.vars (UMBRACO_BASE_URL → tunnel URL for browser redirects)
#   - Umbraco appsettings.local.json (MCP_TUNNEL_URL for OAuth redirect URI)
#     — only if UMBRACO_PROJECT_DIR env var is set
#
# After starting, restart Umbraco and the worker to pick up the new URLs.
#
# Usage:
#   ./scripts/tunnels.sh
#
# Optional:
#   UMBRACO_PROJECT_DIR=/path/to/UmbracoProject ./scripts/tunnels.sh
#     Sets MCP_TUNNEL_URL in that project's appsettings.local.json

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEV_VARS="$PROJECT_DIR/.dev.vars"

# Read Umbraco HTTPS URL from .dev.vars
if [ ! -f "$DEV_VARS" ]; then
  echo "ERROR: $DEV_VARS not found"
  echo "Create .dev.vars with UMBRACO_BASE_URL before running tunnels."
  exit 1
fi

UMBRACO_PORT=$(grep '^UMBRACO_BASE_URL=' "$DEV_VARS" | cut -d= -f2)
if [ -z "$UMBRACO_PORT" ]; then
  echo "ERROR: UMBRACO_BASE_URL not set in .dev.vars"
  exit 1
fi

WORKER_PORT="http://localhost:8787"

UMBRACO_LOG=$(mktemp /tmp/tunnel-umbraco.XXXXXX)
WORKER_LOG=$(mktemp /tmp/tunnel-worker.XXXXXX)

cleanup() {
  echo ""
  echo "Shutting down tunnels..."
  kill $UMBRACO_PID $WORKER_PID 2>/dev/null
  rm -f "$UMBRACO_LOG" "$WORKER_LOG"
  exit 0
}
trap cleanup SIGINT SIGTERM

echo "Starting Cloudflare tunnels..."
echo ""

# Start Umbraco tunnel (--no-tls-verify because of self-signed cert)
cloudflared tunnel --url "$UMBRACO_PORT" --no-tls-verify > "$UMBRACO_LOG" 2>&1 &
UMBRACO_PID=$!

# Start Worker tunnel
cloudflared tunnel --url "$WORKER_PORT" > "$WORKER_LOG" 2>&1 &
WORKER_PID=$!

# Wait for URLs to appear in logs
echo "Waiting for tunnel URLs..."
for i in $(seq 1 15); do
  UMBRACO_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$UMBRACO_LOG" 2>/dev/null | head -1)
  WORKER_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$WORKER_LOG" 2>/dev/null | head -1)
  if [ -n "$UMBRACO_URL" ] && [ -n "$WORKER_URL" ]; then
    break
  fi
  sleep 1
done

if [ -z "$UMBRACO_URL" ] || [ -z "$WORKER_URL" ]; then
  echo "ERROR: Timed out waiting for tunnel URLs"
  echo "  Umbraco log: $UMBRACO_LOG"
  echo "  Worker log:  $WORKER_LOG"
  cleanup
fi

# --- Patch .dev.vars ---
# Update UMBRACO_BASE_URL (used for browser redirects to Umbraco)
sed -i '' "s|^UMBRACO_BASE_URL=.*|UMBRACO_BASE_URL=$UMBRACO_URL|" "$DEV_VARS"
echo "Patched .dev.vars"
echo "  UMBRACO_BASE_URL=$UMBRACO_URL"

# --- Patch Umbraco appsettings.local.json (if UMBRACO_PROJECT_DIR is set) ---
if [ -n "$UMBRACO_PROJECT_DIR" ]; then
  APPSETTINGS="$UMBRACO_PROJECT_DIR/appsettings.local.json"

  # Create file if it doesn't exist
  if [ ! -f "$APPSETTINGS" ]; then
    echo "{}" > "$APPSETTINGS"
  fi

  if command -v python3 &>/dev/null; then
    python3 -c "
import json
with open('$APPSETTINGS', 'r') as f:
    data = json.load(f)
data['MCP_TUNNEL_URL'] = '$WORKER_URL'
with open('$APPSETTINGS', 'w') as f:
    json.dump(data, f, indent=4)
"
    echo "Patched $APPSETTINGS"
    echo "  MCP_TUNNEL_URL=$WORKER_URL"
  else
    echo "WARNING: python3 not found, cannot patch appsettings.local.json"
    echo "  Manually add: \"MCP_TUNNEL_URL\": \"$WORKER_URL\""
  fi
else
  echo ""
  echo "  To auto-register the tunnel callback URI in Umbraco, set UMBRACO_PROJECT_DIR:"
  echo "    UMBRACO_PROJECT_DIR=/path/to/UmbracoProject ./scripts/tunnels.sh"
  echo ""
  echo "  Or manually add to your Umbraco project's appsettings.local.json:"
  echo "    \"MCP_TUNNEL_URL\": \"$WORKER_URL\""
fi

echo ""
echo "========================================"
echo "  Cloudflare Tunnels"
echo "========================================"
echo ""
echo "  Umbraco:  $UMBRACO_URL"
echo "  Worker:   $WORKER_URL"
echo ""
echo "  MCP Server URL (for ChatGPT, Claude, etc.):"
echo "    $WORKER_URL/"
echo ""
echo "  Next steps:"
echo "    1. Restart Umbraco (to register tunnel callback URI)"
echo "    2. Restart worker  (npm run dev:worker)"
echo ""
echo "  Press Ctrl+C to stop"
echo "========================================"

wait
