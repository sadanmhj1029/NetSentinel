<#
  NetSentinel helper for Windows (Docker Desktop).

  Double-click NetSentinel.bat in the project folder for a menu, or run:
    .\NetSentinel.bat start     start everything and open the browser
    .\NetSentinel.bat stop      stop everything (your data is kept)
    .\NetSentinel.bat update    back up, get the latest code, rebuild, restart
    .\NetSentinel.bat status    is everything healthy?
    .\NetSentinel.bat logs      watch the backend log (Ctrl+C to stop watching)
    .\NetSentinel.bat backup    save a copy of the database to the backups folder
    .\NetSentinel.bat restore   put a backup back (asks before overwriting)
    .\NetSentinel.bat open      open NetSentinel in the browser

  Written for Windows PowerShell 5.1, which comes with Windows.
#>
param([string]$Command = "", [string]$File = "")

# "Continue", not "Stop": Windows PowerShell 5.1 treats progress text that docker
# and git print on stderr as errors under "Stop". Exit codes are checked instead.
$ErrorActionPreference = "Continue"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

$AppUrl = "http://localhost:5173"
$ReadyUrl = "http://localhost:8000/api/health/ready"
$BackupDir = Join-Path $Root "backups"
$KeepBackups = 10

function Say($text, $color = "Gray") { Write-Host $text -ForegroundColor $color }
function Ok($text) { Say "  [ok] $text" "Green" }
function Warn($text) { Say "  [!] $text" "Yellow" }
function Fail($text) { Say "  [x] $text" "Red" }

function Get-EnvValue($name, $default) {
  $envFile = Join-Path $Root ".env"
  if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
      if ($line -match "^\s*$name\s*=\s*([^#\s]+)") { return $Matches[1] }
    }
  }
  return $default
}

function Assert-Docker {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail "Docker isn't installed. Install Docker Desktop from https://www.docker.com/products/docker-desktop/ and try again."
    exit 1
  }
  docker info *> $null
  if ($LASTEXITCODE -ne 0) {
    Fail "Docker Desktop isn't running. Open Docker Desktop, wait until it says 'Engine running', then try again."
    exit 1
  }
}

function Ensure-EnvFile {
  if (-not (Test-Path (Join-Path $Root ".env"))) {
    Copy-Item (Join-Path $Root ".env.example") (Join-Path $Root ".env")
    Ok "Created .env from .env.example (edit it to change passwords and settings)"
  }
}

function Wait-Ready([int]$Seconds = 180) {
  Say "  Waiting for NetSentinel to be ready (first start can take a few minutes)..."
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri $ReadyUrl -UseBasicParsing -TimeoutSec 3
      if ($r.StatusCode -eq 200) { Ok "Backend is ready"; return $true }
    } catch { }
    Start-Sleep -Seconds 3
    Write-Host "." -NoNewline
  }
  Write-Host ""
  Warn "Still not ready after $Seconds seconds. Run 'NetSentinel.bat logs' to see what's happening."
  return $false
}

function Invoke-Compose {
  # Runs docker compose with the given arguments and stops the script if it fails.
  docker compose @args
  if ($LASTEXITCODE -ne 0) { Fail "docker compose $($args -join ' ') failed (see the messages above)."; exit 1 }
}

function Do-Start {
  Assert-Docker
  Ensure-EnvFile
  Say "Starting NetSentinel..." "Cyan"
  Invoke-Compose up -d --build
  if (Wait-Ready) {
    Ok "Opening $AppUrl  (sign in with admin / admin123 unless you changed it)"
    Start-Process $AppUrl
  }
}

function Do-Stop {
  Assert-Docker
  Say "Stopping NetSentinel (your data is kept)..." "Cyan"
  Invoke-Compose down
  Ok "Stopped"
}

function Do-Backup {
  Assert-Docker
  $user = Get-EnvValue "POSTGRES_USER" "netsentinel"
  $db = Get-EnvValue "POSTGRES_DB" "netsentinel"
  $running = docker compose ps --status running --services 2>$null
  if (-not ($running -contains "db")) {
    Say "  Starting the database to take the backup..."
    Invoke-Compose up -d db
    Start-Sleep -Seconds 5
  }
  New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
  $name = "netsentinel-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".dump"
  Say "Backing up the database..." "Cyan"
  # Dump inside the container, then copy the file out. (Piping binary data
  # through PowerShell would corrupt it.)
  Invoke-Compose exec -T db pg_dump -U $user -d $db -Fc -f /tmp/netsentinel.dump
  Invoke-Compose cp "db:/tmp/netsentinel.dump" (Join-Path $BackupDir $name)
  docker compose exec -T db rm -f /tmp/netsentinel.dump *> $null
  $size = [math]::Round((Get-Item (Join-Path $BackupDir $name)).Length / 1KB)
  Ok "Saved backups\$name ($size KB)"
  # Keep only the newest few.
  Get-ChildItem $BackupDir -Filter "netsentinel-*.dump" | Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $KeepBackups | Remove-Item -Force
}

function Do-Restore {
  Assert-Docker
  $user = Get-EnvValue "POSTGRES_USER" "netsentinel"
  $db = Get-EnvValue "POSTGRES_DB" "netsentinel"
  if ($File) {
    $target = Get-Item $File
  } else {
    $target = Get-ChildItem $BackupDir -Filter "netsentinel-*.dump" -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
  }
  if (-not $target) { Fail "No backup found in the backups folder. Run 'NetSentinel.bat backup' first."; exit 1 }
  Warn "This replaces everything in the database with $($target.Name) from $($target.LastWriteTime)."
  $answer = Read-Host "  Type YES to continue"
  if ($answer -ne "YES") { Say "  Cancelled. Nothing changed."; return }
  Invoke-Compose up -d db
  Start-Sleep -Seconds 3
  Invoke-Compose stop backend
  Invoke-Compose cp $target.FullName "db:/tmp/restore.dump"
  docker compose exec -T db pg_restore --clean --if-exists --no-owner -U $user -d $db /tmp/restore.dump
  if ($LASTEXITCODE -gt 1) { Fail "Restore reported errors (see above)." } else { Ok "Database restored" }
  docker compose exec -T db rm -f /tmp/restore.dump *> $null
  Invoke-Compose up -d
  Wait-Ready | Out-Null
}

function Do-Update {
  Assert-Docker
  Ensure-EnvFile
  if (-not (Get-Command git -ErrorAction SilentlyContinue) -or -not (Test-Path (Join-Path $Root ".git"))) {
    Fail "This folder isn't a git clone, so it can't pull updates. Download the new code instead, then run 'NetSentinel.bat start'."
    exit 1
  }
  Say "Updating NetSentinel..." "Cyan"
  $running = docker compose ps --status running --services 2>$null
  if ($running -contains "db") {
    Say "  Taking a safety backup first..."
    Do-Backup
  }
  $dirty = git status --porcelain --untracked-files=no
  if ($dirty) {
    Fail "You have local changes to these files, so the update was not applied:"
    $dirty | ForEach-Object { Say "      $_" "Yellow" }
    Say "  Either undo them with 'git checkout -- .' or commit them, then run update again."
    exit 1
  }
  git pull --ff-only
  if ($LASTEXITCODE -ne 0) { Fail "git pull failed (see above). Nothing was rebuilt."; exit 1 }
  Invoke-Compose down
  Invoke-Compose build --pull
  Invoke-Compose up -d
  if (Wait-Ready) {
    Ok "Updated. Opening $AppUrl"
    Start-Process $AppUrl
  }
}

function Do-Status {
  Assert-Docker
  Say "Containers:" "Cyan"
  docker compose ps
  Say ""
  Say "Readiness:" "Cyan"
  try {
    $r = Invoke-WebRequest -Uri $ReadyUrl -UseBasicParsing -TimeoutSec 4
    $j = $r.Content | ConvertFrom-Json
    Ok "Ready. Database: $($j.checks.database.latency_ms) ms. Monitoring: $($j.checks.scheduler.detail)."
  } catch {
    Fail "The backend isn't answering at $ReadyUrl. Try 'NetSentinel.bat start', or 'NetSentinel.bat logs' to see why."
  }
}

function Do-Logs {
  Assert-Docker
  Say "Showing the backend log. Press Ctrl+C to stop watching (NetSentinel keeps running)." "Cyan"
  docker compose logs -f --tail 100 backend
}

function Show-Menu {
  Say ""
  Say "  NetSentinel" "Cyan"
  Say "  ----------"
  Say "  1  Start (and open in browser)"
  Say "  2  Stop"
  Say "  3  Update to the latest version"
  Say "  4  Status"
  Say "  5  Watch logs"
  Say "  6  Back up the database"
  Say "  7  Restore the latest backup"
  Say "  8  Open in browser"
  Say "  Q  Quit"
  $choice = Read-Host "  Choose"
  switch ($choice.ToUpper()) {
    "1" { Do-Start }
    "2" { Do-Stop }
    "3" { Do-Update }
    "4" { Do-Status }
    "5" { Do-Logs }
    "6" { Do-Backup }
    "7" { Do-Restore }
    "8" { Start-Process $AppUrl }
    default { return }
  }
}

switch ($Command.ToLower()) {
  "start" { Do-Start }
  "stop" { Do-Stop }
  "update" { Do-Update }
  "status" { Do-Status }
  "logs" { Do-Logs }
  "backup" { Do-Backup }
  "restore" { Do-Restore }
  "open" { Start-Process $AppUrl }
  "" { Show-Menu }
  default { Fail "Unknown command '$Command'. Use start, stop, update, status, logs, backup, restore or open." }
}
