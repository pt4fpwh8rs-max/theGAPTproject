param([int]$Port = 8742)

$root = $PSScriptRoot
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root on http://localhost:$Port/"

$mime = @{
  '.html'='text/html; charset=utf-8'; '.css'='text/css'; '.js'='application/javascript';
  '.svg'='image/svg+xml'; '.png'='image/png'; '.ico'='image/x-icon';
  '.json'='application/json'; '.woff2'='font/woff2'; '.woff'='font/woff';
  '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.webp'='image/webp'; '.txt'='text/plain'
}

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request; $res = $ctx.Response
  try {
    $upath = $req.Url.AbsolutePath
    $full = Join-Path $root ($upath.TrimStart('/').Replace('/', '\'))
    if (Test-Path $full -PathType Container) { $full = Join-Path $full 'index.html' }
    if (Test-Path $full -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $res.ContentLength64 = [long]$bytes.LongLength
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
      $body = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
      $res.ContentLength64 = $body.LongLength
      $res.OutputStream.Write($body, 0, $body.Length)
    }
  } catch { Write-Host "ERR: $_" }
  finally { $res.Close() }
}
