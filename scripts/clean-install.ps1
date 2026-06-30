$ErrorActionPreference = 'Stop'

# 清理项目内安装产物与构建缓存
$pathsToRemove = @(
  'node_modules',
  'dist',
  'src-tauri\target',
  'tsconfig.app.tsbuildinfo',
  'tsconfig.node.tsbuildinfo',
  'vite.config.js',
  'vite.config.d.ts'
)

foreach ($relativePath in $pathsToRemove) {
  $projectRoot = Join-Path $PSScriptRoot '..'
  $fullPath = Join-Path $projectRoot $relativePath
  $resolvedPath = [System.IO.Path]::GetFullPath($fullPath)

  if (Test-Path -LiteralPath $resolvedPath) {
    Write-Host "Removing $resolvedPath"
    Remove-Item -LiteralPath $resolvedPath -Recurse -Force
  }
}

Write-Host 'Installing dependencies with pnpm...'
pnpm install
