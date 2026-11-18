# ---------------------------------------------------------------------------
#  Seven Years Care - update the attendance sync script on the office PC.
#  Run once in PowerShell on the office PC:
#    powershell -ExecutionPolicy Bypass -Command "irm https://care.sevenyears.in/downloads/update-sync.ps1 | iex"
#  It keeps the settings already in C:\SevenYearsSync\SevenYearsSync.ps1
#  (database, login, sync key - they stay on this PC), puts them into the newest
#  script from the website, checks it, and replaces the old file. A copy of the
#  old file is kept as SevenYearsSync.ps1.old. Newer scripts update themselves.
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$file = 'C:\SevenYearsSync\SevenYearsSync.ps1'
if (-not (Test-Path $file)) { Write-Host "Not found: $file  (is this the office PC with eTimeTrackLite?)" -ForegroundColor Red; return }

$old = Get-Content $file -Raw
$names = @('ServerName', 'Database', 'SqlUser', 'SqlPassword', 'Url', 'Key')
$marks = @{ ServerName = 'SERVER'; Database = 'DATABASE'; SqlUser = 'SQLUSER'; SqlPassword = 'SQLPASSWORD'; Url = 'URL'; Key = 'KEY' }
$values = @{}
foreach ($n in $names) {
  $m = [regex]::Match($old, '(?m)^\$' + $n + '\s*=\s*''((?:[^'']|'''')*)''')
  if (-not $m.Success) { Write-Host "Could not read $n from the old script. Download a new script from Settings -> Attendance instead." -ForegroundColor Red; return }
  $values[$n] = $m.Groups[1].Value   # still in '...' form ('' for ')
}

$url = $values['Url'].Replace("''", "'")
$base = $url -replace '/api/attendance/push$', ''
$wc = New-Object System.Net.WebClient
$wc.Encoding = [Text.Encoding]::UTF8
$tpl = $wc.DownloadString($base + '/downloads/attendance-sync-template.ps1')

foreach ($n in $names) {
  $ph = "'" + '__' + $marks[$n] + '__' + "'"
  if ($tpl.IndexOf($ph) -lt 0) { Write-Host "The script on the website looks wrong ($n). Nothing was changed." -ForegroundColor Red; return }
  $tpl = $tpl.Replace($ph, "'" + $values[$n] + "'")
}
$new = ($tpl -replace "`r?`n", "`r`n")

$tmp = $file + '.new'
Set-Content -Path $tmp -Value $new -Encoding UTF8 -NoNewline
$tokens = $null
$errs = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($tmp, [ref]$tokens, [ref]$errs)
if ($errs -and $errs.Count -gt 0) { Remove-Item $tmp -Force; Write-Host ('The new script has an error: ' + $errs[0].Message + '. Nothing was changed.') -ForegroundColor Red; return }

Copy-Item $file ($file + '.old') -Force
Move-Item $tmp $file -Force
Write-Host 'Updated. Checking the database and the website...' -ForegroundColor Green
& powershell -NoProfile -ExecutionPolicy Bypass -File $file -Check
