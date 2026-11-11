# ---------------------------------------------------------------------------
#  Seven Years Care - attendance sync (eTimeTrackLite -> care.sevenyears.in)
#  Runs every 2 minutes on the office PC. Reads only NEW punches from the
#  eTimeTrackLite SQL Server database and sends them to the app.
#  It never changes anything in eTimeTrackLite.
#  Version 2: when the website asks for older punches (Settings -> Attendance ->
#  Pull older punches), it also sends every punch from that day onwards.
#
#  Check:     powershell -ExecutionPolicy Bypass -File C:\SevenYearsSync\SevenYearsSync.ps1 -Check
#  Install:   powershell -ExecutionPolicy Bypass -File C:\SevenYearsSync\SevenYearsSync.ps1 -Install
#  Remove:    powershell -ExecutionPolicy Bypass -File C:\SevenYearsSync\SevenYearsSync.ps1 -Uninstall
# ---------------------------------------------------------------------------
param([switch]$Check, [switch]$Install, [switch]$Uninstall)

$ServerName  = '__SERVER__'
$Database    = '__DATABASE__'
$SqlUser     = '__SQLUSER__'
$SqlPassword = '__SQLPASSWORD__'
$Url         = '__URL__'
$Key         = '__KEY__'
$TaskName    = 'SevenYears Attendance Sync'
$Version     = 2

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Here  = Split-Path -Parent $MyInvocation.MyCommand.Path
$State = Join-Path $Here 'state.json'
$Log   = Join-Path $Here 'sync.log'

function Write-Log($msg) {
  $line = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + '  ' + $msg
  Add-Content -Path $Log -Value $line
  if ((Get-Item $Log).Length -gt 1MB) { Get-Content $Log -Tail 2000 | Set-Content $Log }
  if ($Check -or $Install) { Write-Host $msg }
}

function Get-Connection {
  $cs = "Server=$ServerName;Database=$Database;Connect Timeout=15;"
  if ($SqlUser) { $cs += "User Id=$SqlUser;Password=$SqlPassword;" } else { $cs += 'Integrated Security=True;' }
  $c = New-Object System.Data.SqlClient.SqlConnection $cs
  $c.Open()
  return $c
}

function Invoke-Query($conn, $sql, $params) {
  $cmd = $conn.CreateCommand()
  $cmd.CommandText = $sql
  $cmd.CommandTimeout = 60
  if ($params) { foreach ($k in $params.Keys) { [void]$cmd.Parameters.AddWithValue($k, $params[$k]) } }
  $t = New-Object System.Data.DataTable
  $t.Load($cmd.ExecuteReader())
  return ,$t
}

function Get-LogTables($conn) {
  $now = Get-Date
  $names = @()
  foreach ($d in @($now.AddMonths(-1), $now)) { $names += ('DeviceLogs_' + $d.Month + '_' + $d.Year) }
  $found = @()
  foreach ($n in $names) {
    $t = Invoke-Query $conn 'SELECT OBJECT_ID(@n) AS id' @{ '@n' = $n }
    if ($t.Rows[0].id -ne [DBNull]::Value) { $found += $n }
  }
  return $found
}

function Send-Punches($list, $extra) {
  $payload = @{ punches = @($list); version = $Version }
  if ($extra) { foreach ($k in $extra.Keys) { $payload[$k] = $extra[$k] } }
  $body = $payload | ConvertTo-Json -Depth 4 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($body)
  return Invoke-RestMethod -Method Post -Uri $Url -Headers @{ 'x-sync-key' = $Key } -ContentType 'application/json; charset=utf-8' -Body $bytes -TimeoutSec 60
}

function To-Punch($t, $r) {
  return @{
    id = $t + ':' + $r.DeviceLogId
    code = ([string]$r.UserId).Trim()
    time = ([datetime]$r.LogDate).ToString('yyyy-MM-ddTHH:mm:ss') + '+05:30'
    device = [string]$r.DeviceId
    direction = [string]$r.Direction
  }
}

# Older punches asked for by the website: every month table from that day to today,
# 2000 punches at a time. Punches already on the website are skipped there.
function Send-OlderPunches($conn, $fromText) {
  $from = [datetime]::ParseExact($fromText, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture)
  $month = New-Object DateTime $from.Year, $from.Month, 1
  $sent = 0
  while ($month -le (Get-Date)) {
    $t = 'DeviceLogs_' + $month.Month + '_' + $month.Year
    $exists = Invoke-Query $conn 'SELECT OBJECT_ID(@n) AS id' @{ '@n' = $t }
    if ($exists.Rows[0].id -ne [DBNull]::Value) {
      $last = [long]0
      while ($true) {
        $rows = Invoke-Query $conn ("SELECT TOP 2000 DeviceLogId, UserId, LogDate, DeviceId, Direction FROM [" + $t + "] WHERE DeviceLogId > @last AND LogDate >= @from ORDER BY DeviceLogId") @{ '@last' = $last; '@from' = $from }
        if ($rows.Rows.Count -eq 0) { break }
        $list = New-Object System.Collections.ArrayList
        foreach ($r in $rows.Rows) {
          [void]$list.Add((To-Punch $t $r))
          $last = [long]$r.DeviceLogId
        }
        [void](Send-Punches $list $null)
        $sent += $list.Count
        if ($rows.Rows.Count -lt 2000) { break }
      }
    }
    $month = $month.AddMonths(1)
  }
  return $sent
}

if ($Uninstall) {
  schtasks /Delete /TN $TaskName /F | Out-Null
  Write-Host 'Removed the scheduled sync.'
  exit 0
}

if ($Install) {
  $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $action = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $MyInvocation.MyCommand.Path + '"'
  if ($admin -and $SqlUser) {
    schtasks /Create /SC MINUTE /MO 2 /TN $TaskName /TR $action /RU SYSTEM /RL HIGHEST /F | Out-Null
    Write-Host 'Installed: runs every 2 minutes, even when nobody is logged in.'
  } else {
    schtasks /Create /SC MINUTE /MO 2 /TN $TaskName /TR $action /F | Out-Null
    Write-Host 'Installed: runs every 2 minutes while this Windows user is logged in.'
  }
  exit 0
}

try {
  $conn = Get-Connection
} catch {
  Write-Log ('Cannot open the eTimeTrackLite database: ' + $_.Exception.Message)
  exit 1
}

try {
  $tables = Get-LogTables $conn
  if ($tables.Count -eq 0) { Write-Log 'No DeviceLogs_<month>_<year> table found in this database.'; exit 1 }

  $state = @{}
  if (Test-Path $State) { (Get-Content $State -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $state[$_.Name] = [long]$_.Value } }

  $today = (Get-Date).Date
  $punches = @()
  $newState = @{}
  foreach ($t in $tables) {
    if ($state.ContainsKey($t)) {
      $rows = Invoke-Query $conn ("SELECT TOP 3000 DeviceLogId, UserId, LogDate, DeviceId, Direction FROM [" + $t + "] WHERE DeviceLogId > @last ORDER BY DeviceLogId") @{ '@last' = $state[$t] }
    } else {
      # First time: send today's punches only.
      $rows = Invoke-Query $conn ("SELECT DeviceLogId, UserId, LogDate, DeviceId, Direction FROM [" + $t + "] WHERE LogDate >= @today ORDER BY DeviceLogId") @{ '@today' = $today }
    }
    $last = if ($state.ContainsKey($t)) { $state[$t] } else { 0 }
    foreach ($r in $rows.Rows) {
      $punches += (To-Punch $t $r)
      if ([long]$r.DeviceLogId -gt $last) { $last = [long]$r.DeviceLogId }
    }
    if (-not $state.ContainsKey($t) -and $rows.Rows.Count -eq 0) {
      $max = Invoke-Query $conn ("SELECT ISNULL(MAX(DeviceLogId), 0) AS m FROM [" + $t + "]") $null
      $last = [long]$max.Rows[0].m
    }
    $newState[$t] = $last
  }

  if ($Check) {
    Write-Host ('Database OK. Tables: ' + ($tables -join ', '))
    Write-Host ('New punches to send now: ' + $punches.Count)
  }

  $result = Send-Punches $punches
  ($newState | ConvertTo-Json) | Set-Content $State
  Write-Log ('Sent ' + $punches.Count + ' punch(es); saved ' + $result.saved + '.')

  if ($result.backfillFrom) {
    Write-Log ('Sending older punches from ' + $result.backfillFrom + ' ...')
    $older = Send-OlderPunches $conn ([string]$result.backfillFrom)
    [void](Send-Punches @() @{ backfillDone = $true; backfillSent = $older })
    Write-Log ('Older punches sent: ' + $older + '.')
  }
  if ($Check) { Write-Host 'Website OK. Everything is working - now run the same command with -Install.' }
} catch {
  Write-Log ('Sync failed: ' + $_.Exception.Message)
  exit 1
} finally {
  if ($conn) { $conn.Close() }
}
