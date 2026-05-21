param(
  [string]$Server = "http://localhost:8732",
  [string]$Tool = "",
  [string]$Args = "{}",
  [string]$Mode = "single",
  [string]$BatchFile = "",
  [int]$Timeout = 30,
  [switch]$ListTools,
  [switch]$Health
)

$ErrorActionPreference = "Stop"

function Invoke-Rpc {
  param([string]$Method, [string]$Endpoint, $Body = $null)
  try {
    $params = @{ Uri = "$Server$Endpoint"; Method = $Method; ContentType = "application/json"; }
    if ($Body) { $params.Body = ($Body | ConvertTo-Json -Compress) }
    $params.TimeoutSec = $Timeout
    return Invoke-RestMethod @params
  } catch {
    if ($_.Exception.InnerException -match "No connection|could not be resolved|refused") {
      Write-Host "ERROR: RPC server not running at $Server" -ForegroundColor Red
      Write-Host "Start it with: node scripts/rpc/rpc-server.js" -ForegroundColor Yellow
      exit 1
    }
    throw
  }
}

if ($Health) {
  $res = Invoke-Rpc -Method GET -Endpoint "/health"
  Write-Host "=== RPC Server Health ===" -ForegroundColor Cyan
  Write-Host "Status:       $($res.status)"
  Write-Host "Uptime:       $([math]::Round($res.uptime, 1))s"
  Write-Host "Tools:        $($res.tools.Count)"
  Write-Host "Requests:     $($res.requestCount)"
  exit 0
}

if ($ListTools) {
  $res = Invoke-Rpc -Method GET -Endpoint "/tools"
  Write-Host "=== Available Tools ($($res.tools.Count)) ===" -ForegroundColor Cyan
  foreach ($t in $res.tools) {
    Write-Host "`n$($t.name)" -ForegroundColor Green
    if ($t.parameters.properties) {
      foreach ($p in $t.parameters.properties.PSObject.Properties) {
        Write-Host "  -$($p.Name): $($p.Value.description)" -ForegroundColor Gray
      }
    }
  }
  exit 0
}

if ($Mode -eq "batch") {
  if (!$BatchFile -or !(Test-Path $BatchFile)) {
    Write-Host "ERROR: BatchFile required for batch mode: -BatchFile batch.json" -ForegroundColor Red
    exit 1
  }
  $batch = Get-Content $BatchFile -Raw | ConvertFrom-Json
  $body = @{ mode = $batch.mode; tasks = $batch.tasks; id = [guid]::NewGuid().ToString() }
  $res = Invoke-Rpc -Method POST -Endpoint "/rpc/batch" -Body $body
  Write-Host "=== Batch Results ($($res.results.Count) tasks, $($res.duration)ms) ===" -ForegroundColor Cyan
  for ($i = 0; $i -lt $res.results.Count; $i++) {
    Write-Host "`n--- Task $($i+1) ---" -ForegroundColor Yellow
    $res.results[$i] | ConvertTo-Json -Depth 3
  }
  exit 0
}

if ($Mode -eq "watch") {
  $body = @{ tool = $Tool; args = ($Args | ConvertFrom-Json); intervalMs = 5000; maxPolls = 6; id = [guid]::NewGuid().ToString() }
  $res = Invoke-Rpc -Method POST -Endpoint "/rpc/watch" -Body $body
  Write-Host "=== Watch Results ($($res.pollResults.Count) polls, $($res.duration)ms) ===" -ForegroundColor Cyan
  foreach ($pr in $res.pollResults) {
    Write-Host "`nPoll #$($pr.poll):" -ForegroundColor Yellow
    $pr.result | ConvertTo-Json -Depth 2
  }
  exit 0
}

if (!$Tool) {
  Write-Host "Usage: .\rpc-client.ps1 -Tool read_file -Args '{\"path\":\"config.json\"}'"
  Write-Host "       .\rpc-client.ps1 -ListTools"
  Write-Host "       .\rpc-client.ps1 -Health"
  Write-Host "       .\rpc-client.ps1 -Mode batch -BatchFile batch.json"
  Write-Host "       .\rpc-client.ps1 -Mode watch -Tool execute_command -Args '{\"command\":\"git status\"}'"
  exit 0
}

$body = @{ tool = $Tool; args = ($Args | ConvertFrom-Json); id = [guid]::NewGuid().ToString() }
$res = Invoke-Rpc -Method POST -Endpoint "/rpc" -Body $body
$res.result | ConvertTo-Json -Depth 3
