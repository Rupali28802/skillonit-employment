# Read-only Atlas/process evidence collector for the existing Windows worker host.
[CmdletBinding()]
param(
    [string]$BackendPath,
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
if ([string]::IsNullOrWhiteSpace($BackendPath)) { $BackendPath = Join-Path $projectRoot 'backend' }
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) { $OutputDirectory = Join-Path $projectRoot '.cutover-evidence' }
$backend = (Resolve-Path -LiteralPath $BackendPath).Path
$exporter = Join-Path $backend 'scripts\export-atlas-reconciliation-manifest.mjs'
$inspector = Join-Path $PSScriptRoot 'inspect-atlas-writers.ps1'
$envFile = Join-Path $backend '.env'

if (-not (Test-Path -LiteralPath $exporter -PathType Leaf)) { throw 'ATLAS_MANIFEST_EXPORTER_MISSING' }
if (-not (Test-Path -LiteralPath $inspector -PathType Leaf)) { throw 'ATLAS_WRITER_INSPECTOR_MISSING' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'NODE_RUNTIME_MISSING' }

$inheritedUri = -not [string]::IsNullOrWhiteSpace($env:MONGODB_URI)
$envHasUri = (Test-Path -LiteralPath $envFile -PathType Leaf) -and
    [bool](Select-String -LiteralPath $envFile -Pattern '^\s*MONGODB_URI\s*=' -Quiet)
if (-not $inheritedUri -and -not $envHasUri) { throw 'MONGODB_URI_NOT_AVAILABLE_IN_PROCESS_OR_BACKEND_ENV' }

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$output = (Resolve-Path -LiteralPath $OutputDirectory).Path
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$manifest = Join-Path $output ".atlas-reconciliation-manifest-$stamp.jsonl"
$before = Join-Path $output "atlas-writers-before-$stamp.json"
$after = Join-Path $output "atlas-writers-after-$stamp.json"

& $inspector -IncludePublicIp | Set-Content -LiteralPath $before -Encoding UTF8

$previousOutput = $env:ATLAS_MANIFEST_OUTPUT
try {
    $env:ATLAS_MANIFEST_OUTPUT = $manifest
    Push-Location $backend
    try {
        if ($envHasUri) {
            & node '--env-file=.env' 'scripts/export-atlas-reconciliation-manifest.mjs'
        } else {
            & node 'scripts/export-atlas-reconciliation-manifest.mjs'
        }
        if ($LASTEXITCODE -ne 0) { throw "ATLAS_MANIFEST_EXPORT_FAILED_$LASTEXITCODE" }
    } finally {
        Pop-Location
    }
} finally {
    $env:ATLAS_MANIFEST_OUTPUT = $previousOutput
}

& $inspector -IncludePublicIp | Set-Content -LiteralPath $after -Encoding UTF8

$lastLine = Get-Content -LiteralPath $manifest -Tail 1 | ConvertFrom-Json
if ($lastLine.complete -ne $true) { throw 'ATLAS_MANIFEST_INCOMPLETE' }

[ordered]@{
    Result = 'PASS'
    ReadOnly = $true
    Manifest = $manifest
    WriterInventoryBefore = $before
    WriterInventoryAfter = $after
    RecordsHashed = $lastLine.total
    CompletedAt = $lastLine.completedAt
} | ConvertTo-Json
