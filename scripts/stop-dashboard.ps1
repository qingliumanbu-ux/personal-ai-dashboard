$ErrorActionPreference = "Stop"

$dashboardRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$environmentFile = Join-Path $dashboardRoot "Workbench\.env"
$stateRoot = Join-Path $env:LOCALAPPDATA "personal-ai-dashboard"
$stateFile = Join-Path $stateRoot "processes.json"

function Get-DashboardEnvironmentValue([string]$Path, [string]$Name) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    foreach ($line in Get-Content -LiteralPath $Path -Encoding UTF8) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
        $parts = $trimmed.Split("=", 2)
        if ($parts.Count -ne 2 -or $parts[0] -ne $Name) { continue }
        return $parts[1].Trim().Trim('"').Trim("'")
    }
    return $null
}

function Test-KnownIngestionHealth {
    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:8766/api/health" -TimeoutSec 2
        if ($health.service -eq "personal-ai-dashboard-ingestion") { return $true }
        return (
            $health.status -eq "ok" -and
            $null -ne $health.capabilities.vad -and
            $null -ne $health.capabilities.web_page -and
            $null -ne $health.capabilities.douyin
        )
    } catch {
        return $false
    }
}

function Stop-KnownDashboardListener(
    [int]$Port,
    [string[]]$ExpectedCommandFragments,
    [string[]]$ExpectedExecutablePaths = @(),
    [bool]$TrustCurrentListener = $false,
    [bool]$AllowVerifiedAccessDeniedReuse = $false
) {
    $connections = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
    foreach ($connection in $connections) {
        $ownerPid = [int]$connection.OwningProcess
        if ($ownerPid -le 0) { continue }
        $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $ownerPid" -ErrorAction SilentlyContinue
        if (-not $processInfo) { continue }
        $commandLine = [string]$processInfo.CommandLine
        $isKnown = $TrustCurrentListener
        foreach ($fragment in $ExpectedCommandFragments) {
            if ($commandLine -like "*$fragment*") {
                $isKnown = $true
                break
            }
        }
        if (-not $isKnown -and $processInfo.ExecutablePath) {
            foreach ($expectedPath in $ExpectedExecutablePaths) {
                if (-not $expectedPath) { continue }
                try {
                    $actualExecutable = [IO.Path]::GetFullPath([string]$processInfo.ExecutablePath)
                    $expectedExecutable = [IO.Path]::GetFullPath([string]$expectedPath)
                    if ([string]::Equals($actualExecutable, $expectedExecutable, [StringComparison]::OrdinalIgnoreCase)) {
                        $isKnown = $true
                        break
                    }
                } catch {
                    # Keep fail-closed behavior if either path cannot be normalized.
                }
            }
        }
        if (-not $isKnown) {
            Write-Warning "Port $Port is used by PID $ownerPid ($($processInfo.Name)); it does not look like this dashboard, so it was not stopped."
            continue
        }
        try {
            Stop-Process -Id $ownerPid -Force -ErrorAction Stop
        } catch {
            if ($AllowVerifiedAccessDeniedReuse -and $TrustCurrentListener -and $_.Exception.Message -match "Access is denied|拒绝访问") {
                Write-Warning "Verified project process PID $ownerPid on port $Port is running with higher Windows privileges and cannot be stopped by this launcher. It will be reused for this launch."
                continue
            }
            throw "Verified project process PID $ownerPid on port $Port could not be stopped: $($_.Exception.Message)"
        }

        $deadline = (Get-Date).AddSeconds(5)
        do {
            Start-Sleep -Milliseconds 150
            $stillListening = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
                Where-Object { [int]$_.OwningProcess -eq $ownerPid } |
                Select-Object -First 1
        } while ($stillListening -and (Get-Date) -lt $deadline)

        if ($stillListening) {
            throw "Verified project process PID $ownerPid was sent a stop request, but port $Port is still listening after 5 seconds."
        }
        Write-Output "Stopped verified project process PID $ownerPid on port $Port."
    }
}

if (Test-Path -LiteralPath $stateFile -PathType Leaf) {
    $state = Get-Content -Raw -LiteralPath $stateFile -Encoding UTF8 | ConvertFrom-Json
} else {
    $state = $null
    Write-Output "Dashboard has no recorded running processes. Checking known ports for orphan processes..."
}

function Stop-RecordedProcess($Record) {
    if (-not $Record -or -not $Record.id) { return }
    $process = Get-Process -Id $Record.id -ErrorAction SilentlyContinue
    if (-not $process) { return }
    $actualStart = $process.StartTime.ToUniversalTime()
    $recordedStart = ([DateTime]$Record.startedAt).ToUniversalTime()
    if ($process.ProcessName -ne $Record.name -or $actualStart -ne $recordedStart) {
        throw "Process state is stale; no unrelated process was stopped."
    }
    Stop-Process -Id $process.Id -Force -ErrorAction Stop
    try {
        Wait-Process -Id $process.Id -Timeout 5 -ErrorAction Stop
    } catch {
        if (Get-Process -Id $process.Id -ErrorAction SilentlyContinue) {
            throw "Recorded project process PID $($process.Id) did not exit within 5 seconds."
        }
    }
}

if ($state) {
    Stop-RecordedProcess $state.dashboard
    Stop-RecordedProcess $state.ingestion
    Remove-Item -LiteralPath $stateFile -Force
}

Stop-KnownDashboardListener 5173 @("vite.js", "personal-ai-dashboard\\Workbench")
$configuredIngestionPython = Get-DashboardEnvironmentValue $environmentFile "PERSONAL_DASHBOARD_INGESTION_PYTHON"
$localIngestionPython = Join-Path $dashboardRoot "services\ingestion\.venv\Scripts\python.exe"
$knownIngestionHealth = Test-KnownIngestionHealth
$trustedIngestionExecutables = @($configuredIngestionPython, $localIngestionPython)
Stop-KnownDashboardListener 8766 @("run_server.py", "personal-ai-dashboard\\services\\ingestion") $trustedIngestionExecutables $knownIngestionHealth $true
Write-Output "Dashboard stop pass completed. Only verified project processes were stopped."
