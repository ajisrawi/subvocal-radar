# Builds the firmware on Windows and copies the .uf2 to firmware\release\.
# Expects the tools in C:\Users\ahmad\pico-tools (override with -Tools): arm\bin (Arm GNU toolchain 14.2),
# pico-sdk (Pico SDK 2.3.1 with lib\tinyusb), picotool\picotool (picotool 2.3.1). CMake and Ninja must be on PATH.
param([string]$Tools = 'C:\Users\ahmad\pico-tools', [switch]$Clean)
# CMake prints status on stderr; Windows PowerShell would treat that as an error, so rely on exit codes instead
$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PATH = "$Tools\arm\bin;$env:PATH"
$env:PICO_SDK_PATH = "$Tools\pico-sdk"
$build = Join-Path $here 'build'
if ($Clean -and (Test-Path $build)) { Remove-Item -Recurse -Force $build }

cmake -S $here -B $build -G Ninja -DCMAKE_BUILD_TYPE=Release "-DPICO_SDK_PATH=$Tools\pico-sdk" "-Dpicotool_DIR=$Tools\picotool\picotool" "-DPICO_TOOLCHAIN_PATH=$Tools\arm"
if ($LASTEXITCODE) { throw 'cmake configure failed' }
cmake --build $build
if ($LASTEXITCODE) { throw 'build failed' }

$rel = Join-Path $here 'release'
New-Item -ItemType Directory -Force $rel | Out-Null
Copy-Item (Join-Path $build 'subvocal_radar.uf2') $rel -Force
Copy-Item (Join-Path $build 'subvocal_radar.elf') $rel -Force
Get-Item (Join-Path $rel 'subvocal_radar.uf2') | Select-Object FullName, Length
