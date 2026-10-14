# Builds pdffigures2.jar and a jlink runtime for deep-read figure extraction.
# Output: src-tauri/resources/pdffigures2/{pdffigures2.jar, runtime/, LICENSE-pdffigures2, LICENSE-jdk}
$ErrorActionPreference = "Stop"

$Commit = "3d7ad46753d4a315cccd1c2bcab398380e88c534"
$JdkUrl = "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse"
$SbtUrl = "https://github.com/sbt/sbt/releases/download/v1.10.2/sbt-1.10.2.zip"

$Root = Split-Path -Parent $PSScriptRoot
$Out = Join-Path $Root "src-tauri\resources\pdffigures2"
$Work = Join-Path $env:TEMP "papernest-pdffigures2"
New-Item -ItemType Directory -Force $Work | Out-Null

function Invoke-Checked([string]$File, [string[]]$Arguments) {
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$File exited with $LASTEXITCODE" }
}

$Jdk = Get-ChildItem $Work -Directory -Filter "jdk-17*" | Select-Object -First 1
if (-not $Jdk) {
  Invoke-WebRequest $JdkUrl -OutFile "$Work\jdk.zip"
  Expand-Archive "$Work\jdk.zip" $Work
  $Jdk = Get-ChildItem $Work -Directory -Filter "jdk-17*" | Select-Object -First 1
}
$env:JAVA_HOME = $Jdk.FullName
$env:PATH = "$($Jdk.FullName)\bin;$env:PATH"

if (-not (Test-Path "$Work\sbt\bin\sbt.bat")) {
  Invoke-WebRequest $SbtUrl -OutFile "$Work\sbt.zip"
  Expand-Archive "$Work\sbt.zip" $Work
}

$Source = Join-Path $Work "src"
if (-not (Test-Path "$Source\.git")) {
  Invoke-Checked git @("clone", "https://github.com/allenai/pdffigures2", $Source)
}
Invoke-Checked git @("-C", $Source, "checkout", "--force", $Commit)

Push-Location $Source
try { Invoke-Checked "$Work\sbt\bin\sbt.bat" @("-batch", "assembly") } finally { Pop-Location }

$Jar = Join-Path $Source "pdffigures2.jar"
$Modules = (& "$($Jdk.FullName)\bin\jdeps.exe" --ignore-missing-deps --print-module-deps --multi-release 17 $Jar).Trim()
if ($LASTEXITCODE -ne 0) { throw "jdeps exited with $LASTEXITCODE" }

if (Test-Path $Out) { Remove-Item -Recurse -Force $Out }
New-Item -ItemType Directory -Force $Out | Out-Null
Invoke-Checked "$($Jdk.FullName)\bin\jlink.exe" @("--add-modules", $Modules, "--strip-debug", "--no-header-files", "--no-man-pages", "--compress=2", "--output", "$Out\runtime")
Copy-Item $Jar "$Out\pdffigures2.jar"
Copy-Item "$Source\LICENSE.txt" "$Out\LICENSE-pdffigures2"
Copy-Item "$($Jdk.FullName)\legal\java.base\LICENSE" "$Out\LICENSE-jdk"

"modules: $Modules"
Get-ChildItem $Out -Recurse -File | Measure-Object Length -Sum | ForEach-Object { "size: {0:N1} MB" -f ($_.Sum / 1MB) }
