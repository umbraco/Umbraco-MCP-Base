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

# Generated fresh each run so Umbraco doesn't generate one and write it into
# the tracked appsettings.json on first boot. Only needs to be internally
# consistent for the life of this process — this instance only ever holds
# disposable local/CI test data.
export Umbraco__CMS__Imaging__HMACSecretKey="$(openssl rand -base64 64)"

dotnet run --project "$PROJECT_DIR"
