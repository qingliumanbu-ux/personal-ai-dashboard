$ErrorActionPreference = "Stop"

$stateRoot = Join-Path $env:LOCALAPPDATA "personal-ai-dashboard"
$stateFile = Join-Path $stateRoot "processes.json"

if (-not (Test-Path -LiteralPath $stateFile -PathType Leaf)) {
    Write-Output "Dashboard has no recorded running processes."
    exit 0
}

$state = Get-Content -Raw -LiteralPath $stateFile -Encoding UTF8 | ConvertFrom-Json

function Stop-RecordedProcess($Record) {
    $process = Get-Process -Id $Record.id -ErrorAction SilentlyContinue
    if (-not $process) { return }
    $actualStart = $process.StartTime.ToUniversalTime()
    $recordedStart = ([DateTime]$Record.startedAt).ToUniversalTime()
    if ($process.ProcessName -ne $Record.name -or $actualStart -ne $recordedStart) {
        throw "Process state is stale; no unrelated process was stopped."
    }
    Stop-Process -Id $process.Id -Force
}

Stop-RecordedProcess $state.dashboard
Stop-RecordedProcess $state.ingestion
Remove-Item -LiteralPath $stateFile -Force
Write-Output "Dashboard and ingestion service stopped."
