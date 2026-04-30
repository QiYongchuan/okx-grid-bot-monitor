$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$monitorPath = Join-Path $scriptDir 'monitor.js'
$nodeCmd = Get-Command node -ErrorAction Stop
$okxCmd = Get-Command okx -ErrorAction Stop

$env:OKX_BIN = $okxCmd.Source
Set-Location -LiteralPath $scriptDir

& $nodeCmd.Source $monitorPath
exit $LASTEXITCODE
