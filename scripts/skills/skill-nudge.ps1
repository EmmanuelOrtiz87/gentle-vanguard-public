param(
    [string]$SessionId = "",
    [string]$SessionDir = "",
    [switch]$Report
)

$ErrorActionPreference = "Stop"

$repoRoot = if ($env:GENTLE_VANGUARD_BASE_DIR) {
    $env:GENTLE_VANGUARD_BASE_DIR
} else {
    $root = Split-Path -Parent $PSScriptRoot
    while ($root -and -not (Test-Path (Join-Path $root ".git"))) {
        $root = Split-Path -Parent $root
    }
    if (-not $root) { $root = $PSScriptRoot }
    $root
}

if (-not $SessionDir) { $SessionDir = Join-Path $repoRoot ".session" }
if (-not $SessionId) { $SessionId = "session-$(Get-Date -Format 'yyyy-MM-dd-HHmm')" }

$usageDir = Join-Path $SessionDir "skill-usage"
$nudgeDir = Join-Path $SessionDir "skill-nudges"

function Ensure-Directory {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Get-NudgeSequence {
    $seqFile = Join-Path $nudgeDir ".sequence"
    $seq = 1
    if (Test-Path $seqFile) {
        try { $seq = [int](Get-Content $seqFile -Raw).Trim() + 1 } catch {}
    }
    $seq | Out-File -FilePath $seqFile -Encoding UTF8 -NoNewline
    return $seq
}

function Get-PreviousFailures {
    param([string]$SkillName)
    $nudgeFiles = Get-ChildItem $nudgeDir -Filter "*.json" -ErrorAction SilentlyContinue
    $total = 0
    foreach ($f in $nudgeFiles) {
        try {
            $n = Get-Content $f.FullName -Raw | ConvertFrom-Json
            if ($n.skillName -eq $SkillName -and $n.issueType -eq "failure_pattern") {
                $total++
            }
        } catch {}
    }
    return $total
}

function Get-RepeatedFixPattern {
    param([string]$SkillName)
    $nudgeFiles = Get-ChildItem $nudgeDir -Filter "*.json" -ErrorAction SilentlyContinue
    $patterns = @{}
    foreach ($f in $nudgeFiles) {
        try {
            $n = Get-Content $f.FullName -Raw | ConvertFrom-Json
            if ($n.skillName -eq $SkillName -and $n.fixPattern) {
                $key = $n.fixPattern
                if (-not $patterns.ContainsKey($key)) { $patterns[$key] = 0 }
                $patterns[$key]++
            }
        } catch {}
    }
    $max = 0; $worst = $null
    foreach ($k in $patterns.Keys) {
        if ($patterns[$k] -gt $max) { $max = $patterns[$k]; $worst = $k }
    }
    return @{ Pattern = $worst; Count = $max }
}

function Write-Nudge {
    param(
        [string]$SkillName,
        [string]$IssueType,
        [string]$Evidence,
        [string]$FixPattern,
        [bool]$Urgent
    )
    Ensure-Directory $nudgeDir
    $seq = Get-NudgeSequence
    $date = Get-Date -Format "yyyyMMdd"
    $nudgeId = "nudge-$date-$( '{0:D3}' -f $seq )"
    $nudge = @{
        nudgeId    = $nudgeId
        date       = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
        skillName  = $SkillName
        trigger    = "auto"
        issueType  = $IssueType
        evidence   = $Evidence
        fixPattern = $FixPattern
        urgent     = $Urgent
        applied    = $false
    }
    $path = Join-Path $nudgeDir "$nudgeId.json"
    $nudge | ConvertTo-Json -Depth 4 | Out-File -FilePath $path -Encoding UTF8
    Write-Host "[NUDGE] Created $nudgeId ($IssueType, urgent=$Urgent)" -ForegroundColor Magenta
    return $nudge
}

function Invoke-NudgeGeneration {
    Ensure-Directory $usageDir
    Ensure-Directory $nudgeDir

    $usageFiles = Get-ChildItem $usageDir -Filter "*.json" -ErrorAction SilentlyContinue
    if ($usageFiles.Count -eq 0) {
        Write-Host "[INFO] No usage data found in $usageDir" -ForegroundColor Cyan
        return
    }

    $today = (Get-Date).Date
    $sessionFailures = @{}
    $allMetrics = @()

    foreach ($f in $usageFiles) {
        try {
            $m = Get-Content $f.FullName -Raw | ConvertFrom-Json
            $allMetrics += $m
            $lastUse = if ($m.lastUsedAt) {
                try { [DateTime]$m.lastUsedAt } catch { $null }
            } else { $null }
            if ($lastUse -and $lastUse.Date -eq $today -and $m.lastOutcome -eq "failure") {
                if (-not $sessionFailures.ContainsKey($m.skillName)) {
                    $sessionFailures[$m.skillName] = @{ failures = 0; hasFailures = $false }
                }
                $sessionFailures[$m.skillName].failures++
                $sessionFailures[$m.skillName].hasFailures = $true
            }
            if ($m.failureCount -gt 0) {
                if (-not $sessionFailures.ContainsKey($m.skillName)) {
                    $sessionFailures[$m.skillName] = @{ failures = 0; hasFailures = $true }
                }
                $sessionFailures[$m.skillName].hasFailures = $true
            }
        } catch {
            Write-Warning "Failed to parse $($f.Name): $_"
        }
    }

    $nudgesGenerated = 0
    foreach ($m in $allMetrics) {
        $name = $m.skillName
        $sf = $sessionFailures[$name]
        if (-not $sf) { continue }

        $pastCount = Get-PreviousFailures $name
        $repeated = Get-RepeatedFixPattern $name

        # Condition 1: failures in current session
        if ($sf.hasFailures -and $m.failureCount -gt 0) {
            $evidence = "$($m.failureCount) total failures (historical), $($sf.failures) in current session"
            $fixPattern = switch ($m.failurePatterns[0].errorType) {
                "timeout" { "Add timeout configuration and retry logic" }
                "syntax" { "Add syntax validation before execution" }
                "logic" { "Review conditional logic and edge cases" }
                "missing_dependency" { "Add dependency check at start of skill execution" }
                default { "Review failure patterns and update SKILL.md with known issues" }
            }
            $isUrgent = $false
            # Urgent if same failure across 3+ sessions
            if ($pastCount -ge 3) { $isUrgent = $true }
            # Urgent if success rate below 0.5 after 5+ attempts
            if ($m.useCount -ge 5 -and $m.successRate -lt 0.5) { $isUrgent = $true }
            Write-Nudge $name "failure_pattern" $evidence $fixPattern $isUrgent
            $nudgesGenerated++
        }

        # Condition 2: declining rate (10+ uses, rate < 0.7)
        if ($m.useCount -ge 10 -and $m.successRate -lt 0.7) {
            $evidence = "Success rate $($m.successRate) after $($m.useCount) uses"
            $isUrgent = ($m.successRate -lt 0.4)
            Write-Nudge $name "declining_rate" $evidence "Review skill triggers and core rules for accuracy" $isUrgent
            $nudgesGenerated++
        }

        # Condition 3: underused (never used and file is older than 7 days)
        if ($m.useCount -le 1 -and $m.lastUsedAt -eq $null) {
            $metricFile = Join-Path $usageDir "$name.json"
            if (Test-Path $metricFile) {
                $age = (Get-Date) - (Get-Item $metricFile).CreationTime
                if ($age.TotalDays -gt 7) {
                    $evidence = "Never used in $([math]::Round($age.TotalDays)) days since metrics file created"
                    Write-Nudge $name "underused" $evidence "Check if skill triggers are too narrow or skill is deprecated" $false
                    $nudgesGenerated++
                }
            }
        }
    }

    Write-Host "[OK] Generated $nudgesGenerated nudges in $nudgeDir" -ForegroundColor Cyan
}

function Invoke-Report {
    $nudgeFiles = Get-ChildItem $nudgeDir -Filter "*.json" -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne ".sequence" } |
        Sort-Object LastWriteTime -Descending

    if ($nudgeFiles.Count -eq 0) {
        Write-Host "[INFO] No nudges found" -ForegroundColor Cyan
        return
    }

    Write-Host "`n=== Skill Nudge Report ===" -ForegroundColor Cyan
    Write-Host ("{0,-30} {1,-20} {2,-10} {3,-8} {4}" -f "NudgeId", "Skill", "Type", "Urgent", "Applied")
    Write-Host ("{0,-30} {1,-20} {2,-10} {3,-8} {4}" -f "-------", "-----", "----", "------", "-------")
    $urgentCount = 0
    $pendingCount = 0
    foreach ($f in $nudgeFiles) {
        try {
            $n = Get-Content $f.FullName -Raw | ConvertFrom-Json
            $urgent = if ($n.urgent) { "yes" } else { "no" }
            $applied = if ($n.applied) { "yes" } else { "no" }
            if ($n.urgent) { $urgentCount++ }
            if (-not $n.applied) { $pendingCount++ }
            Write-Host ("{0,-30} {1,-20} {2,-10} {3,-8} {4}" -f $n.nudgeId, $n.skillName, $n.issueType, $urgent, $applied)
        } catch {}
    }
    Write-Host "`nTotal: $($nudgeFiles.Count) | Urgent: $urgentCount | Pending: $pendingCount" -ForegroundColor Cyan
}

if ($Report) {
    Invoke-Report
    exit 0
}

Invoke-NudgeGeneration
exit 0
