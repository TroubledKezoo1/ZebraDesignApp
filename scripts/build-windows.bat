@echo off
rem Builds dist\ZebraApp.exe (needs Python 3.9+ from python.org or the Microsoft Store).
setlocal
cd /d "%~dp0\.."
if not exist .venv\Scripts\python.exe python -m venv .venv || goto :err
.venv\Scripts\python.exe -m pip install --upgrade pip || goto :err
.venv\Scripts\python.exe -m pip install ".[all]" pyinstaller || goto :err
.venv\Scripts\pyinstaller.exe --noconfirm packaging\zebraapp.spec || goto :err
echo.
echo Done: dist\ZebraApp.exe
exit /b 0
:err
echo.
echo Build failed.
exit /b 1
