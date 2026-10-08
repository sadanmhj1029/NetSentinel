@echo off
rem NetSentinel helper. Double-click for a menu, or run: NetSentinel.bat start ^| stop ^| update ^| status ^| logs ^| backup ^| restore ^| open
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\netsentinel.ps1" %*
if "%~1"=="" pause
