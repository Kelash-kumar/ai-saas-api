param(
  [ValidateSet('setup', 'start', 'stop')][string]$Action = 'setup',
  [string]$PgBinPath = 'C:\Program Files\PostgreSQL\17\bin'
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$clusterRoot = Join-Path $projectRoot '.local\postgres'
$clusterData = Join-Path $clusterRoot 'data'
$markerPath = Join-Path $clusterRoot '.foundation-cluster'
$passwordPath = Join-Path $clusterRoot 'password'
$envPath = Join-Path $projectRoot '.env'
$fixedSettings = [ordered]@{ DATABASE_HOST='127.0.0.1'; DATABASE_PORT='55432'; DATABASE_NAME='auth_foundation'; DATABASE_USER='foundation'; DATABASE_SSL='false' }
if ($Action -ne 'stop') {
  $existingEnvText = if (Test-Path -LiteralPath $envPath) { Get-Content -LiteralPath $envPath -Raw } else { '' }
  foreach ($setting in $fixedSettings.GetEnumerator()) {
    $configured = [regex]::Match($existingEnvText, "(?m)^$($setting.Key)=([^\r\n]+)")
    $inherited = [Environment]::GetEnvironmentVariable($setting.Key)
    if (($configured.Success -and $configured.Groups[1].Value -ne $setting.Value) -or ($inherited -and $inherited -ne $setting.Value)) {
      throw "Local cluster requires $($setting.Key)=$($setting.Value); use the regular database commands for other servers."
    }
  }
}
$controlPath = Join-Path $PgBinPath 'pg_ctl.exe'
if (!(Test-Path -LiteralPath $controlPath)) { throw 'PostgreSQL binaries not found; supply -PgBinPath.' }
if ((Test-Path -LiteralPath $clusterData) -and !(Test-Path -LiteralPath $markerPath)) {
  throw 'Refusing to manage an unmarked PostgreSQL data directory.'
}
if ($Action -eq 'setup' -and !(Test-Path -LiteralPath $clusterData)) {
  New-Item -ItemType Directory -Path $clusterRoot -Force | Out-Null
  if (!(Test-Path -LiteralPath $envPath)) { Copy-Item -LiteralPath (Join-Path $projectRoot '.env.example') -Destination $envPath }
  $envText = Get-Content -LiteralPath $envPath -Raw
  $passwordMatch = [regex]::Match($envText, '(?m)^DATABASE_PASSWORD=([^\r\n]+)')
  $clusterPassword = if ($passwordMatch.Success -and $passwordMatch.Groups[1].Value -ne 'change-this-local-password') { $passwordMatch.Groups[1].Value } else {
    $randomBytes = New-Object byte[] 32
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($randomBytes) } finally { $generator.Dispose() }
    [Convert]::ToBase64String($randomBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  }
  if ($clusterPassword.Length -lt 12) { throw 'DATABASE_PASSWORD must contain at least 12 characters.' }
  if ($passwordMatch.Success -and $passwordMatch.Groups[1].Value -eq 'change-this-local-password') {
    $envText = [regex]::Replace($envText, '(?m)^DATABASE_PASSWORD=[^\r\n]*', "DATABASE_PASSWORD=$clusterPassword")
    [IO.File]::WriteAllText($envPath, $envText, [Text.UTF8Encoding]::new($false))
  }
  [IO.File]::WriteAllText($passwordPath, $clusterPassword, [Text.UTF8Encoding]::new($false))
  & (Join-Path $PgBinPath 'initdb.exe') -D $clusterData -U foundation -A scram-sha-256 --pwfile $passwordPath --encoding=UTF8 --locale=C | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL initialization failed.' }
  [IO.File]::WriteAllText($markerPath, 'Project-owned local cluster')
  Add-Content -LiteralPath (Join-Path $clusterData 'postgresql.conf') -Value "`nport = 55432`nlisten_addresses = '127.0.0.1'`nmax_connections = 30"
  $settings = [ordered]@{ DATABASE_HOST='127.0.0.1'; DATABASE_PORT='55432'; DATABASE_NAME='auth_foundation'; DATABASE_USER='foundation'; DATABASE_PASSWORD=$clusterPassword; DATABASE_SSL='false' }
  foreach ($setting in $settings.GetEnumerator()) {
    if ($envText -notmatch "(?m)^$($setting.Key)=") { Add-Content -LiteralPath $envPath -Value "$($setting.Key)=$($setting.Value)" }
  }
}
if (!(Test-Path -LiteralPath $markerPath)) { throw 'Run setup first.' }
& $controlPath status -D $clusterData *> $null
$isRunning = $LASTEXITCODE -eq 0
if ($Action -eq 'stop') {
  if ($isRunning) { & $controlPath stop -D $clusterData -m fast -w | Out-Null }
  Write-Output 'Project PostgreSQL cluster stopped.'
  exit 0
}
if (!$isRunning) {
  $logPath = Join-Path $clusterRoot 'postgres.log'
  $controlArguments = @('start', '-D', "`"$clusterData`"", '-l', "`"$logPath`"", '-w', '-t', '20')
  $process = Start-Process -FilePath $controlPath -ArgumentList $controlArguments -WindowStyle Hidden -PassThru
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw 'PostgreSQL start failed; see .local/postgres/postgres.log.' }
}
Write-Output 'Project PostgreSQL cluster ready on 127.0.0.1:55432.'
if ($Action -eq 'setup') {
  Push-Location $projectRoot
  try { npm run db:create; if ($LASTEXITCODE -ne 0) { throw 'Development database creation failed.' } }
  finally { Pop-Location }
}
