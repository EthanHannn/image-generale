param(
  [string]$CertificateThumbprint = $env:WINDOWS_SIGNING_CERTIFICATE_THUMBPRINT,
  [string]$TimestampUrl = $env:WINDOWS_TIMESTAMP_URL,
  [string]$DigestAlgorithm = $env:WINDOWS_DIGEST_ALGORITHM
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($CertificateThumbprint)) {
  throw 'WINDOWS_SIGNING_CERTIFICATE_THUMBPRINT is empty.'
}

if ([string]::IsNullOrWhiteSpace($TimestampUrl)) {
  $TimestampUrl = 'http://timestamp.digicert.com'
}

if ([string]::IsNullOrWhiteSpace($DigestAlgorithm)) {
  $DigestAlgorithm = 'sha256'
}

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$tauriConfigPath = Join-Path $projectRoot 'src-tauri\tauri.conf.json'
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Ensure-Property {
  param(
    [Parameter(Mandatory = $true)]
    [object]$Object,
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [object]$Value
  )

  if ($Object.PSObject.Properties.Name -contains $Name) {
    $Object.$Name = $Value
  }
  else {
    $Object | Add-Member -MemberType NoteProperty -Name $Name -Value $Value
  }
}

$config = Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json

if ($null -eq $config.bundle) {
  throw 'tauri.conf.json bundle section is missing.'
}

if ($null -eq $config.bundle.windows) {
  Ensure-Property -Object $config.bundle -Name 'windows' -Value ([pscustomobject]@{})
}

Ensure-Property -Object $config.bundle.windows -Name 'certificateThumbprint' -Value $CertificateThumbprint
Ensure-Property -Object $config.bundle.windows -Name 'digestAlgorithm' -Value $DigestAlgorithm
Ensure-Property -Object $config.bundle.windows -Name 'timestampUrl' -Value $TimestampUrl

$json = $config | ConvertTo-Json -Depth 32
[System.IO.File]::WriteAllText($tauriConfigPath, $json + [Environment]::NewLine, $utf8NoBom)

Write-Host 'Configured Windows signing for Tauri build.'
Write-Host ('Timestamp URL: {0}' -f $TimestampUrl)
Write-Host ('Digest algorithm: {0}' -f $DigestAlgorithm)
