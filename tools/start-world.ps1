param([int]$Port = 4317, [switch]$NoOfficeBridge)
$ErrorActionPreference = 'Stop'
$taskWorldRoot = Split-Path -Parent $PSScriptRoot
$taskRuntime = Get-Command bun -ErrorAction SilentlyContinue
$taskBunPath = if ($taskRuntime) { $taskRuntime.Source } else { Join-Path $env:USERPROFILE '.bun\bin\bun.exe' }
if (!(Test-Path -LiteralPath $taskBunPath)) { throw 'Bun is required. Install it through its official installer.' }
$taskOutput = Join-Path $taskWorldRoot 'artifacts\thegame-integration'
New-Item -ItemType Directory -Path $taskOutput -Force | Out-Null
$taskListener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
if (!$taskListener) {
    $taskPreviousPort = $env:PORT
    try {
        $env:PORT = [string]$Port
        $taskProcess = Start-Process -FilePath $taskBunPath -ArgumentList 'apps/thegame/server.ts' -WorkingDirectory $taskWorldRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $taskOutput 'server.stdout.log') -RedirectStandardError (Join-Path $taskOutput 'server.stderr.log')
        Set-Content -LiteralPath (Join-Path $taskOutput 'server.pid') -Value $taskProcess.Id
    } finally { $env:PORT = $taskPreviousPort }
}
$taskReady = $false
for ($taskAttempt=0; $taskAttempt -lt 30; $taskAttempt++) {
    try { $taskHealth = Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 1; if ($taskHealth.revision -eq 'thegame-lite/5-office') { $taskReady=$true; break } } catch {}
    Start-Sleep -Milliseconds 200
}
if (!$taskReady) { throw "The Game did not start. See $taskOutput\server.stderr.log" }
if (!$NoOfficeBridge) {
    $taskOfficeRoot = Join-Path (Split-Path -Parent (Split-Path -Parent $taskWorldRoot)) 'voice-agent'
    $taskKey = Join-Path $taskWorldRoot 'apps\thegame\data\editor.key'
    if ((Test-Path -LiteralPath (Join-Path $taskOfficeRoot 'compose.office-dev.yaml')) -and (Test-Path -LiteralPath $taskKey)) {
        $taskPreviousUrl = $env:THEGAME_INTEGRATION_URL
        $taskPreviousToken = $env:THEGAME_EDITOR_TOKEN
        try {
            $env:THEGAME_INTEGRATION_URL = "http://host.docker.internal:$Port"
            $env:THEGAME_EDITOR_TOKEN = (Get-Content -LiteralPath $taskKey -Raw).Trim()
            Push-Location $taskOfficeRoot
            try { docker compose -f compose.yaml -f compose.office-dev.yaml up -d --no-build pipecat; if ($LASTEXITCODE -ne 0) { throw 'Could not connect the Office editor service.' } } finally { Pop-Location }
        } finally { $env:THEGAME_INTEGRATION_URL=$taskPreviousUrl; $env:THEGAME_EDITOR_TOKEN=$taskPreviousToken }
    }
}
Write-Output "The Game: http://127.0.0.1:$Port"
Write-Output 'The Office: http://127.0.0.1:8765'
