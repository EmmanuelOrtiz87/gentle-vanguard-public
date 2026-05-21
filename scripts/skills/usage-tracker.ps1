param(
    [string]$SkillName = "",
    [ValidateSet("increment", "fail", "record", "")]
    [string]$Action = "",
    [ValidateSet("success", "failure", "")]
    [string]$Outcome = "",
    [int]$TokenCount = 0,
    [ValidateSet("timeout", "syntax", "logic", "missing_dependency", "")]
    [string]$ErrorType = "",
    [string]$Description = "",
    [switch]$Nudge,
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

$usageDir = Join-Path $repoRoot ".session" "skill-usage"
$nudgeDir = Join-Path $repoRoot ".session" "skill-nudges"

function Ensure-Directory {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Get-InitialMetric {
    param([string]$Name)
    return @{
        skillName      = $Name
        useCount       = 0
        lastUsedAt     = $null
        failureCount   = 0
        failurePatterns = @()
        avgTokensUsed  = 0
        successRate    = 1.0
        lastOutcome    = $null
    }
}

function Get-SkillList {
    $registry = Join-Path $repoRoot ".atl" "skill-registry.md"
    if (-not (Test-Path $registry)) {
        return @()
    }
    $content = Get-Content $registry -Raw
    $skills = @()
    $pattern = [regex]'(?<=\|\s)[a-z][a-z0-9_-]+(?=\s+\|)'
    $matches = $pattern.Matches($content)
    foreach ($m in $matches) {
        $s = $m.Value.Trim()
        if ($s -and $s.Length -gt 2 -and $s -ne "Name" -and $s -ne "Skill" -and $s -ne "Agent") {
            $skills += $s
        }
    }
    return ($skills | Sort-Object -Unique)
}

function Read-Metric {
    param([string]$Name)
    $path = Join-Path $usageDir "$Name.json"
    if (Test-Path $path) {
        try {
            return Get-Content $path -Raw | ConvertFrom-Json
        } catch {
            Write-Warning "Corrupt metric for $Name, reinitializing"
        }
    }
    return $null
}

function Save-Metric {
    param([string]$Name, $Metric)
    $path = Join-Path $usageDir "$Name.json"
    $Metric | ConvertTo-Json -Depth 4 | Out-File -FilePath $path -Encoding UTF8
}

function Invoke-Increment {
    param([string]$Name)
    $metric = Read-Metric $Name
    if (-not $metric) { $metric = Get-InitialMetric $Name }
    $metric.useCount++
    $metric.lastUsedAt = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
    if ($Outcome) { $metric.lastOutcome = $Outcome }
    if ($TokenCount -gt 0) {
        $total = ($metric.avgTokensUsed * ($metric.useCount - 1)) + $TokenCount
        $metric.avgTokensUsed = [math]::Round($total / $metric.useCount, 1)
    }
    Save-Metric $Name $metric
    Write-Host "[OK] $Name incremented (uses: $($metric.useCount))" -ForegroundColor Green
}

function Invoke-Fail {
    param([string]$Name)
    $metric = Read-Metric $Name
    if (-not $metric) { $metric = Get-InitialMetric $Name }
    $metric.useCount++
    $metric.failureCount++
    $metric.lastUsedAt = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
    $metric.lastOutcome = "failure"
    $totalUses = $metric.useCount
    $totalFails = $metric.failureCount
    $metric.successRate = [math]::Round(1.0 - ($totalFails / [math]::Max($totalUses, 1)), 2)
    if ($ErrorType -and $Description) {
        $entry = @{
            timestamp   = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
            errorType   = $ErrorType
            description = $Description
            fixApplied  = $null
        }
        $metric.failurePatterns += $entry
    }
    Save-Metric $Name $metric
    Write-Host "[WARN] $Name failed (failures: $($metric.failureCount))" -ForegroundColor Yellow
    if ($metric.failureCount % 3 -eq 0) {
        Write-Host "[NUDGE] $Name has $($metric.failureCount) failures — consider running skill-nudge.ps1" -ForegroundColor Magenta
    }
}

function Invoke-Record {
    param([string]$Name)
    $metric = Read-Metric $Name
    if (-not $metric) { $metric = Get-InitialMetric $Name }
    $metric.lastUsedAt = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
    if ($Outcome) { $metric.lastOutcome = $Outcome }
    if ($TokenCount -gt 0) {
        $total = ($metric.avgTokensUsed * $metric.useCount) + $TokenCount
        $metric.useCount++
        $metric.avgTokensUsed = [math]::Round($total / $metric.useCount, 1)
    }
    Save-Metric $Name $metric
    Write-Host "[OK] $Name recorded" -ForegroundColor Green
}

function Invoke-Scan {
    Ensure-Directory $usageDir
    $skills = Get-SkillList
    $created = 0
    foreach ($s in $skills) {
        $metric = Read-Metric $s
        if (-not $metric) {
            Save-Metric $s (Get-InitialMetric $s)
            $created++
        }
    }
    Write-Host "[OK] Scanned $($skills.Count) skills, created $created new metric files" -ForegroundColor Cyan
}

function Invoke-NudgeCheck {
    Ensure-Directory $usageDir
    $files = Get-ChildItem $usageDir -Filter "*.json"
    $nudges = @()
    foreach ($f in $files) {
        try {
            $m = Get-Content $f.FullName -Raw | ConvertFrom-Json
            if ($m.failureCount -ge 3) {
                $nudges += @{
                    skillName = $m.skillName
                    failures  = $m.failureCount
                    rate      = $m.successRate
                    reason    = "3+ failures in session"
                }
            }
            if ($m.useCount -ge 10 -and $m.successRate -lt 0.7) {
                $nudges += @{
                    skillName = $m.skillName
                    failures  = $m.failureCount
                    rate      = $m.successRate
                    reason    = "Declining success rate ($($m.successRate)) after $($m.useCount) uses"
                }
            }
        } catch {
            Write-Warning "Failed to parse $($f.Name): $_"
        }
    }
    if ($nudges.Count -eq 0) {
        Write-Host "[OK] No nudge conditions detected" -ForegroundColor Green
        return
    }
    Write-Host "[NUDGE] $($nudges.Count) nudge conditions found:" -ForegroundColor Magenta
    foreach ($n in $nudges) {
        Write-Host "  - $($n.skillName): $($n.reason)" -ForegroundColor Yellow
    }
}

function Invoke-Report {
    Ensure-Directory $usageDir
    $files = Get-ChildItem $usageDir -Filter "*.json" | Sort-Object Name
    if ($files.Count -eq 0) {
        Write-Host "[INFO] No usage data found. Run scan first." -ForegroundColor Cyan
        return
    }
    Write-Host "`n=== Skill Usage Report ===" -ForegroundColor Cyan
    Write-Host ("{0,-30} {1,8} {2,9} {3,10} {4,8}" -f "Skill", "Uses", "Failures", "Rate", "Last")
    Write-Host ("{0,-30} {1,8} {2,9} {3,10} {4,8}" -f "----", "----", "--------", "----", "----")
    foreach ($f in $files) {
        try {
            $m = Get-Content $f.FullName -Raw | ConvertFrom-Json
            $last = if ($m.lastUsedAt) { ($m.lastUsedAt -split "T")[0] } else { "never" }
            $rate = if ($m.successRate -ne $null) { "{0:P0}" -f $m.successRate } else { "-" }
            Write-Host ("{0,-30} {1,8} {2,9} {3,10} {4,8}" -f $m.skillName, $m.useCount, $m.failureCount, $rate, $last)
        } catch {
            Write-Warning "Failed to parse $($f.Name): $_"
        }
    }
    Write-Host "`nTotal files: $($files.Count)" -ForegroundColor Cyan
}

Ensure-Directory $usageDir
Ensure-Directory $nudgeDir

if ($Report) {
    Invoke-Report
    exit 0
}

if ($Nudge) {
    Invoke-NudgeCheck
    exit 0
}

if (-not $SkillName) {
    Invoke-Scan
    exit 0
}

if ($Action -eq "increment") {
    Invoke-Increment $SkillName
} elseif ($Action -eq "fail") {
    Invoke-Fail $SkillName
} elseif ($Action -eq "record") {
    Invoke-Record $SkillName
} else {
    $metric = Read-Metric $SkillName
    if (-not $metric) {
        Save-Metric $SkillName (Get-InitialMetric $SkillName)
        Write-Host "[OK] Created initial metric for $SkillName" -ForegroundColor Green
    } else {
        Write-Host "[OK] ${SkillName}: $($metric.useCount) uses, $($metric.failureCount) failures, rate $($metric.successRate)" -ForegroundColor Cyan
    }
}

exit 0
