param(
  [string]$CertificateBase64 = $env:WINDOWS_CERTIFICATE_BASE64,
  [string]$CertificatePassword = $env:WINDOWS_CERTIFICATE_PASSWORD,
  [string]$CertStoreLocation = 'Cert:\CurrentUser\My',
  [string]$EnvFile = $env:GITHUB_ENV
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($CertificateBase64)) {
  throw 'WINDOWS_CERTIFICATE_BASE64 is empty.'
}

if ([string]::IsNullOrWhiteSpace($CertificatePassword)) {
  throw 'WINDOWS_CERTIFICATE_PASSWORD is empty.'
}

$tempPfxPath = Join-Path ([System.IO.Path]::GetTempPath()) ('image-generator-signing-{0}.pfx' -f [System.Guid]::NewGuid().ToString('N'))

try {
  [System.IO.File]::WriteAllBytes($tempPfxPath, [System.Convert]::FromBase64String($CertificateBase64))
  $securePassword = ConvertTo-SecureString -String $CertificatePassword -AsPlainText -Force
  $certificates = Import-PfxCertificate -FilePath $tempPfxPath -CertStoreLocation $CertStoreLocation -Password $securePassword

  if ($null -eq $certificates -or $certificates.Count -eq 0) {
    throw 'No certificate was imported.'
  }

  $certificate = @($certificates)[0]
  $thumbprint = $certificate.Thumbprint

  if ([string]::IsNullOrWhiteSpace($thumbprint)) {
    throw 'Imported certificate thumbprint is empty.'
  }

  Write-Host ('Imported Windows signing certificate thumbprint: {0}' -f $thumbprint)

  if (-not [string]::IsNullOrWhiteSpace($EnvFile)) {
    Add-Content -LiteralPath $EnvFile -Value ('WINDOWS_SIGNING_CERTIFICATE_THUMBPRINT={0}' -f $thumbprint)
  }
}
finally {
  if (Test-Path -LiteralPath $tempPfxPath) {
    Remove-Item -LiteralPath $tempPfxPath -Force
  }
}
