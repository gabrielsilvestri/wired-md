' Portable launcher for wired-md: runs the app from source with no console window.
' Usage: wired-md.vbs [path\to\file.md]
'
' This file discovers its own location, so it works from wherever the repo lives.
' It expects to sit at <repo>\scripts\windows\wired-md.vbs and derives the repo
' root as the folder two levels up. No absolute path is hardcoded.
Option Explicit
Dim fso, sh, scriptDir, app, elec, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
app = fso.GetParentFolderName(fso.GetParentFolderName(scriptDir))
elec = app & "\node_modules\electron\dist\electron.exe"

cmd = """" & elec & """ """ & app & """"
If WScript.Arguments.Count > 0 Then
  cmd = cmd & " """ & WScript.Arguments(0) & """"
End If

sh.CurrentDirectory = app
sh.Run cmd, 1, False
