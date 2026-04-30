param(
    [switch]$Remove
)

$taskName = 'OKX-Grid-Monitor-Demo'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runnerPath = Join-Path $scriptDir 'run-monitor.vbs'

if (-not (Test-Path -LiteralPath $runnerPath)) {
    Write-Error "Runner script not found: $runnerPath"
    exit 1
}

$runnerArg = $runnerPath.Replace('"', '""')
$taskCommand = "wscript.exe `"$runnerArg`""

if ($Remove) {
    schtasks.exe /Query /TN $taskName *> $null
    if ($LASTEXITCODE -eq 0) {
        schtasks.exe /Delete /TN $taskName /F | Out-Null
        Write-Host ""
        Write-Host "Removed task: $taskName"
        Write-Host ""
    } else {
        Write-Host ""
        Write-Host "Task not found: $taskName"
        Write-Host ""
    }
    exit 0
}

schtasks.exe /Query /TN $taskName *> $null
if ($LASTEXITCODE -eq 0) {
    schtasks.exe /Delete /TN $taskName /F | Out-Null
}

$createArgs = @(
    '/Create'
    '/TN', $taskName
    '/SC', 'MINUTE'
    '/MO', '5'
    '/TR', $taskCommand
    '/F'
)

$createOutput = & schtasks.exe @createArgs 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error ($createOutput | Out-String)
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Registered task: $taskName"
Write-Host "Runs every 5 minutes via: $runnerPath"
Write-Host "Notifications/logs are written by monitor.js"
Write-Host ""
Write-Host "Commands:"
Write-Host ("Status : Get-ScheduledTask -TaskName '{0}'" -f $taskName)
Write-Host ("Info   : Get-ScheduledTaskInfo -TaskName '{0}'" -f $taskName)
Write-Host ("Run now: Start-ScheduledTask -TaskName '{0}'" -f $taskName)
Write-Host "Remove : .\okx-demo\scripts\setup-scheduler.ps1 -Remove"
Write-Host ""
