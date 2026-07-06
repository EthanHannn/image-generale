param(
  [string[]]$Path,
  [switch]$AllowUnsigned
)

$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

if ($null -eq $Path -or $Path.Count -eq 0) {
  $Path = @(
    (Join-Path $projectRoot 'src-tauri\target\release\bundle\nsis\*.exe'),
    (Join-Path $projectRoot 'src-tauri\target\release\bundle\msi\*.msi')
  )
}

$files = foreach ($item in $Path) {
  Get-ChildItem -Path $item -File -ErrorAction SilentlyContinue
}

if ($null -eq $files -or @($files).Count -eq 0) {
  throw 'No Windows package files found for signature verification.'
}

$hasFailure = $false
$authenticodeCommand = Get-Command Get-AuthenticodeSignature -ErrorAction SilentlyContinue
$signToolCommand = Get-Command signtool.exe -ErrorAction SilentlyContinue

if ($null -eq $authenticodeCommand -and $null -eq $signToolCommand) {
  if ($AllowUnsigned) {
    Write-Host 'Signature verification tool is unavailable. Skipped because AllowUnsigned is enabled.'
    return
  }

  throw 'Neither Get-AuthenticodeSignature nor signtool.exe is available.'
}

foreach ($file in $files) {
  $checkedByAuthenticode = $false

  if ($null -ne $authenticodeCommand) {
    try {
      $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
      $subject = if ($null -ne $signature.SignerCertificate) {
        $signature.SignerCertificate.Subject
      }
      else {
        ''
      }

      [pscustomobject]@{
        File = $file.Name
        Status = $signature.Status
        Signer = $subject
      } | Format-List

      if ($signature.Status -ne 'Valid') {
        $hasFailure = $true
      }

      $checkedByAuthenticode = $true
    }
    catch {
      if ($null -eq $signToolCommand) {
        if ($AllowUnsigned) {
          Write-Host ('Signature verification skipped for {0}: {1}' -f $file.Name, $_.Exception.Message)
          continue
        }

        throw
      }
    }
  }

  if (-not $checkedByAuthenticode) {
    $process = Start-Process -FilePath $signToolCommand.Source -ArgumentList @('verify', '/pa', '/v', $file.FullName) -Wait -PassThru -NoNewWindow
    [pscustomobject]@{
      File = $file.Name
      Status = if ($process.ExitCode -eq 0) { 'Valid' } else { 'Invalid' }
      Signer = ''
    } | Format-List

    if ($process.ExitCode -ne 0) {
      $hasFailure = $true
    }
  }
}

if ($hasFailure -and -not $AllowUnsigned) {
  throw 'One or more Windows package signatures are not valid.'
}
