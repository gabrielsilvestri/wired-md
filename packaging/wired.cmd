@echo off
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0wired-md.exe" "%~dp0resources\app.asar\bin\wired.js" %*
exit /b %errorlevel%
