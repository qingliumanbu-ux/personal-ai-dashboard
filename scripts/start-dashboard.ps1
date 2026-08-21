$ErrorActionPreference = "Stop"

$dashboardRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$workbenchRoot = Join-Path $dashboardRoot "Workbench"
$serviceRoot = Join-Path $dashboardRoot "services\ingestion"
$environmentFile = Join-Path $workbenchRoot ".env"
$stateRoot = Join-Path $env:LOCALAPPDATA "personal-ai-dashboard"
$stateFile = Join-Path $stateRoot "processes.json"
$logRoot = Join-Path $stateRoot "logs"
$dashboardStdout = Join-Path $logRoot "dashboard.stdout.log"
$dashboardStderr = Join-Path $logRoot "dashboard.stderr.log"
$ingestionStdout = Join-Path $logRoot "ingestion.stdout.log"
$ingestionStderr = Join-Path $logRoot "ingestion.stderr.log"
$dashboardUrl = "http://127.0.0.1:5173/"

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
    $ingestionState = $null
    if ($Ingestion) {
        $ingestionState = @{
            id = $Ingestion.Id
            name = $Ingestion.ProcessName
            startedAt = $Ingestion.StartTime.ToUniversalTime().ToString("o")
        }
    }
    @{
        dashboard = @{
            id = $Dashboard.Id
            name = $Dashboard.ProcessName
            startedAt = $Dashboard.StartTime.ToUniversalTime().ToString("o")
        }
        ingestion = $ingestionState
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stateFile -Encoding UTF8
}

function Assert-PortAvailable([int]$Port, [string]$ServiceName) {
    $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $connection) { return }
    $ownerPid = [int]$connection.OwningProcess
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerPid" -ErrorAction SilentlyContinue
    $processName = if ($processInfo) { $processInfo.Name } else { "unknown" }
    $commandLine = if ($processInfo) { [string]$processInfo.CommandLine } else { "" }
    throw "$ServiceName cannot start because port $Port is already in use by PID $ownerPid ($processName). Run scripts\\stop-dashboard.ps1 first. Command: $commandLine"
}

function Get-RecordedProcess($Record) {
    if (-not $Record -or -not $Record.id -or -not $Record.name -or -not $Record.startedAt) { return $null }
    $process = Get-Process -Id $Record.id -ErrorAction SilentlyContinue
    if (-not $process) { return $null }
    try {
        $actualStart = $process.StartTime.ToUniversalTime()
        $recordedStart = ([DateTime]$Record.startedAt).ToUniversalTime()
    } catch {
        return $null
    }
    if ($process.ProcessName -ne $Record.name -or $actualStart -ne $recordedStart) { return $null }
    return $process
}

function Test-HttpReady([string]$Uri) {
    try {
        return (Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 2).StatusCode -eq 200
    } catch {
        return $false
    }
}

function Test-IngestionReady {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:8766/api/health" -TimeoutSec 2
        if ($health.status -ne "ok") { return $false }
        if ($health.service -eq "personal-ai-dashboard-ingestion") { return $true }
        return (
            $null -ne $health.capabilities.vad -and
            $null -ne $health.capabilities.web_page -and
            $null -ne $health.capabilities.douyin
        )
    } catch {
        return $false
    }
}

function Test-IngestionIsCurrentVersion {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:8766/api/health" -TimeoutSec 2
        return $health.status -eq "ok" -and $health.service -eq "personal-ai-dashboard-ingestion"
    } catch {
        return $false
    }
}

function Open-DashboardPage {
    if ($env:PERSONAL_DASHBOARD_NO_BROWSER -eq "1") { return }
    try {
        Start-Process $dashboardUrl | Out-Null
    } catch {
        Write-Warning "Dashboard is running, but the browser could not be opened automatically. Open $dashboardUrl manually."
    }
}

Import-DashboardEnvironment $environmentFile

New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
Remove-Item -LiteralPath $dashboardStdout, $dashboardStderr, $ingestionStdout, $ingestionStderr -Force -ErrorAction SilentlyContinue

$dashboardAlreadyReady = Test-HttpReady $dashboardUrl
$ingestionAlreadyReady = Test-IngestionReady
if ($dashboardAlreadyReady -and $ingestionAlreadyReady) {
    Write-Output "Dashboard is already running: $dashboardUrl"
    Open-DashboardPage
    exit 0
}

if (Test-Path -LiteralPath $stateFile -PathType Leaf) {
    $existingState = $null
    try {
        $existingState = Get-Content -Raw -LiteralPath $stateFile -Encoding UTF8 | ConvertFrom-Json
    } catch {
        Write-Warning "Dashboard process state is unreadable; removing the stale state file."
        Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue
    }

    if ($existingState) {
        $existingDashboard = Get-RecordedProcess $existingState.dashboard
        $existingIngestion = Get-RecordedProcess $existingState.ingestion
        $dashboardReady = Test-HttpReady $dashboardUrl
        $ingestionReady = Test-IngestionReady

        if ($existingDashboard -and $existingIngestion -and $dashboardReady -and $ingestionReady) {
            Write-Output "Dashboard is already running: $dashboardUrl"
            Open-DashboardPage
            exit 0
        }

        if ($existingDashboard) {
            Stop-Process -Id $existingDashboard.Id -Force -ErrorAction SilentlyContinue
            Write-Output "Stopped incomplete recorded dashboard process PID $($existingDashboard.Id)."
        }
        if ($existingIngestion) {
            Stop-Process -Id $existingIngestion.Id -Force -ErrorAction SilentlyContinue
            Write-Output "Stopped incomplete recorded ingestion process PID $($existingIngestion.Id)."
        }
        Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue
    }
}

Assert-PortAvailable 5173 "Dashboard frontend"
$reuseExistingIngestion = Test-IngestionReady
if (-not $reuseExistingIngestion) {
    Assert-PortAvailable 8766 "Ingestion service"
} else {
    if (Test-IngestionIsCurrentVersion) {
        Write-Output "Reusing healthy ingestion service on http://127.0.0.1:8766/."
    } else {
        Write-Warning "Reusing a verified legacy ingestion service on port 8766 because Windows did not allow it to be stopped. The dashboard frontend will still start with the latest code."
    }
}

$servicePython = $null
if (-not $reuseExistingIngestion) {
    $servicePython = Get-ServicePython
    & $servicePython -c "import fastapi, psutil, uvicorn" 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Ingestion Python is missing dependencies from services\ingestion\requirements.txt."
    }
}

$node = (Get-Command node -ErrorAction Stop).Source
$viteEntry = Join-Path $workbenchRoot "node_modules\vite\bin\vite.js"
if (-not (Test-Path -LiteralPath $viteEntry -PathType Leaf)) {
    throw "Dashboard frontend dependencies are missing. Run npm install in the frontend directory."
}

$ingestionProcess = $null
$dashboardProcess = $null
try {
    if (-not $reuseExistingIngestion) {
        $ingestionProcess = Start-Process -FilePath $servicePython -ArgumentList "run_server.py" -WorkingDirectory $serviceRoot -WindowStyle Hidden -RedirectStandardOutput $ingestionStdout -RedirectStandardError $ingestionStderr -PassThru
    }
    Write-Output "Starting dashboard frontend on http://127.0.0.1:5173/..."
    $dashboardProcess = Start-Process -FilePath $node -ArgumentList $viteEntry, "--host", "127.0.0.1", "--port", "5173", "--strictPort" -WorkingDirectory $workbenchRoot -WindowStyle Hidden -RedirectStandardOutput $dashboardStdout -RedirectStandardError $dashboardStderr -PassThru
    Save-ProcessState $dashboardProcess $ingestionProcess

    $deadline = (Get-Date).AddSeconds(20)
    do {
        try {
            $ingestionReady = Test-IngestionReady
            $dashboardReady = Test-HttpReady $dashboardUrl
        } catch {
            $ingestionReady = $false
            $dashboardReady = $false
        }
        if (-not ($ingestionReady -and $dashboardReady)) { Start-Sleep -Milliseconds 400 }
    } while ((Get-Date) -lt $deadline -and -not ($ingestionReady -and $dashboardReady))

    if (-not ($ingestionReady -and $dashboardReady)) {
        $dashboardState = if ($dashboardReady) { "ready" } elseif ($dashboardProcess.HasExited) { "exited" } else { "not-ready" }
        $ingestionState = if ($ingestionReady) { "ready" } elseif ($ingestionProcess -and $ingestionProcess.HasExited) { "exited" } elseif ($reuseExistingIngestion) { "unavailable" } else { "not-ready" }
        Write-Host "Dashboard state: $dashboardState" -ForegroundColor Yellow
        Write-Host "Ingestion state: $ingestionState" -ForegroundColor Yellow
        if (Test-Path -LiteralPath $dashboardStderr) {
            $lines = Get-Content -LiteralPath $dashboardStderr -Tail 30 -ErrorAction SilentlyContinue
            if ($lines) {
                Write-Host "`n--- Dashboard stderr ---" -ForegroundColor DarkYellow
                $lines | ForEach-Object { Write-Host $_ }
            }
        }
        if (Test-Path -LiteralPath $ingestionStderr) {
            $lines = Get-Content -LiteralPath $ingestionStderr -Tail 30 -ErrorAction SilentlyContinue
            if ($lines) {
                Write-Host "`n--- Ingestion stderr ---" -ForegroundColor DarkYellow
                $lines | ForEach-Object { Write-Host $_ }
            }
        }
        throw "Dashboard or ingestion service did not become ready within 20 seconds. See logs above."
    }
    Write-Output "Dashboard started: $dashboardUrl"
    Open-DashboardPage
} catch {
    if ($dashboardProcess -and -not $dashboardProcess.HasExited) { Stop-Process -Id $dashboardProcess.Id -Force }
    if ($ingestionProcess -and -not $ingestionProcess.HasExited) { Stop-Process -Id $ingestionProcess.Id -Force }
    Remove-Item -LiteralPath $stateFile -Force -ErrorAction SilentlyContinue
    throw
}
