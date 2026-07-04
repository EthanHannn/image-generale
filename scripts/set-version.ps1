param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Version
)

$ErrorActionPreference = 'Stop'

if ($Version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$') {
  throw "Invalid version '$Version'. Expected semantic version like 0.1.1 or 0.1.1-beta.1."
}

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$packageJsonPath = Join-Path $projectRoot 'package.json'
$tauriConfigPath = Join-Path $projectRoot 'src-tauri\tauri.conf.json'
$cargoTomlPath = Join-Path $projectRoot 'src-tauri\Cargo.toml'

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  [System.IO.File]::WriteAllText($Path, $Value, $utf8NoBom)
}

function Replace-First {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Content,
    [Parameter(Mandatory = $true)]
    [string]$Pattern,
    [Parameter(Mandatory = $true)]
    [string]$Replacement,
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $updated = [System.Text.RegularExpressions.Regex]::Replace($Content, $Pattern, $Replacement, 1)

  if ($updated -eq $Content) {
    throw "$Name version was not updated."
  }

  return $updated
}

$packageJson = [System.IO.File]::ReadAllText($packageJsonPath)
$packageJson = Replace-First `
  -Content $packageJson `
  -Pattern '("version"\s*:\s*)"[^"]+"' `
  -Replacement "`${1}`"$Version`"" `
  -Name 'package.json'
Write-Utf8NoBom -Path $packageJsonPath -Value $packageJson

$tauriConfig = [System.IO.File]::ReadAllText($tauriConfigPath)
$tauriConfig = Replace-First `
  -Content $tauriConfig `
  -Pattern '("version"\s*:\s*)"[^"]+"' `
  -Replacement "`${1}`"$Version`"" `
  -Name 'tauri.conf.json'
Write-Utf8NoBom -Path $tauriConfigPath -Value $tauriConfig

$cargoToml = [System.IO.File]::ReadAllText($cargoTomlPath)
$cargoToml = Replace-First `
  -Content $cargoToml `
  -Pattern '(?m)^(version\s*=\s*)"[^"]+"' `
  -Replacement "`${1}`"$Version`"" `
  -Name 'Cargo.toml'
Write-Utf8NoBom -Path $cargoTomlPath -Value $cargoToml

Write-Host "Updated project version to $Version"
Write-Host ''
Write-Host 'Next release commands:'
Write-Host "  git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml"
Write-Host "  git commit -m `"chore: release v$Version`""
Write-Host "  git tag v$Version"
Write-Host "  git push origin main --tags"
