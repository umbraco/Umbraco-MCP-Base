#!/bin/bash
# Start the test Umbraco instance.
# First run will auto-install with SQLite and create the admin user.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Starting test Umbraco instance..."
echo "  HTTP:  http://localhost:5200"
echo "  HTTPS: https://localhost:5201"
echo ""
echo "First run will auto-install (unattended). This may take a minute."
echo ""

dotnet run --project "$PROJECT_DIR"
