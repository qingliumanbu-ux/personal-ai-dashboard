@echo off
setlocal
chcp 65001 >nul

set "ROOT=%~dp0"
set "STOP_SCRIPT=%ROOT%scripts\stop-dashboard.ps1"
set "START_SCRIPT=%ROOT%scripts\start-dashboard.ps1"
set "LOG_ROOT=%LOCALAPPDATA%\personal-ai-dashboard\logs"

if not exist "%LOG_ROOT%" mkdir "%LOG_ROOT%" >nul 2>&1
del /q "%LOG_ROOT%\dashboard.stdout.log" "%LOG_ROOT%\dashboard.stderr.log" "%LOG_ROOT%\ingestion.stdout.log" "%LOG_ROOT%\ingestion.stderr.log" >nul 2>&1

if not exist "%STOP_SCRIPT%" (
  echo [Personal AI Dashboard] Stop script not found:
  echo %STOP_SCRIPT%
  pause
  exit /b 1
)

if not exist "%START_SCRIPT%" (
  echo [Personal AI Dashboard] Startup script not found:
  echo %START_SCRIPT%
  pause
  exit /b 1
)

rem Always stop only this project's recorded/orphan processes before starting.
rem stop-dashboard.ps1 refuses to kill an unrelated process that owns the port.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%STOP_SCRIPT%"
if errorlevel 1 goto :failed

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%START_SCRIPT%"
if errorlevel 1 goto :failed

exit /b 0

:failed
echo.
echo [Personal AI Dashboard] Startup failed. Recent logs:
echo.
powershell.exe -NoProfile -Command "if (Test-Path -LiteralPath '%LOG_ROOT%\dashboard.stderr.log') { Write-Host '--- Dashboard stderr ---'; Get-Content -LiteralPath '%LOG_ROOT%\dashboard.stderr.log' -Tail 50 }; if (Test-Path -LiteralPath '%LOG_ROOT%\ingestion.stderr.log') { Write-Host ''; Write-Host '--- Ingestion stderr ---'; Get-Content -LiteralPath '%LOG_ROOT%\ingestion.stderr.log' -Tail 50 }"
echo.
echo Copy or screenshot the error above if the dashboard still cannot open.
pause
exit /b 1

