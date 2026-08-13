@echo off
rem Portable wrapper selectable in the Windows "Open with" dialog (which only
rem lists .exe, .bat and .cmd). It hands the file to the .vbs launcher next to
rem it, which starts the app without a console window. %~dp0 keeps it path-free.
start "" "%SystemRoot%\System32\wscript.exe" "%~dp0wired-md.vbs" %*
