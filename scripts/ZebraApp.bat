@echo off
rem Starts ZebraApp on Windows (double-click).
cd /d "%~dp0.."
where pythonw >nul 2>nul && (start "" pythonw -m zebraapp) || (python -m zebraapp)
