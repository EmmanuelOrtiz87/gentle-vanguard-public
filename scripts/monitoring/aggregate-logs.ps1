#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Aggregates structured JSONL logs from .session/logs/ into consumable metrics.
.DESCRIPTION
    Reads all {component}.jsonl files, computes per-component and per-level counts,
    time-series distribution, and error rate. Writes .session/logs/aggregate.json.
    Designed to be consumed by the dashboard health endpoint and CI reports.
.PARAMETER Live
    If set, outputs to stdout for live consumption (no file write).
.PARAMETER Watch
    If set, runs continuously every 60s, updating aggregate.json.
.EXAMPLE
    .\aggregate-logs.ps1
    .\aggregate-logs.ps1 -Live
    .\aggregate-logs.ps1 -Watch
#>
param(
    [switch]$Live,
    [switch]$Watch
)

$ErrorActionPreference = 'Stop'
$repoRoot = if ($env:GENTLE_VANGUARD_BASE_DIR) { $env:GENTLE_VANGUARD_BASE_DIR }
           else { $PSScriptRoot | Split-Path -Parent | Split-Path -Parent }

$logDir = Join-Path $repoRoot '.session' 'logs'
$outFile = Join-Path $repoRoot '.session' 'logs' 'aggregate.json'

function Invoke-Aggregate {
    if (-not (Test-Path $logDir)) {
        $result = @{ status = 'empty'; components = @{}; totals = @{}; since = $null; until = $null }
        if ($Live) { $result | ConvertTo-Json -Depth 5 }
        else { $result | ConvertTo-Json -Depth 5 | Set-Content $outFile }
        return
    }

    $files = Get-ChildItem $logDir -Filter '*.jsonl'
    $components = @{}
    $allTimestamps = @()
    $totalByLevel = @{ DEBUG = 0; INFO = 0; WARN = 0; ERROR = 0 }
    $totalEntries = 0

    foreach ($f in $files) {
        $comp = $f.BaseName  # e.g., "correction-capture" from "correction-capture.jsonl"
        $lines = Get-Content $f.FullName -ErrorAction SilentlyContinue
        $entries = @()
        $byLevel = @{ DEBUG = 0; INFO = 0; WARN = 0; ERROR = 0 }

        foreach ($line in $lines) {
            if (-not $line.Trim()) { continue }
            try {
                $obj = $line | ConvertFrom-Json -ErrorAction Stop
                $level = $obj.level
                if ($byLevel.ContainsKey($level)) { $byLevel[$level]++ }
                $totalByLevel[$level]++
                $totalEntries++
                if ($obj.timestamp) { $allTimestamps += $obj.timestamp }
                $entries += @{
                    timestamp = $obj.timestamp
                    level = $level
                    message = $obj.message
                    sessionId = $obj.sessionId
                }
            } catch {
                # Skip malformed lines
                $totalByLevel['WARN']++
            }
        }

        $components[$comp] = @{
            totalEntries = $lines.Count
            byLevel = $byLevel
            lastEntry = if ($entries.Count -gt 0) { $entries[-1] } else { $null }
            firstEntry = if ($entries.Count -gt 0) { $entries[0] } else { $null }
        }
    }

    $sortedTimestamps = $allTimestamps | Sort-Object
    $result = @{
        status = 'ok'
        generatedAt = (Get-Date -Format 'o')
        totals = @{
            totalEntries = $totalEntries
            byLevel = $totalByLevel
            errorRate = if ($totalEntries -gt 0) { [math]::Round(($totalByLevel.ERROR + $totalByLevel.WARN) / $totalEntries * 100, 1) } else { 0 }
        }
        components = $components
        since = if ($sortedTimestamps.Count -gt 0) { $sortedTimestamps[0] } else { $null }
        until = if ($sortedTimestamps.Count -gt 0) { $sortedTimestamps[-1] } else { $null }
        componentCount = $components.Keys.Count
        sessionCount = ($components.Values | ForEach-Object { $_.lastEntry.sessionId } | Where-Object { $_ } | Sort-Object -Unique).Count
    }

    if ($Live) {
        $result | ConvertTo-Json -Depth 5
    } else {
        $result | ConvertTo-Json -Depth 5 | Set-Content $outFile
        Write-Output "[OK] Aggregated $totalEntries entries from $($components.Keys.Count) components → $outFile"
    }
}

if ($Watch) {
    Write-Output "[WATCH] Monitoring $logDir every 60s... (Ctrl+C to stop)"
    while ($true) {
        Invoke-Aggregate
        Start-Sleep -Seconds 60
    }
} else {
    Invoke-Aggregate
}
