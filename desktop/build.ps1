param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path $PSScriptRoot -Parent
$sourceRoot = Join-Path $repositoryRoot 'public'
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $outputRoot, (Join-Path $outputRoot 'app'), (Join-Path $outputRoot 'app\icons') | Out-Null
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework C# compiler not found.' }
& $compiler /nologo /target:winexe /platform:anycpu "/win32icon:$sourceRoot\icons\caterdesk.ico" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/out:$outputRoot\CaterDesk-Desktop.exe" (Join-Path $PSScriptRoot 'FlavorFusionDesktop.cs')
if ($LASTEXITCODE -ne 0) { throw 'Desktop compilation failed.' }
foreach ($file in @('index.html','app.js','db.js','utils.js','backup-crypto.js','drive-backup.js','drive-config.js','icons.js','i18n.js','nl.js','styles.css','manifest.json','sw.js','register-sw.js','error-reporter.js')) { Copy-Item -LiteralPath (Join-Path $sourceRoot $file) -Destination (Join-Path $outputRoot 'app') }
Copy-Item -Path (Join-Path $sourceRoot 'icons\*.png') -Destination (Join-Path $outputRoot 'app\icons')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.txt') -Destination $outputRoot
Write-Output "Desktop test app built: $outputRoot\CaterDesk-Desktop.exe"
