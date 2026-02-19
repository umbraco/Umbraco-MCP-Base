$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$SiteDir = Join-Path $ProjectDir "demo-site"

if (-not (Get-ChildItem -Path $SiteDir -Filter "*.csproj" -ErrorAction SilentlyContinue)) {
    Write-Host "No Umbraco instance found in demo-site/"
    Write-Host ""
    Write-Host "Create one with:"
    Write-Host "  npx create-umbraco-mcp-server init"
    exit 1
}

Write-Host "Starting Umbraco from demo-site/..."
Set-Location $SiteDir
dotnet run
