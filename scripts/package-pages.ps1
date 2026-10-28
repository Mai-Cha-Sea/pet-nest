$ErrorActionPreference = 'Stop'
$pagesRoot = Split-Path $PSScriptRoot -Parent
$pagesBuild = Join-Path $pagesRoot 'dist'
if (-not (Test-Path -LiteralPath (Join-Path $pagesBuild 'index.html'))) {
  throw 'Run npm.cmd run build first.'
}
$pagesFiles = @(Get-ChildItem -LiteralPath $pagesBuild -Recurse -File -Force)
foreach ($pagesFile in $pagesFiles) {
  if ($pagesFile.Length -gt 25MB) { throw 'A file exceeds the Pages 25 MiB upload limit.' }
  if ($pagesFile.Name -notmatch '^(?:_headers|_redirects)$' -and $pagesFile.Extension -notmatch '^\.(?:html|js|css|png|jpg|jpeg|webp|svg|ico|woff2?|txt)$') {
    throw ('Unexpected file type in the upload directory: ' + $pagesFile.Name)
  }
}
$pagesArtifacts = Join-Path $pagesRoot 'artifacts\pages'
[System.IO.Directory]::CreateDirectory($pagesArtifacts) | Out-Null
$pagesStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$pagesArchive = Join-Path $pagesArtifacts ('pet-nest-pages-' + $pagesStamp + '.zip')
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$pagesWriter = [System.IO.Compression.ZipFile]::Open($pagesArchive, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($pagesFile in $pagesFiles) {
    $pagesRelative = $pagesFile.FullName.Substring($pagesBuild.Length + 1).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($pagesWriter, $pagesFile.FullName, $pagesRelative, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $pagesWriter.Dispose() }
$pagesZip = [System.IO.Compression.ZipFile]::OpenRead($pagesArchive)
try {
  if (-not ($pagesZip.Entries | Where-Object { $_.FullName -eq 'index.html' })) { throw 'The ZIP root must contain index.html.' }
  if (@($pagesZip.Entries | Where-Object { $_.Name }).Count -ne $pagesFiles.Count) { throw 'ZIP file count mismatch.' }
  if ($pagesZip.Entries | Where-Object { $_.FullName.Contains('\') }) { throw 'ZIP paths must use forward slashes.' }
} finally { $pagesZip.Dispose() }
$pagesManifest = [ordered]@{
  archive = $pagesArchive
  files = $pagesFiles.Count
  sha256 = (Get-FileHash -LiteralPath $pagesArchive -Algorithm SHA256).Hash.ToLowerInvariant()
  publicAssetsOnly = $true
  createdAt = [DateTime]::UtcNow.ToString('o')
}
$pagesManifestPath = Join-Path $pagesArtifacts 'latest-package.json'
[System.IO.File]::WriteAllText($pagesManifestPath, ($pagesManifest | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
$pagesManifest | ConvertTo-Json -Compress
