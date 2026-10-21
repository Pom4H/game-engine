param([int]$Port=3007,[int]$RealtimePort=3009,[string]$BindHost='0.0.0.0',[string]$GameRoot=(Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'thegame'))
$ErrorActionPreference='Stop'
$engineRoot=Split-Path -Parent $PSScriptRoot
$gamePath=(Resolve-Path -LiteralPath $GameRoot).Path
if(!(Test-Path -LiteralPath (Join-Path $gamePath 'src\game\office-world.ts'))){throw 'The canonical TheGame Office adapter is missing'}
$healthUrl="http://127.0.0.1:$Port/api/health"
try{$health=Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2}catch{$health=$null}
if($health){if($health.revision -ne 13 -or $null -eq $health.seed){throw "Port $Port belongs to another application"};Write-Output "TheGame already running at http://127.0.0.1:$Port";exit}
$bun=(Get-Command bun -ErrorAction SilentlyContinue).Source
if(!$bun){$bun=Join-Path $env:USERPROFILE '.bun\bin\bun.exe'}
if(!(Test-Path -LiteralPath $bun)){throw 'Bun is required'}
$logPath=Join-Path $engineRoot 'artifacts\thegame-integration'
New-Item -ItemType Directory -Path $logPath -Force | Out-Null
$tokenPath=Join-Path $logPath 'editor.token'
if(!(Test-Path -LiteralPath $tokenPath)){[IO.File]::WriteAllText($tokenPath,([Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')),[Text.UTF8Encoding]::new($false))}
$names=@('PORT','HOST','WEBTRANSPORT_PORT','THEGAME_CPU_BUDGET','ACTIVE_RESIDENT_LIMIT','MAX_PLAYERS','THEGAME_EDITOR_TOKEN_FILE','Path')
$previous=@{}
foreach($name in $names){$previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
try{
 if(!(Get-Command openssl -ErrorAction SilentlyContinue)){
  $opensslPath='C:\Program Files\Git\usr\bin\openssl.exe'
  if(!(Test-Path -LiteralPath $opensslPath)){throw 'OpenSSL is required to create the local WebTransport certificate'}
  [Environment]::SetEnvironmentVariable('Path',"$(Split-Path -Parent $opensslPath);$($previous['Path'])",'Process')
 }
 [Environment]::SetEnvironmentVariable('PORT',"$Port",'Process')
 [Environment]::SetEnvironmentVariable('HOST',$BindHost,'Process')
 [Environment]::SetEnvironmentVariable('WEBTRANSPORT_PORT',"$RealtimePort",'Process')
 [Environment]::SetEnvironmentVariable('THEGAME_CPU_BUDGET','2','Process')
 [Environment]::SetEnvironmentVariable('ACTIVE_RESIDENT_LIMIT','48','Process')
 [Environment]::SetEnvironmentVariable('MAX_PLAYERS','16','Process')
 [Environment]::SetEnvironmentVariable('THEGAME_EDITOR_TOKEN_FILE',$tokenPath,'Process')
 $process=Start-Process -FilePath $bun -ArgumentList @('src/server/index.ts') -WorkingDirectory $gamePath -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logPath 'canonical-server.log') -RedirectStandardError (Join-Path $logPath 'canonical-server.err.log')
 Set-Content -LiteralPath (Join-Path $logPath 'canonical-server.pid') -Value $process.Id
}finally{foreach($name in $names){[Environment]::SetEnvironmentVariable($name,$previous[$name],'Process')}}
for($attempt=0;$attempt -lt 30;$attempt++){
 try{$health=Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2}catch{$health=$null}
 if($health -and $health.revision -eq 13){Write-Output "TheGame http://127.0.0.1:$Port · canonical world revision 13 · PID $($process.Id)";exit}
 if($process.HasExited){throw "TheGame exited. Inspect $logPath\canonical-server.err.log"}
 Start-Sleep -Milliseconds 500
}
throw "TheGame startup timed out. Inspect $logPath\canonical-server.err.log"
