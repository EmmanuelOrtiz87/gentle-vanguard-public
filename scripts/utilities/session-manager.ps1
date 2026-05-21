# session-manager.ps1
# Gestor de sesiones para gentle-vanguard

param(
    [ValidateSet('AutoStart', 'Manual', 'Health', 'End', 'Cleanup')]
    [string]$Mode = 'Manual',
    [string]$ProjectName = 'workspace_gentle_vanguard',
    [string]$SessionDir = '.\.session',
    [string]$TargetSessionId = '',
    [switch]$AllowCloseWithOtherActive,
    [int]$OrphanMaxAgeHours = 24,
    [switch]$SkipPreCloseValidation,
    [switch]$NoExit
)

$ErrorActionPreference = 'Continue'

$repoRoot = if ($env:GENTLE_VANGUARD_BASE_DIR -and (Test-Path $env:GENTLE_VANGUARD_BASE_DIR)) { $env:GENTLE_VANGUARD_BASE_DIR } else {
    $root = Split-Path -Parent $PSScriptRoot
    while ($root -and -not (Test-Path (Join-Path $root 'config'))) { $root = Split-Path -Parent $root }
    if (-not $root) { $root = $PSScriptRoot }
    $root
}

$engramSafeScript = Join-Path $repoRoot 'scripts\utilities\engram-safe.ps1'
if (Test-Path $engramSafeScript) {
    . $engramSafeScript
}

function Write-Status {
    param([string]$Message)
    Write-Host "[SESSION] $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[WARNING] $Message" -ForegroundColor Yellow
}

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Write-ErrorMsg {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Get-ValidSessionEntries {
    $sessionFiles = Get-ChildItem -Path $fullSessionDir -Filter "session-*.json" -ErrorAction SilentlyContinue |
                    Sort-Object -Property LastWriteTime -Descending

    $entries = @()
    foreach ($file in $sessionFiles) {
        try {
            $data = Get-Content -Path $file.FullName -Raw | ConvertFrom-Json
            $entries += [pscustomobject]@{
                File = $file
                Data = $data
            }
        }
        catch {
            Write-Warn "Corrupt session file ignored: $($file.Name)"
        }
    }

    return $entries
}

function Save-SessionBriefArtifacts {
    param(
        [string]$SessionId,
        [string]$StartTime,
        [string]$Mode,
        [string]$Project
    )

    $logsDir = Join-Path $repoRoot 'logs'
    if (-not (Test-Path $logsDir)) {
        New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
    }

    $branch = (& git -C $repoRoot rev-parse --abbrev-ref HEAD 2>$null)
    if ([string]::IsNullOrWhiteSpace($branch)) {
        $branch = 'unknown'
    }

    $sessionBrief = @{ 
        SessionId = $SessionId
        StartTime = $StartTime
        TaskName = ''
        Repository = $repoRoot
        Branch = $branch
        Status = 'ACTIVE'
        Mode = $Mode
        Project = $Project
    }

    $sessionBriefPath = Join-Path $logsDir "$SessionId.json"
    $sessionBrief | ConvertTo-Json | Set-Content -Path $sessionBriefPath -Encoding UTF8

    $activeSessionPath = Join-Path $logsDir '.session-active'
    @{ 
        SessionId = $SessionId
        StartTime = $StartTime
        TaskName = ''
        Mode = $Mode
        Project = $Project
    } | ConvertTo-Json | Set-Content -Path $activeSessionPath -Encoding UTF8
}

function Complete-Script {
    param([int]$ExitCode = 0)

    if ($NoExit) {
        return $ExitCode
    }

    exit $ExitCode
}

function Save-ToEngram {
    param(
        [string]$Title,
        [string]$Content,
        [string]$Type = 'manual'
    )

    if (-not (Get-Command Invoke-Gentle-VanguardEngram -ErrorAction SilentlyContinue)) {
        Write-Info "Engram not available, skipping memory save (non-critical)"
        return $false
    }

    $result = Invoke-Gentle-VanguardEngram -RepoRoot $repoRoot -Arguments @('save', $Title, $Content, '--project', $ProjectName, '--type', $Type)
    if ($result.Success) {
        Write-Info "Engram memory saved: $Title"
        return $true
    }

    Write-Info "Engram save skipped (non-critical): $($result.Output | Out-String)"
    return $false
}

$repoRoot = if ($env:GENTLE_VANGUARD_BASE_DIR) { $env:GENTLE_VANGUARD_BASE_DIR } else {
    $root = Split-Path -Parent $PSScriptRoot
    while ($root -and -not (Test-Path (Join-Path $root 'config'))) { $root = Split-Path -Parent $root }
    if (-not $root) { $root = $PSScriptRoot }
    $root
}
$fullSessionDir = Join-Path $repoRoot $SessionDir.TrimStart('.\')

if (-not (Test-Path $fullSessionDir)) {
    New-Item -ItemType Directory -Path $fullSessionDir -Force | Out-Null
    Write-Info "Created session directory: $fullSessionDir"
}

function Clear-OrphanedSessions {
    param([int]$MaxAgeHours = 24)

    Write-Status "Checking for orphaned sessions..."

    $sessionFiles = Get-ChildItem -Path $fullSessionDir -Filter "session-*.json" -ErrorAction SilentlyContinue
    if ($sessionFiles.Count -eq 0) {
        Write-Info "No session files found"
        return @{ cleaned = 0; kept = 0 }
    }

    $cleaned = 0
    $kept = 0
    $cutoff = (Get-Date).AddHours(-$MaxAgeHours)

    foreach ($file in $sessionFiles) {
        $data = $null
        try {
            $data = Get-Content -Path $file.FullName -Raw | ConvertFrom-Json
        }
        catch {
            Write-Warn "Corrupt session file (will archive): $($file.Name)"
            $archiveDir = Join-Path $fullSessionDir "archive"
            if (-not (Test-Path $archiveDir)) { New-Item -ItemType Directory -Path $archiveDir -Force | Out-Null }
            Move-Item -Path $file.FullName -Destination (Join-Path $archiveDir $file.Name) -Force
            $cleaned++
            continue
        }

        if ($data.status -eq 'active') {
            $startTime = $null
            if ($data.startTime) {
                try { $startTime = [DateTime]::Parse($data.startTime) } catch { }
            }

            if ($null -eq $startTime) {
                $startTime = $file.LastWriteTime
            }

            if ($startTime -lt $cutoff) {
                $updatedData = @{
                    sessionId = $data.sessionId
                    project = $data.project
                    mode = $data.mode
                    startTime = $data.startTime
                    version = if ($data.PSObject.Properties['version']) { $data.version } else { '1.0' }
                    status = "orphaned"
                    orphanedAt = (Get-Date).ToString("o")
                    orphanedReason = "Session left active > $MaxAgeHours hours"
                }
                $updatedData | ConvertTo-Json | Out-File -FilePath $file.FullName -Encoding UTF8
                Write-Warn "Orphaned session closed: $($data.sessionId) (age: $([Math]::Round(($cutoff - $startTime).TotalHours * -1, 1))h)"
                $cleaned++
            } else {
                $kept++
            }
        } else {
            $kept++
        }
    }

    Write-Status "Orphan cleanup: $cleaned closed, $kept active/recent"
    return @{ cleaned = $cleaned; kept = $kept }
}

function Initialize-Session {
    param([string]$Mode)

    Write-Status "Initializing session in $Mode mode"

    Clear-OrphanedSessions -MaxAgeHours $OrphanMaxAgeHours | Out-Null

    $date = Get-Date -Format "yyyy-MM-dd"
    $sessionNumber = (Get-ChildItem -Path $fullSessionDir -Filter "session-$date-*.json" -ErrorAction SilentlyContinue | Measure-Object).Count + 1
    $sessionId = "session-$date-$($sessionNumber.ToString('D2'))"

    $sessionFile = Join-Path $fullSessionDir "$sessionId.json"

    $sessionData = @{
        sessionId = $sessionId
        project = $ProjectName
        mode = $Mode
        startTime = Get-Date -Format "o"
        status = "active"
        version = "2.0"
        authRequired = $false
        authAuthenticated = $false
    }

    $sessionData | ConvertTo-Json | Out-File -FilePath $sessionFile -Encoding UTF8
    Save-SessionBriefArtifacts -SessionId $sessionId -StartTime $sessionData.startTime -Mode $Mode -Project $ProjectName

    Write-Status "Session initialized: $sessionId"
    Write-Info "Session file: $sessionFile"
    $null = Save-ToEngram -Title "Session start: $sessionId" -Content "Session $sessionId started in $Mode mode for project $ProjectName." -Type 'session'

    $enforcerScript = Join-Path $repoRoot 'scripts\utilities\karpathy-enforcer.ps1'
    if (-not (Test-Path $enforcerScript)) {
        $enforcerScript = Join-Path $repoRoot 'scripts\adaptive\karpathy-enforcer.ps1'
    }
    if (Test-Path $enforcerScript) {
        $verboseFlag = $VerbosePreference -eq "Continue"
        & $enforcerScript -Trigger session-start -AutoFix -VerboseOutput:$verboseFlag
        Write-Info "Karpathy baseline completed"
    } else {
        Write-Warn "Karpathy enforcer not found, skipping..."
    }

    $learnerScript = Join-Path $repoRoot 'scripts\adaptive\auto-norm-learner.ps1'
    if (Test-Path $learnerScript) {
        $verboseFlag = $VerbosePreference -eq "Continue"
        & $learnerScript -Trigger session-start -VerboseOutput:$verboseFlag
        Write-Info "Norm learner completed"
    } else {
        Write-Warn "Norm learner not found, skipping..."
    }

    $authScript = Join-Path $repoRoot 'scripts\utilities\auth-session.ps1'
    if (Test-Path $authScript) {
        Write-Status "Checking auth session integrity..."
        & $authScript -ManageAuth status -AsJson 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Info "Auth integrity check passed"
        } else {
            Write-Warn "Auth integrity check returned exit code $LASTEXITCODE"
        }
    }

    return $sessionId
}

function Get-SessionHealth {
    Write-Status "Checking session health..."

    $sessionEntries = @(Get-ValidSessionEntries)

    if ($sessionEntries.Count -eq 0) {
        Write-Warn "No active sessions found"
        return $false
    }

    $latestSession = $sessionEntries | Select-Object -First 1
    $sessionData = $latestSession.Data

    Write-Info "Latest session: $($sessionData.sessionId)"
    Write-Info "Status: $($sessionData.status)"
    Write-Info "Started: $($sessionData.startTime)"

    $activeCount = @($sessionEntries | Where-Object { $_.Data.status -eq 'active' }).Count

    Write-Info "Total sessions: $($sessionEntries.Count)"
    Write-Info "Active sessions: $activeCount"

    return $true
}

function Invoke-SelfImprovingPipeline {
    Write-Status "Running self-improving pipeline..."

    # Step 1: usage-tracker — record session usage metrics
    $usageTracker = Join-Path $repoRoot 'scripts\skills\usage-tracker.ps1'
    if (Test-Path $usageTracker) {
        $null = & $usageTracker -Action record -SkillName 'session-manager' -Outcome 'success' -TokensUsed 0 2>&1
        Write-Info "Usage metrics recorded"
    }

    # Step 2: skill-nudge — check for nudges based on usage patterns
    $nudgeScript = Join-Path $repoRoot 'scripts\skills\skill-nudge.ps1'
    if (Test-Path $nudgeScript) {
        $nudgeOut = & $nudgeScript 2>&1
        Write-Info "Skill nudges: $($nudgeOut | Out-String).Trim()"
    }

    # Step 3: skill-auto-patch — auto-patch SKILL.md known issues
    $patchScript = Join-Path $repoRoot 'scripts\skills\skill-auto-patch.ps1'
    if (Test-Path $patchScript) {
        $patchOut = & $patchScript 2>&1
        Write-Info "Skill auto-patch: $($patchOut | Out-String).Trim()"
    }

    # Step 4: validate-configs — verify all JSON configs
    $validateScript = Join-Path $repoRoot 'scripts\utilities\validate-configs.ps1'
    if (Test-Path $validateScript) {
        $null = & $validateScript 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Info "Config validation: PASS"
        } else {
            Write-Warn "Config validation: FAIL (non-blocking)"
        }
    }

    Write-Status "Self-improving pipeline completed"
}

function End-Session {
    Write-Status "Ending session..."

    # Self-improving pipeline (usage-tracker → skill-nudge → skill-auto-patch)
    Invoke-SelfImprovingPipeline

    $enforcerScript = Join-Path $repoRoot 'scripts\adaptive\auto-norm-enforcer.ps1'
    if (Test-Path $enforcerScript) {
        & $enforcerScript -Trigger session-close -AutoFix -VerboseOutput:($VerbosePreference -eq 'Continue')
        Write-Info "Norm enforcement completed"
    } else {
        Write-Warn "Norm enforcer not found at: $enforcerScript"
    }

    $learnerScript = Join-Path $repoRoot 'scripts\adaptive\auto-norm-learner.ps1'
    if (Test-Path $learnerScript) {
        & $learnerScript -Trigger session-close -VerboseOutput:($VerbosePreference -eq 'Continue')
        Write-Info "Norm learner completed"
    } else {
        Write-Warn "Norm learner not found at: $learnerScript"
    }

    $validator = Join-Path $repoRoot 'scripts\utilities\pre-close-validator.ps1'
    if ($SkipPreCloseValidation) {
        Write-Info "Pre-close validation skipped"
    } elseif (Test-Path $validator) {
        & $validator -AutoResolve
        if ($LASTEXITCODE -ne 0) {
            Write-ErrorMsg "Pre-close validation failed. Session closure blocked."
            Write-ErrorMsg "Fix issues or use -Force to override."
            Complete-Script -ExitCode 1
            return
        }
        Write-Status "Pre-close validation passed"
    } else {
        Write-Warn "Pre-close validator not found, skipping validation"
    }

    # Persist final metrics
    $tracker = Join-Path $repoRoot 'scripts\utilities\session-metrics-tracker.ps1'
    if (Test-Path $tracker) {
        $null = & $tracker -Action end 2>&1
        Write-Status "Session metrics saved"
    }

    $sessionEntries = @(Get-ValidSessionEntries)
    $activeSessions = @($sessionEntries | Where-Object { $_.Data.status -eq 'active' })

    if ($activeSessions.Count -eq 0) {
        Write-Warn "No active sessions to end"
        return
    }

    $targetSession = $null
    if (-not [string]::IsNullOrWhiteSpace($TargetSessionId)) {
        $targetSession = $activeSessions | Where-Object { $_.Data.sessionId -eq $TargetSessionId } | Select-Object -First 1
        if (-not $targetSession) {
            Write-ErrorMsg "Target session '$TargetSessionId' was not found among active sessions."
            Write-Info "Active session IDs: $($activeSessions.Data.sessionId -join ', ')"
            Complete-Script -ExitCode 2
            return
        }
    } else {
        $targetSession = $activeSessions | Select-Object -First 1
    }

    if ($activeSessions.Count -gt 1) {
        Write-Warn "Multiple active sessions detected ($($activeSessions.Count))."
        foreach ($s in $activeSessions) {
            Write-Host ("  - {0} | start={1}" -f $s.Data.sessionId, $s.Data.startTime) -ForegroundColor Yellow
        }

        $notifyScript = Join-Path $repoRoot 'scripts\utilities\notify-user.ps1'
        if (Test-Path $notifyScript) {
            $closeCmd = if ([string]::IsNullOrWhiteSpace($TargetSessionId)) {
                'pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/utilities/session-manager.ps1 -Mode End -TargetSessionId <session-id>'
            } else {
                "pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/utilities/session-manager.ps1 -Mode End -TargetSessionId $TargetSessionId -AllowCloseWithOtherActive"
            }
            & $notifyScript -Action 'session-close' -Reason 'Multiple active sessions detected during close' -Details 'Select explicit TargetSessionId to avoid closing the wrong concurrent session.' -RecoveryCommand $closeCmd 2>$null
        }

        if ([string]::IsNullOrWhiteSpace($TargetSessionId) -and -not $AllowCloseWithOtherActive) {
            Write-ErrorMsg "Session closure blocked. Use -TargetSessionId when multiple sessions are active."
            Complete-Script -ExitCode 2
            return
        }
    }

    $sessionData = $targetSession.Data

    $null = Save-ToEngram -Title "Session closure: $($sessionData.sessionId)" -Content "Session $($sessionData.sessionId) closed. Pre-close validation passed." -Type 'session'

    $updatedData = @{
        sessionId = $sessionData.sessionId
        project = $sessionData.project
        mode = $sessionData.mode
        startTime = $sessionData.startTime
        version = $sessionData.version
        status = "ended"
        endTime = Get-Date -Format "o"
    }
    $updatedData | ConvertTo-Json | Out-File -FilePath $targetSession.File.FullName -Encoding UTF8

    Write-Status "Session ended: $($sessionData.sessionId)"

    $notifyScript = Join-Path $repoRoot 'scripts\utilities\notify-user.ps1'
    if (Test-Path $notifyScript) {
        & $notifyScript -Action "session-close" -Reason "Session ended (manual or idle timeout)" -RecoveryCommand ".\tools\session-quick-restart.ps1 -Components session" 2>$null
    }

    $sessionAuthFile = Join-Path $repoRoot ".workspace\config\session-auth.json"
    if (Test-Path $sessionAuthFile) {
        Remove-Item $sessionAuthFile -Force -ErrorAction SilentlyContinue
        Write-Info "Session auth cleared"
    }
}

switch ($Mode) {
    'AutoStart' {
        Write-Status "AutoStart mode - initializing workspace session"
        $sessionId = Initialize-Session -Mode 'AutoStart'
        Write-Status "Workspace ready for work"
    }

    'Manual' {
        Write-Status "Manual mode - ready to initialize session"
        $sessionId = Initialize-Session -Mode 'Manual'
    }

    'Health' {
        Get-SessionHealth | Out-Null
    }

    'End' {
        End-Session
    }

    'Cleanup' {
        $result = Clear-OrphanedSessions -MaxAgeHours $OrphanMaxAgeHours
        Write-Status "Cleanup completed: $($result.cleaned) sessions closed, $($result.kept) active/recent"
    }

    default {
        Write-ErrorMsg "Unknown mode: $Mode"
        Complete-Script -ExitCode 1
        return
    }
}

Write-Status "Session manager operation completed"
Complete-Script -ExitCode 0

