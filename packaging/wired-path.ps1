param(
  [Parameter(Position = 0)]
  [ValidateSet('install', 'uninstall')]
  [string] $Action,
  [Parameter(Position = 1)]
  [string] $InstallDir,
  [switch] $FunctionsOnly
)

$ErrorActionPreference = 'Stop'
$environmentKey = 'HKEY_CURRENT_USER\Environment'
$stateKey = 'HKEY_CURRENT_USER\Software\wired-md'

function Normalize-PathEntry([string] $Entry) {
  if ($null -eq $Entry) { return '' }
  $normalized = $Entry.Trim()
  if ($normalized.Length -ge 2 -and $normalized[0] -eq '"' -and $normalized[$normalized.Length - 1] -eq '"') {
    $normalized = $normalized.Substring(1, $normalized.Length - 2).Trim()
  }
  if ($normalized -match '^[A-Za-z]:\\$') { return $normalized }
  return $normalized.TrimEnd('\')
}

function Test-SamePath([string] $Left, [string] $Right) {
  if ([string]::IsNullOrEmpty($Left) -or [string]::IsNullOrEmpty($Right)) {
    return [string]::IsNullOrEmpty($Left) -and [string]::IsNullOrEmpty($Right)
  }
  $normalizedLeft = [string] (Normalize-PathEntry -Entry $Left)
  $normalizedRight = [string] (Normalize-PathEntry -Entry $Right)
  return [string]::Equals($normalizedLeft, $normalizedRight, [StringComparison]::OrdinalIgnoreCase)
}

function Add-PathEntry([string] $Current, [string] $Entry) {
  $parts = @($Current.Split([char] ';') | Where-Object { $_ -ne '' })
  if ($parts | Where-Object { Test-SamePath -Left $_ -Right $Entry }) { return $Current }
  if ([string]::IsNullOrEmpty($Current)) { return $Entry }
  return $Current + ';' + $Entry
}

function Remove-PathEntry([string] $Current, [string] $Entry) {
  $removed = $false
  $parts = [System.Collections.Generic.List[string]]::new()
  foreach ($part in $Current.Split([char] ';')) {
    if (-not $removed -and (Test-SamePath -Left $part -Right $Entry)) {
      $removed = $true
    } else {
      [void] $parts.Add($part)
    }
  }
  return [string]::Join(';', $parts)
}

function Get-InstallTransition([string] $Current, [string] $InstallDir, [string] $OldPath, [int] $OldWasAdded) {
  if ($OldWasAdded -eq 1 -and $OldPath -ne '' -and -not (Test-SamePath -Left $OldPath -Right $InstallDir)) {
    $Current = Remove-PathEntry $Current $OldPath
  }
  $alreadyPresent = @($Current.Split([char] ';') | Where-Object { Test-SamePath -Left $_ -Right $InstallDir }).Count -gt 0
  $stillOwned = $OldWasAdded -eq 1 -and (Test-SamePath -Left $OldPath -Right $InstallDir)
  [PSCustomObject]@{
    Path = Add-PathEntry $Current $InstallDir
    Owned = $(if ($stillOwned -or -not $alreadyPresent) { 1 } else { 0 })
  }
}

function Get-UninstallTransition([string] $Current, [string] $InstallDir, [string] $OwnedPath, [int] $WasAdded) {
  if ($WasAdded -eq 1 -and (Test-SamePath -Left $OwnedPath -Right $InstallDir)) {
    return Remove-PathEntry $Current $InstallDir
  }
  return $Current
}

if ($FunctionsOnly) { return }
if (-not $Action -or -not $InstallDir) { throw 'Action and InstallDir are required.' }

$environment = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
if ($null -eq $environment) { throw 'Could not open HKCU\Environment.' }
$state = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\wired-md')
try {
  $current = [string] $environment.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  try { $pathKind = $environment.GetValueKind('Path') } catch { $pathKind = [Microsoft.Win32.RegistryValueKind]::ExpandString }
  if ($Action -eq 'install') {
    $oldPath = [string] $state.GetValue('CliPath', '')
    $oldWasAdded = [int] $state.GetValue('CliPathAdded', 0)
    $transition = Get-InstallTransition $current $InstallDir $oldPath $oldWasAdded
    $environment.SetValue('Path', $transition.Path, $pathKind)
    $state.SetValue('CliPath', $InstallDir, [Microsoft.Win32.RegistryValueKind]::String)
    $state.SetValue('CliPathAdded', $transition.Owned, [Microsoft.Win32.RegistryValueKind]::DWord)
  } else {
    $ownedPath = [string] $state.GetValue('CliPath', '')
    $wasAdded = [int] $state.GetValue('CliPathAdded', 0)
    if (Test-SamePath -Left $ownedPath -Right $InstallDir) {
      $environment.SetValue('Path', (Get-UninstallTransition $current $InstallDir $ownedPath $wasAdded), $pathKind)
      $state.DeleteValue('CliPath', $false)
      $state.DeleteValue('CliPathAdded', $false)
    }
  }
} finally {
  $state.Dispose()
  $environment.Dispose()
}

# Notify Explorer and future processes that the user environment changed.
Add-Type -Namespace Win32 -Name Environment -MemberDefinition @'
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam,
  string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
'@
$result = [UIntPtr]::Zero
[void] [Win32.Environment]::SendMessageTimeout([IntPtr] 0xffff, 0x001A, [UIntPtr]::Zero, 'Environment', 2, 5000, [ref] $result)
