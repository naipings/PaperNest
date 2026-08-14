@echo off
setlocal
set "PORTABLE_HOME=%LOCALAPPDATA%\PaperNest\LibreTranslate"
if not "%PAPERNEST_LIBRETRANSLATE_HOME%"=="" set "PORTABLE_HOME=%PAPERNEST_LIBRETRANSLATE_HOME%"
set "VENV=%PORTABLE_HOME%\venv"
where py >nul 2>nul
if errorlevel 1 (
  echo Python 3.8 or newer is required. Install Python, then run this script again.
  exit /b 1
)
if not exist "%VENV%\Scripts\python.exe" py -3 -m venv "%VENV%"
"%VENV%\Scripts\python.exe" -m pip install --upgrade pip libretranslate
if errorlevel 1 exit /b 1
set "ARGOS_PACKAGES_DIR=%PORTABLE_HOME%\packages"
echo Downloading/updating translation models. This can take several minutes on first use.
"%VENV%\Scripts\libretranslate.exe" --host 127.0.0.1 --port 5000 --load-only en,zh-Hans --update-models
