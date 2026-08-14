$ErrorActionPreference = "Stop"

$dashboardRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$workbenchRoot = Join-Path $dashboardRoot "Workbench"
$serviceRoot = Join-Path $dashboardRoot "services\ingestion"
$environmentFile = Join-Path $workbenchRoot ".env"
$stateRoot = Join-Path $env:LOCALAPPDATA "personal-ai-dashboard"
$stateFile = Join-Path $stateRoot "processes.json"

function Import-DashboardEnvironment([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
        $parts = $trimmed.Split("=", 2)
        if ($parts.Count -ne 2 -or $parts[0] -notmatch "^[A-Za-z_][A-Za-z0-9_]*$") { continue }
        if (-not [Environment]::GetEnvironmentVariable($parts[0], "Process")) {
            $value = $parts[1].Trim().Trim('"').Trim("'")
            [Environment]::SetEnvironmentVariable($parts[0], $value, "Process")
        }
    }
}

function Get-ServicePython {
    if ($env:PERSONAL_DASHBOARD_INGESTION_PYTHON) {
        return (Resolve-Path -LiteralPath $env:PERSONAL_DASHBOARD_INGESTION_PYTHON).Path
    }
    $localPython = Join-Path $serviceRoot ".venv\Scripts\python.exe"
    if (Test-Path -LiteralPath $localPython -PathType Leaf) { return $localPython }
    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($python) { return $python.Source }
    throw "Ingestion Python was not found. Set PERSONAL_DASHBOARD_INGESTION_PYTHON."
}

function Save-ProcessState([System.Diagnostics.Process]$Dashboard, [System.Diagnostics.Process]$Ingestion) {
    New-Item -ItemType Directory -Force -Path $stateRoot | Out-Null
    @{
        dashboard = @{
            id = $Dashboard.Id
            name = $Dashboard.ProcessName
            startedAt = $Dashboard.StartTime.ToUniversalTime().ToString("o")
        }
        ingestion = @{
            id = $Ingestion.Id
            name = $Ingestion.ProcessName
            startedAt = $Ingestion.StartTime.ToUniversalTime().ToString("o")
        }
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stateFile -Encoding UTF8
}

Import-DashboardEnvironment $environmentFile

if (Test-Path -LiteralPath $stateFile -PathType Leaf) {
    throw "Dashboard may already be running. Run scripts\stop-dashboard.ps1 first."
}

$servicePython = Get-ServicePython
& $servicePython -c "import fastapi, psutil, uvicorn" 2>$null
if ($LASTEXITCODE -ne 0) {
    throw "Ingestion Python is missing dependencies from services\ingestion\requirements.txt."
}

$node = (Get-Command node -ErrorAction Stop).Source
$viteEntry = Join-Path $workbenchRoot "node_modules\vite\bin\vite.js"
if (-not (Test-Path -LiteralPath $viteEntry -PathType Leaf)) {
    throw "Dashboard frontend dependencies are missing. Run npm install in the frontend directory."
}

$ingestionProcess = $null
$dashboardProcess = $null
try {
    $ingestionProcess = Start-Process -FilePath $servicePython -ArgumentList "run_server.py" -WorkingDirectory $serviceRoot -WindowStyle Hidden -PassThru
    $dashboardProcess = Start-Process -FilePath $node -ArgumentList $viteEntry, "--host", "127.0.0.1", "--port", "5173", "--strictPort" -WorkingDirectory $workbenchRoot -WindowStyle Hidden -PassThru
    Save-ProcessState $dashboardProcess $ingestionProcess

    $deadline = (Get-Date).AddSeconds(20)
    do {
        try {
            $ingestionReady = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8765/api/health" -TimeoutSec 2).StatusCode -eq 200
            $dashboardReady = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:5173" -TimeoutSec 2).StatusCode -eq 200
        } catch {
            $ingestionReady = $false
            $dashboardReady = $false
        }
        if (-not ($ingestionReady -and $dashboardReady)) { Start-Sleep -Milliseconds 400 }
    } while ((Get-Date) -lt $deadline -and -not ($ingestionReady -and $dashboardReady))

    if (-not ($ingestionReady -and $dashboardReady)) {
        throw "Dashboard or ingestion service did not become ready within 20 seconds."
    }
    Write-Output "Dashboard started: http://127.0.0.1:5173/ingestion"
} catch {
    if ($dashboardProcess -and -not $dashboardProcess.HasExited) { Stop-Process -Id $dashboardProcess.Id -Force }
    if ($ingestionProcess -and -not $ingestionProcess.HasExited) { Stop-Process -Id $ingestionProcess.Id -Force }
    Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue
    throw
}
