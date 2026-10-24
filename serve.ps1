# serve.ps1 - Python 없이 쓰는 간단한 로컬 웹 서버
$port = 8000
$root = (Get-Item -LiteralPath $PSScriptRoot).FullName
$rootPrefix = $root.TrimEnd('\') + '\'

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

Write-Host "서버 실행 중: http://localhost:$port/"
Write-Host "이 창을 닫으면 서버가 멈춥니다."
Start-Process "http://localhost:$port/"

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $req = $context.Request
    $res = $context.Response
    try {
      $urlPath = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath)
      if ($urlPath -eq '/') { $urlPath = '/index.html' }

      $relative = $urlPath.TrimStart('/') -replace '/', '\'
      $full = [System.IO.Path]::GetFullPath((Join-Path $root $relative))

      if ($full.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $full -PathType Leaf)) {
        $ext = [System.IO.Path]::GetExtension($full).ToLower()
        $type = $mime[$ext]
        if (-not $type) { $type = 'application/octet-stream' }
        $bytes = [System.IO.File]::ReadAllBytes($full)
        $res.StatusCode = 200
        $res.ContentType = $type
      } else {
        $res.StatusCode = 404
        $bytes = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
      }

      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
      Write-Host "$($res.StatusCode) $urlPath"
    } catch {
      $res.StatusCode = 500
    } finally {
      $res.Close()
    }
  }
} finally {
  $listener.Stop()
}
