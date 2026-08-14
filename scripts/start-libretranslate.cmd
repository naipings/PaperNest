@echo off
setlocal
set "PORTABLE_HOME=%LOCALAPPDATA%\PaperNest\LibreTranslate"
if not "%PAPERNEST_LIBRETRANSLATE_HOME%"=="" set "PORTABLE_HOME=%PAPERNEST_LIBRETRANSLATE_HOME%"
set "LIBRE_EXE=%PORTABLE_HOME%\venv\Scripts\libretranslate.exe"
set "ARGOS_PACKAGES_DIR=%PORTABLE_HOME%\packages"
if not exist "%LIBRE_EXE%" (
  set "LIBRE_EXE=%~dp0..\.libretranslate-venv\Scripts\libretranslate.exe"
  set "ARGOS_PACKAGES_DIR=%~dp0..\.libretranslate-data\packages"
)
if not exist "%LIBRE_EXE%" (
  echo LibreTranslate is not installed. Run setup-libretranslate.cmd first.
  exit /b 1
)
"%LIBRE_EXE%" --host 127.0.0.1 --port 5000 --load-only en,zh-Hans
