param([string]$OfficeRoot=(Join-Path $env:USERPROFILE 'voice-agent'))
$ErrorActionPreference='Stop'
$taskOffice=(Resolve-Path -LiteralPath $OfficeRoot).Path
$taskEditor=Join-Path $taskOffice 'scripts/start-office-editor.ps1'
if (!(Test-Path -LiteralPath $taskEditor)) { throw 'The existing Office editor launcher is missing' }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start-game-office.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Canonical TheGame startup failed' }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $taskEditor
if ($LASTEXITCODE -ne 0) { throw 'The Office editor startup failed' }
