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

# Fixed dev-only key so Umbraco doesn't generate one and write it into the
# tracked appsettings.json on first boot. Not a secret — this instance only
# ever holds disposable local/CI test data.
export Umbraco__CMS__Imaging__HMACSecretKey="UVxUpS9ujPsI5cHolRYY3dOOVT9Z9yJwU0kWhVDAUcM667c/S7gCjG/t0IIvDbNobMaSQojnzTrRCnZ1ad0GcQ=="

dotnet run --project "$PROJECT_DIR"
