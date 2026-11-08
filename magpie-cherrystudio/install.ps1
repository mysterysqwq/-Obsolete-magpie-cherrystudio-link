param([string]$MagpiePath = '')
$ErrorActionPreference = 'Stop'
if (-not $MagpiePath) {
  $found = Get-Command magpie -ErrorAction SilentlyContinue
  if ($found) { $MagpiePath = $found.Source }
  else {
    $candidate = Join-Path $env:LOCALAPPDATA 'Programs\magpie\magpie.com'
    if (Test-Path -LiteralPath $candidate) { $MagpiePath = $candidate }
  }
}
if (-not $MagpiePath -or -not (Test-Path -LiteralPath $MagpiePath)) {
  throw '没有找到 Magpie，请用 -MagpiePath 指定 magpie.com 的路径。'
}
$pluginPath = $PSScriptRoot
& $MagpiePath plugin add $pluginPath
if ($LASTEXITCODE -ne 0) { throw "Magpie 安装插件失败，退出码 $LASTEXITCODE" }
Write-Host '已安装。请在 Magpie 左侧打开「连接 Cherry Studio」。请保留这个文件夹，Magpie 从原位置加载插件。'
