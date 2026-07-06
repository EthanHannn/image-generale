$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$packageJsonPath = Join-Path $projectRoot 'package.json'
$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
$version = $packageJson.version

if ([string]::IsNullOrWhiteSpace($version)) {
  throw 'package.json version is empty.'
}

$bundleRoot = Join-Path $projectRoot 'src-tauri\target\release\bundle'
$nsisSource = Get-ChildItem -LiteralPath (Join-Path $bundleRoot 'nsis') -Filter '*.exe' -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like "*_$version`_*setup.exe" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
$msiSource = Get-ChildItem -LiteralPath (Join-Path $bundleRoot 'msi') -Filter '*.msi' -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -like "*_$version`_*.msi" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if ($null -eq $nsisSource) {
  throw 'NSIS installer not found. Run npm run desktop:build:windows:nsis first.'
}

$releaseDir = Join-Path $projectRoot (Join-Path 'release' (Join-Path $version 'windows-x64'))

if (Test-Path -LiteralPath $releaseDir) {
  Remove-Item -LiteralPath $releaseDir -Recurse -Force
}

New-Item -ItemType Directory -Path $releaseDir | Out-Null

$files = @(
  @{
    Source = $nsisSource.FullName
    Name = "ImageGenerator-$version-windows-x64-setup.exe"
  }
)

if ($null -ne $msiSource) {
  Write-Host 'MSI package found but not included in public Windows release files.'
}

foreach ($file in $files) {
  Copy-Item -LiteralPath $file.Source -Destination (Join-Path $releaseDir $file.Name)
}

$checksumLines = foreach ($file in $files) {
  $targetPath = Join-Path $releaseDir $file.Name
  $stream = [System.IO.File]::OpenRead($targetPath)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $hashBytes = $sha256.ComputeHash($stream)
    $hash = [System.BitConverter]::ToString($hashBytes).Replace('-', '')
  }
  finally {
    $stream.Dispose()
    if ($null -ne $sha256) {
      $sha256.Dispose()
    }
  }
  "$hash  $($file.Name)"
}

Set-Content -LiteralPath (Join-Path $releaseDir 'checksums.txt') -Value $checksumLines -Encoding UTF8

$releaseNotes = @(
  "# Image Generator $version"
  ''
  '## Changes'
  ''
  '- '
  ''
  '## Verification'
  ''
  '- Windows NSIS install, launch, uninstall'
  '- Windows NSIS upgrade, launch, data retention'
  '- SHA256 checksums included'
  '- Windows packages are unsigned unless a signing certificate is explicitly configured'
  ''
  '## Windows notice'
  ''
  'This open-source build is unsigned by default. Windows may show a security warning during first install.'
  ''
  '## Artifacts'
  ''
  "- ImageGenerator-$version-windows-x64-setup.exe"
)

Set-Content -LiteralPath (Join-Path $releaseDir 'release-notes.md') -Value $releaseNotes -Encoding UTF8

Write-Host "Prepared Windows release files:"
Get-ChildItem -LiteralPath $releaseDir -File | Select-Object Name,Length
