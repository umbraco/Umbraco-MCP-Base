#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SITE_DIR="$PROJECT_DIR/demo-site"

if [ ! -f "$SITE_DIR"/*.csproj ] 2>/dev/null; then
  echo "No Umbraco instance found in demo-site/"
  echo ""
  echo "Create one with:"
  echo "  npx @umbraco-cms/create-umbraco-mcp-server init"
  exit 1
fi

echo "Starting Umbraco from demo-site/..."
cd "$SITE_DIR"
dotnet run
