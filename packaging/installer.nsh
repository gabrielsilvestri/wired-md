!macro customInstall
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\wired-path.ps1" install "$INSTDIR"' $0
  ${If} $0 != 0
    DetailPrint "Could not add wired to the user PATH (exit code $0)."
  ${EndIf}
!macroend

!macro customUnInstall
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\wired-path.ps1" uninstall "$INSTDIR"' $0
  ${If} $0 != 0
    DetailPrint "Could not remove wired from the user PATH (exit code $0)."
  ${EndIf}
!macroend
