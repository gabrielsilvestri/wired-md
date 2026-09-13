$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\..\packaging\wired-path.ps1" -FunctionsOnly

function Assert-Equal($Expected, $Actual, [string] $Message) {
  if ($Expected -cne $Actual) { throw "$Message`nExpected: $Expected`nActual:   $Actual" }
}

$install = 'C:\Users\A Name\AppData\Local\Programs\wired-md'
$moved = 'D:\Apps\wired-md'
$longEntry = 'C:\' + ('third-party-' * 500)
$original = '%USERPROFILE%\bin;' + $longEntry + ';C:\Tools'

$first = Get-InstallTransition $original $install '' 0
Assert-Equal ($original + ';' + $install) $first.Path 'fresh install appends the CLI directory'
Assert-Equal 1 $first.Owned 'fresh install owns its entry'
$again = Get-InstallTransition $first.Path $install $install $first.Owned
Assert-Equal $first.Path $again.Path 'reinstall is idempotent'
Assert-Equal 1 $again.Owned 'reinstall keeps ownership'
$migration = Get-InstallTransition $again.Path $moved $install $again.Owned
Assert-Equal ($original + ';' + $moved) $migration.Path 'moving install replaces its owned entry'
Assert-Equal 1 $migration.Owned 'moving install owns the new entry'
Assert-Equal $original (Get-UninstallTransition $migration.Path $moved $moved $migration.Owned) 'uninstall removes its entry only'
Assert-Equal $migration.Path (Get-UninstallTransition $migration.Path $install $moved 1) 'stale uninstaller cannot remove a newer install entry'

$preexisting = Get-InstallTransition ($original + ';"' + $install + '\";;') $install '' 0
Assert-Equal 0 $preexisting.Owned 'a preexisting quoted entry remains user-owned'
Assert-Equal ($original + ';"' + $install + '\";;') $preexisting.Path 'a quoted equivalent is not duplicated'
Assert-Equal $preexisting.Path (Get-UninstallTransition $preexisting.Path $install $install $preexisting.Owned) 'uninstall preserves a preexisting entry'
Assert-Equal 'C:\' (Normalize-PathEntry 'C:\') 'drive root keeps its slash'
Assert-Equal ';;X;X;' (Remove-PathEntry -Current ';X;;X;X;' -Entry 'X') 'removal deletes one matching occurrence'
$trailing = Get-InstallTransition 'C:\Tools;' $install '' 0
Assert-Equal 'C:\Tools;' (Get-UninstallTransition $trailing.Path $install $install $trailing.Owned) 'trailing empty PATH segment roundtrips exactly'

Write-Output 'PATH transition checks passed'
