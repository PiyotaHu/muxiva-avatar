param([int]$Port=4174)
$ErrorActionPreference='Stop'
$avatarRoot=$PSScriptRoot
$avatarNode=(Get-Command node -ErrorAction SilentlyContinue).Source
if(-not $avatarNode){$avatarNode=Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'}
if(-not(Test-Path -LiteralPath $avatarNode)){throw 'Node.js 24+ is required.'}
$avatarRuntime=Join-Path $avatarRoot '.runtime'
New-Item -ItemType Directory -Path $avatarRuntime -Force | Out-Null
$env:MUXIVA_AVATAR_PORT=[string]$Port
$avatarUrl="http://127.0.0.1:$Port"
try{$avatarHealth=Invoke-RestMethod "$avatarUrl/api/status" -TimeoutSec 2}catch{$avatarHealth=$null}
if($avatarHealth.pipeline -eq 'muxiva-graph'){Write-Output "Already running: $avatarUrl";exit 0}
$avatarProcess=Start-Process -FilePath $avatarNode -ArgumentList @('server.mjs') -WorkingDirectory $avatarRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $avatarRuntime 'server.stdout.log') -RedirectStandardError (Join-Path $avatarRuntime 'server.stderr.log')
Write-Output "Muxiva Avatar started. PID=$($avatarProcess.Id) URL=$avatarUrl"
