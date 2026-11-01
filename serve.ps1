# FieldPack local web server for Windows. No installs needed (uses built-in PowerShell).
# Started by "Start FieldPack.bat". Close this window to stop the app.
param([int]$Port = 8080)

$root = (Split-Path -Parent $MyInvocation.MyCommand.Path).TrimEnd('\') + '\'
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.htm' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
  '.md'   = 'text/markdown; charset=utf-8'; '.txt' = 'text/plain; charset=utf-8'
  '.svg'  = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif'; '.ico' = 'image/x-icon'; '.webp' = 'image/webp'
  '.xlsx' = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}

# Find a free port, starting at $Port.
$listener = $null
foreach ($p in $Port..($Port + 20)) {
  $l = New-Object System.Net.HttpListener
  $l.Prefixes.Add("http://localhost:$p/")
  try { $l.Start(); $listener = $l; $Port = $p; break } catch { $l.Close() }
}
if (-not $listener) {
  Write-Host "Could not start a local server on ports $Port-$($Port + 20)." -ForegroundColor Red
  exit 1
}

$url = "http://localhost:$Port/"
Write-Host ""
Write-Host "  FieldPack is running at $url" -ForegroundColor Green
Write-Host "  Opening your browser... (use Chrome or Edge to save straight into Excel)"
Write-Host "  Close this window to stop FieldPack."
Write-Host ""
Start-Process $url

while ($listener.IsListening) {
  try { $ctx = $listener.GetContext() } catch { break }
  $res = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/').Replace('/', '\')
    if ($rel -eq '' -or $rel.EndsWith('\')) { $rel += 'index.html' }
    $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
    if ($full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $full -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($full)
      $ext = [IO.Path]::GetExtension($full).ToLower()
      if ($types.ContainsKey($ext)) { $res.ContentType = $types[$ext] } else { $res.ContentType = 'application/octet-stream' }
    } else {
      $res.StatusCode = 404
      $res.ContentType = 'text/plain; charset=utf-8'
      $bytes = [Text.Encoding]::UTF8.GetBytes('Not found')
    }
    $res.Headers.Add('Cache-Control', 'no-cache')
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch {
    # Ignore aborted requests (e.g. the browser cancelled a download).
  } finally {
    try { $res.Close() } catch {}
  }
}
