param([string] $AppDir = (Join-Path $PSScriptRoot '..\dist\win-unpacked'))

$ErrorActionPreference = 'Stop'
$appDir = [IO.Path]::GetFullPath($AppDir)
$wired = Join-Path $appDir 'wired.cmd'
if (-not (Test-Path $wired -PathType Leaf)) { throw "Packaged CLI not found: $wired" }

$root = Join-Path ([IO.Path]::GetTempPath()) ('wired-packaged-cli-' + [Guid]::NewGuid().ToString('N'))
$profile = Join-Path $root 'profile'
$fixture = Join-Path $root 'fixture with spaces'
New-Item -ItemType Directory -Path $profile, $fixture | Out-Null
$noteName = 'ol' + [char] 0x00e1 + ' wired'
$createdName = 'cria' + [char] 0x00e7 + [char] 0x00e3 + 'o CLI'
$note = Join-Path $fixture ($noteName + '.md')
Set-Content -LiteralPath $note -Value '# packaged CLI' -Encoding utf8

$savedPath = $env:PATH
$savedProfile = $env:WIRED_USERDATA
$env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
$env:WIRED_USERDATA = $profile

function Invoke-Wired([string[]] $Arguments, [int] $ExpectedExit = 0) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $output = & $wired @Arguments 2>&1 } finally { $ErrorActionPreference = $previousPreference }
  if ($LASTEXITCODE -ne $ExpectedExit) {
    throw "wired $($Arguments -join ' ') exited $LASTEXITCODE, expected $ExpectedExit`n$output"
  }
  return @($output | ForEach-Object { "$_" })
}

try {
  $help = Invoke-Wired @('--help')
  if (($help -join "`n") -notmatch 'wired open') { throw 'Packaged --help did not write its usage to stdout.' }

  Push-Location $fixture
  try { $opened = @(Invoke-Wired @('open', ('.\' + $noteName + '.md'))) } finally { Pop-Location }
  if ($opened[-1] -ne $note) { throw "open returned an unexpected path: $opened" }

  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 250
    $json = (Invoke-Wired @('list', '--json')) -join "`n"
    $files = $json | ConvertFrom-Json
    $pane = @($files | Where-Object { $_.path -eq $note })
  } while ($pane.Count -eq 0 -and [DateTime]::UtcNow -lt $deadline)
  if ($pane.Count -eq 0) { throw 'Cold open replied, but the file never appeared in a real editor pane.' }

  $focused = @(Invoke-Wired @('focus', $note))
  if ($focused[-1] -ne $note) { throw "focus returned an unexpected path: $focused" }

  Push-Location $fixture
  try { $created = @(Invoke-Wired @('new', '--title', $createdName)) } finally { Pop-Location }
  $createdPath = Join-Path $fixture ($createdName + '.md')
  if ($created[-1] -ne $createdPath -or -not (Test-Path $createdPath -PathType Leaf)) { throw 'new did not create the expected Unicode note.' }

  [void] (Invoke-Wired @('open', (Join-Path $fixture 'missing.md')) 1)

  $otherProfile = Join-Path $root 'profile-without-instance'
  New-Item -ItemType Directory -Path $otherProfile | Out-Null
  $env:WIRED_USERDATA = $otherProfile
  $noInstance = Invoke-Wired @('list') 1
  if (($noInstance -join "`n") -notmatch 'no editor running') { throw 'list without an instance did not report the expected error.' }

  Write-Output 'packaged CLI smoke passed'
} finally {
  $env:WIRED_USERDATA = $profile
  $marker = Join-Path $profile 'cli-instance.json'
  if (Test-Path $marker) {
    try {
      $pidToStop = (Get-Content -Raw $marker | ConvertFrom-Json).pid
      Stop-Process -Id $pidToStop -Force -ErrorAction SilentlyContinue
    } catch {}
  }
  $env:PATH = $savedPath
  $env:WIRED_USERDATA = $savedProfile
}
