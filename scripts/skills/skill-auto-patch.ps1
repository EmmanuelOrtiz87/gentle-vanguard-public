param(
    [switch]$AutoApply,
    [string]$SkillName = "",
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

$nudgeDir = Join-Path $repoRoot ".session" "skill-nudges"
$skillsDir = Join-Path $repoRoot "skills"

function Write-PatchLog {
    param([string]$Message, [string]$Level = "INFO")
    $color = switch ($Level) {
        "OK" { "Green" }
        "WARN" { "Yellow" }
        "ERROR" { "Red" }
        "APPLY" { "Magenta" }
        default { "Cyan" }
    }
    Write-Host "[$Level] $Message" -ForegroundColor $color
}

function Get-PendingNudges {
    $nudgeFiles = Get-ChildItem $nudgeDir -Filter "*.json" -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne ".sequence" }

    $pending = @()
    foreach ($f in $nudgeFiles) {
        try {
            $n = Get-Content $f.FullName -Raw | ConvertFrom-Json
            if ($n.applied) { continue }
            if ($SkillName -and $n.skillName -ne $SkillName) { continue }
            $pending += @{ Nudge = $n; Path = $f.FullName }
        } catch {
            Write-PatchLog "Failed to parse $($f.Name): $_" "WARN"
        }
    }
    return $pending
}

function Get-SkillMdPath {
    param([string]$SkillName)
    # Direct path
    $direct = Join-Path $skillsDir "$SkillName" "SKILL.md"
    if (Test-Path $direct) { return $direct }
    # Lowercase alternative
    $lower = Join-Path $skillsDir "$SkillName" "skill.md"
    if (Test-Path $lower) { return $lower }
    # Search subdirectories
    $dirs = Get-ChildItem $skillsDir -Directory -ErrorAction SilentlyContinue
    foreach ($d in $dirs) {
        $mdPath = Join-Path $d.FullName "SKILL.md"
        $dirName = (Get-Item $d).Name
        if ($dirName -eq $SkillName -or $dirName -eq "$SkillName-skill") {
            if (Test-Path $mdPath) { return $mdPath }
        }
    }
    return $null
}

function Add-FailureSectionToSkill {
    param(
        [string]$MdPath,
        [string]$FixPattern,
        [string]$SkillName,
        [array]$Failures
    )
    $content = Get-Content $MdPath -Raw

    $hasIssues = $content -match "## Known Issues"
    $hasFailures = $content -match "## Failure Patterns"
    if ($hasIssues -or $hasFailures) {
        Write-PatchLog "$SkillName already has Known Issues / Failure Patterns section" "WARN"
        return $false
    }

    $sectionLines = @(
        "`n## Known Issues"
        ""
        "The following failure pattern has been detected and documented automatically:"
        ""
        "- **Issue**: $FixPattern"
    )

    if ($Failures.Count -gt 0) {
        $distinct = $Failures | Group-Object errorType | ForEach-Object { $_.Name }
        $sectionLines += "- **Error types observed**: $($distinct -join ', ')"
    }

    $sectionLines += ""
    $sectionLines += "> Auto-documented by skill-auto-patch.ps1 on $(Get-Date -Format 'yyyy-MM-dd')."

    $newContent = $content.TrimEnd() + "`n" + ($sectionLines -join "`n") + "`n"
    $newContent | Out-File -FilePath $MdPath -Encoding UTF8 -NoNewline
    return $true
}

function Invoke-AutoPatch {
    $pending = Get-PendingNudges
    if ($pending.Count -eq 0) {
        Write-PatchLog "No pending nudges to process" "OK"
        return @()
    }

    $applied = @()
    foreach ($entry in $pending) {
        $n = $entry.Nudge
        $nudgePath = $entry.Path
        Write-PatchLog "Evaluating $($n.nudgeId) ($($n.skillName), $($n.issueType))" "INFO"

        $shouldApply = $false
        $reason = ""

        if ($n.urgent) {
            $shouldApply = $true
            $reason = "urgent flag set"
        } elseif ($AutoApply) {
            $shouldApply = $true
            $reason = "-AutoApply flag"
        } else {
            # Check if same fixPattern appears 2+ times
            $samePattern = $pending | Where-Object {
                $_.Nudge.skillName -eq $n.skillName -and
                $_.Nudge.fixPattern -eq $n.fixPattern -and
                $_.Nudge.nudgeId -ne $n.nudgeId
            }
            if ($samePattern.Count -ge 1) {
                $shouldApply = $true
                $reason = "fixPattern repeated $($samePattern.Count + 1) times"
            }
        }

        if (-not $shouldApply) {
            Write-PatchLog "Skipping $($n.nudgeId) — not urgent, use -AutoApply" "WARN"
            $applied += @{
                nudgeId = $n.nudgeId
                skill   = $n.skillName
                action  = "skipped"
                reason  = "not urgent, use -AutoApply"
            }
            continue
        }

        $mdPath = Get-SkillMdPath $n.skillName
        if (-not $mdPath) {
            Write-PatchLog "SKILL.md not found for $($n.skillName)" "ERROR"
            $applied += @{
                nudgeId = $n.nudgeId
                skill   = $n.skillName
                action  = "failed"
                reason  = "SKILL.md not found"
            }
            continue
        }

        Write-PatchLog "Applying patch to $mdPath" "APPLY"

        $failures = @()
        $usagePath = Join-Path (Join-Path $repoRoot ".session" "skill-usage") "$($n.skillName).json"
        if (Test-Path $usagePath) {
            try {
                $um = Get-Content $usagePath -Raw | ConvertFrom-Json
                $failures = @($um.failurePatterns)
            } catch {}
        }

        $patched = Add-FailureSectionToSkill $mdPath $n.fixPattern $n.skillName $failures
        if ($patched) {
            # Mark nudge as applied
            $n.applied = $true
            $n | ConvertTo-Json -Depth 4 | Out-File -FilePath $nudgePath -Encoding UTF8
            Write-PatchLog "Patched $($n.skillName) with: $($n.fixPattern)" "APPLY"
            $applied += @{
                nudgeId = $n.nudgeId
                skill   = $n.skillName
                action  = "patched"
                reason  = $reason
            }
        } else {
            $applied += @{
                nudgeId = $n.nudgeId
                skill   = $n.skillName
                action  = "skipped"
                reason  = "section already exists"
            }
        }
    }

    return $applied
}

function Invoke-Report {
    $nudgeFiles = Get-ChildItem $nudgeDir -Filter "*.json" -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne ".sequence" }

    if ($nudgeFiles.Count -eq 0) {
        Write-PatchLog "No nudge files found" "INFO"
        return
    }

    Write-PatchLog "=== Auto-Patch Dry Run ===" "INFO"
    $toApply = @()
    foreach ($f in $nudgeFiles) {
        try {
            $n = Get-Content $f.FullName -Raw | ConvertFrom-Json
            if ($n.applied) { continue }
            if ($SkillName -and $n.skillName -ne $SkillName) { continue }
            $mdPath = Get-SkillMdPath $n.skillName
            $canPatch = ($n.urgent -or $AutoApply -or $false)
            $mdExists = if ($mdPath) { "found" } else { "NOT FOUND" }
            $toApply += @{
                nudgeId   = $n.nudgeId
                skill     = $n.skillName
                issueType = $n.issueType
                urgent    = $n.urgent
                fix       = $n.fixPattern
                skillMd   = $mdExists
                wouldPatch = $canPatch -or $n.urgent
            }
        } catch {}
    }

    if ($toApply.Count -eq 0) {
        Write-PatchLog "No pending nudges matching criteria" "OK"
        return
    }

    Write-Host ("{0,-30} {1,-20} {2,-12} {3,-8} {4,-12} {5}" -f "Nudge", "Skill", "Type", "Urgent", "SKILL.md", "Would Patch")
    Write-Host ("{0,-30} {1,-20} {2,-12} {3,-8} {4,-12} {5}" -f "-----", "-----", "----", "------", "-------", "-----------")
    $wouldPatchCount = 0
    foreach ($t in $toApply) {
        $urgent = if ($t.urgent) { "yes" } else { "no" }
        $wp = if ($t.wouldPatch) { "yes" } else { "no-dry" }
        if ($t.wouldPatch) { $wouldPatchCount++ }
        Write-Host ("{0,-30} {1,-20} {2,-12} {3,-8} {4,-12} {5}" -f $t.nudgeId, $t.skill, $t.issueType, $urgent, $t.skillMd, $wp)
    }
    Write-PatchLog "$($toApply.Count) pending, $wouldPatchCount would be applied" "INFO"
}

if ($Report) {
    Invoke-Report
    exit 0
}

$results = Invoke-AutoPatch
$patched = $results | Where-Object { $_.action -eq "patched" }
$skipped = $results | Where-Object { $_.action -eq "skipped" }
$failed = $results | Where-Object { $_.action -eq "failed" }

Write-PatchLog "Results: $($patched.Count) patched, $($skipped.Count) skipped, $($failed.Count) failed" "OK"

if ($patched.Count -gt 0) {
    Write-PatchLog "Patched skills:" "OK"
    foreach ($p in $patched) {
        Write-PatchLog "  - $($p.skill) ($($p.reason))" "OK"
    }
}

exit 0
