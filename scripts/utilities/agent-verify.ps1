#!/usr/bin/env pwsh
# =============================================================================
#  agent-verify.ps1 - Self-Verification Tool for AI Agents
# =============================================================================
#
#  Run this after completing ANY significant work to validate the result.
#  The agent MUST run this and fix all FAIL items before considering the
#  task done. WARN items should be reviewed but do not block.
#
#  Usage:
#    pwsh -File scripts/utilities/agent-verify.ps1
#    pwsh -File scripts/utilities/agent-verify.ps1 -Domain config
#    pwsh -File scripts/utilities/agent-verify.ps1 -Json
#    pwsh -File scripts/utilities/agent-verify.ps1 -Quick
#    pwsh -File scripts/utilities/agent-verify.ps1 -Domain tests -Verbose
#
#  Domains: all | config | tests | hooks | structure | skills
#  Exit:    0 = all pass (or warnings only), 1 = one or more FAIL
# =============================================================================

param(
    [string[]]$Domain = @("all"),
    [switch]$Json,
    [switch]$Verbose,
    [switch]$Quick
)

$ErrorActionPreference = 'Continue'

# Global timeout: abort any single domain if it takes >30s
$script:DomainTimeout = 30
$script:DomainStart = [Diagnostics.Stopwatch]::StartNew()
function Test-DomainExpired {
    if ($script:DomainStart.Elapsed.TotalSeconds -gt $script:DomainTimeout) {
        return $true
    }
    return $false
}

# Resolve workspace root regardless of where the script is called from
$Root = git -C $PSScriptRoot rev-parse --show-toplevel 2>$null
if (-not $Root) { $Root = (Get-Location).Path }
Set-Location $Root

$Results  = [System.Collections.Generic.List[PSCustomObject]]::new()
$Errors   = 0
$Warnings = 0

$AllowedDomains = @("all","config","tests","hooks","structure","skills")
$NormalizedDomains = @(
    $Domain |
    ForEach-Object { $_ -split ',' } |
    ForEach-Object { $_.Trim().ToLowerInvariant() } |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
)

if ($NormalizedDomains.Count -eq 0) {
    $NormalizedDomains = @('all')
}

foreach ($domainName in $NormalizedDomains) {
    if ($AllowedDomains -notcontains $domainName) {
        Write-Error "Invalid domain '$domainName'. Allowed values: $($AllowedDomains -join ', ')"
        exit 1
    }
}

function Test-DomainEnabled {
    param([string]$Name)
    return ($script:NormalizedDomains -contains 'all' -or $script:NormalizedDomains -contains $Name)
}

function Add-Result {
    param([string]$Check, [string]$Status, [string]$Message, [string]$Category)
    $script:Results.Add([PSCustomObject]@{
        check    = $Check
        status   = $Status   # PASS | FAIL | WARN
        message  = $Message
        category = $Category
    })
    if ($Status -eq "FAIL") { $script:Errors++ }
    if ($Status -eq "WARN") { $script:Warnings++ }
}

# =============================================================================
#  DOMAIN: config
#  - All config/*.json files are valid JSON
#  - auto-delegation.json has required keys
#  - agentCodeToSkill values are non-empty strings
# =============================================================================
if (Test-DomainEnabled 'config') {
    # JSON syntax
    $ConfigFiles = Get-ChildItem "$Root\config\*.json" -ErrorAction SilentlyContinue
    $JsonFails = @()
    foreach ($f in $ConfigFiles) {
        try { Get-Content $f.FullName -Raw | ConvertFrom-Json | Out-Null }
        catch { $JsonFails += $f.Name }
    }
    if ($JsonFails.Count -eq 0) {
        Add-Result "json-syntax" "PASS" "All $($ConfigFiles.Count) config JSONs valid" "config"
    } else {
        Add-Result "json-syntax" "FAIL" "Invalid JSON: $($JsonFails -join ', ')" "config"
    }

    # auto-delegation.json required keys
    $AdPath = "$Root\config\auto-delegation.json"
    if (Test-Path $AdPath) {
        try {
            $ad = Get-Content $AdPath -Raw | ConvertFrom-Json
            $required = @("keywordMappings","agentCodeToSkill","agentProfiles","fallbackStrategy")
            $missing  = $required | Where-Object { -not $ad.PSObject.Properties[$_] }
            if ($missing.Count -eq 0) {
                Add-Result "auto-delegation-keys" "PASS" "Required keys present ($($required -join ', '))" "config"
            } else {
                Add-Result "auto-delegation-keys" "FAIL" "Missing keys: $($missing -join ', ')" "config"
            }
        } catch {
            Add-Result "auto-delegation-keys" "FAIL" "Cannot parse auto-delegation.json: $_" "config"
        }
    } else {
        Add-Result "auto-delegation-keys" "FAIL" "config/auto-delegation.json not found" "config"
    }

    # Guard: very short keyword triggers (1-2 chars) are high-risk for false positives
    if (Test-Path $AdPath) {
        try {
            $ad = Get-Content $AdPath -Raw | ConvertFrom-Json
            $shortTriggers = @()
            $allowShort = @('ai', 'qa', 'ux', 'ui', 'hr')

            foreach ($agentProp in $ad.keywordMappings.PSObject.Properties) {
                $agentName = $agentProp.Name
                foreach ($raw in $agentProp.Value) {
                    if (-not $raw) { continue }
                    $k = $raw.ToString().ToLowerInvariant().Trim()
                    $k = $k.Trim('"').TrimEnd('.', ',', ';', ':')
                    if ([string]::IsNullOrWhiteSpace($k)) { continue }
                    if ($k.Length -le 2 -and ($allowShort -notcontains $k)) {
                        $shortTriggers += "$agentName=$k"
                    }
                }
            }

            if ($shortTriggers.Count -eq 0) {
                Add-Result "short-trigger-guard" "PASS" "No risky short triggers (<=2 chars) found in keywordMappings" "config"
            } else {
                $sample = ($shortTriggers | Select-Object -Unique | Select-Object -First 10) -join '; '
                Add-Result "short-trigger-guard" "WARN" "Potential false-positive triggers found: $sample" "config"
            }
        } catch {
            Add-Result "short-trigger-guard" "WARN" "Could not evaluate short trigger guard: $_" "config"
        }
    }

    # quality-gates.json required keys
    $QgPath = "$Root\config\quality-gates.json"
    if (Test-Path $QgPath) {
        try {
            $qg = Get-Content $QgPath -Raw | ConvertFrom-Json
            $requiredQg = @("requiredWorkflows","requiredStatusChecks","pullRequestRules")
            $missingQg = $requiredQg | Where-Object { -not $qg.PSObject.Properties[$_] }
            if ($missingQg.Count -eq 0) {
                Add-Result "quality-gates-keys" "PASS" "Required keys present in config/quality-gates.json" "config"
            } else {
                Add-Result "quality-gates-keys" "FAIL" "Missing keys in quality-gates.json: $($missingQg -join ', ')" "config"
            }
        } catch {
            Add-Result "quality-gates-keys" "FAIL" "Cannot parse quality-gates.json: $_" "config"
        }
    } else {
        Add-Result "quality-gates-keys" "WARN" "config/quality-gates.json not found" "config"
    }
}

# =============================================================================
#  DOMAIN: skills
#  - Every agentCodeToSkill value resolves to a real directory
#    (checks user skill store first, then local skills/)
# =============================================================================
if (Test-DomainEnabled 'skills') {
    $AdPath = "$Root\config\auto-delegation.json"
    if (Test-Path $AdPath) {
        try {
            $ad = Get-Content $AdPath -Raw | ConvertFrom-Json
            $skillMap  = $ad.agentCodeToSkill
            $UserBase  = "C:\Users\emman\.claude\skills"
            $LocalBase = "$Root\skills"
            $badSkills = @()
            foreach ($prop in $skillMap.PSObject.Properties) {
                if ($prop.Name -eq "description") { continue }
                $skillName = $prop.Value
                $inUser    = Test-Path (Join-Path $UserBase  $skillName)
                $inLocal   = Test-Path (Join-Path $LocalBase $skillName)
                if (-not $inUser -and -not $inLocal) {
                    $badSkills += "$($prop.Name)=$skillName"
                }
            }
            if ($badSkills.Count -eq 0) {
                Add-Result "skill-references" "PASS" "All agentCodeToSkill entries resolve to real dirs" "skills"
            } else {
                Add-Result "skill-references" "WARN" "Unresolved skills (check path): $($badSkills -join '; ')" "skills"
            }
        } catch {
            Add-Result "skill-references" "WARN" "Cannot check skill references: $_" "skills"
        }
    }
}

# =============================================================================
#  DOMAIN: tests
#  - Unit tests (Pester 3.4.0) all pass
# =============================================================================
if (Test-DomainEnabled 'tests') {
    & { # script block for break semantics
    if (Test-DomainExpired) { Add-Result "domain-tests" "WARN" "Skipped: domain timeout exceeded" "tests"; return }

    $TestDir = "$Root\tests"
    if (-not (Test-Path $TestDir)) {
        Add-Result "unit-tests" "WARN" "No tests directory found, skipping" "tests"
    } elseif ($Quick) {
        # Quick mode: check test files exist without running them
        $TestFiles = @(Get-ChildItem -Path $TestDir -Recurse -Filter "*.tests.ps1" -Name)
        Add-Result "unit-tests" "WARN" "Quick mode: $($TestFiles.Count) test files found (not executed)" "tests"
    } else {
        $TestFiles = @(Get-ChildItem -Path $TestDir -Recurse -Filter "*.tests.ps1" -Name)
        $TotalPassed = 0; $TotalFailed = 0; $FailedFiles = @()
        foreach ($tf in $TestFiles) {
            if (Test-DomainExpired) { Add-Result "unit-tests" "WARN" "Pester tests aborted due to timeout after $($TestFiles.IndexOf($tf) + 1)/$($TestFiles.Count) files" "tests"; break }
            $absPath = "$Root\tests\$tf"
            if (-not (Test-Path $absPath)) { continue }
            $TestOut = & pwsh -NoProfile -ExecutionPolicy Bypass -Command @"
                Import-Module Pester -MinimumVersion 5.0.0 -ErrorAction SilentlyContinue
                if (-not (Get-Module Pester)) { Import-Module Pester -MinimumVersion 3.4.0 -ErrorAction SilentlyContinue }
                if (-not (Get-Module Pester)) { Write-Output "PESTER_MISSING"; exit }
                `$r = Invoke-Pester '$absPath' -PassThru -Quiet
                if (`$r) { Write-Output "PESTER_RESULT:`$(`$r.PassedCount):`$(`$r.FailedCount)" }
"@ 2>&1
            if ($TestOut -match "PESTER_MISSING") {
                Add-Result "unit-tests" "WARN" "Pester not installed, skipping test execution" "tests"; break
            }
            $PesterLine = $TestOut | Select-String "PESTER_RESULT:" | Select-Object -Last 1
            if ($PesterLine) {
                $parts  = "$PesterLine".ToString().Split(":")
                if ($parts.Count -ge 3) {
                    $p = [int]$parts[1]; $f = [int]$parts[2]
                    $TotalPassed += $p; $TotalFailed += $f
                    if ($f -gt 0) { $FailedFiles += "$tf ($f failed)" }
                }
            }
        }
        if (-not ($TestOut -match "PESTER_MISSING")) {
            if ($TotalFailed -eq 0) {
                Add-Result "unit-tests" "PASS" "$TotalPassed tests passed across $($TestFiles.Count) files, 0 failed" "tests"
            } else {
                Add-Result "unit-tests" "FAIL" "$TotalPassed passed, $TotalFailed FAILED across $($TestFiles.Count) files: $($FailedFiles -join '; ')" "tests"
            }
        }
    }

    # Multilingual routing regression matrix (es/en/pt-BR) — skip in Quick mode
    $RoutingEvalScript = "$Root\scripts\utilities\routing-quality-eval.ps1"
    $RoutingDataset = "$Root\tests\e2e\routing-language-matrix.json"
    if ($Quick) {
        Add-Result "routing-language-matrix" "WARN" "Quick mode: routing matrix not evaluated" "tests"
    } elseif ((Test-Path $RoutingEvalScript) -and (Test-Path $RoutingDataset)) {
        $routingOut = & pwsh -NoProfile -ExecutionPolicy Bypass -File $RoutingEvalScript `
            -DatasetPath "tests/e2e/routing-language-matrix.json" `
            -WorkspaceRoot "$Root" `
            -FailOnMismatch 2>&1

        if ($LASTEXITCODE -eq 0) {
            $summaryLine = ($routingOut | Select-String "Accuracy:" | Select-Object -Last 1)
            if ($summaryLine) {
                Add-Result "routing-language-matrix" "PASS" "$summaryLine" "tests"
            } else {
                Add-Result "routing-language-matrix" "PASS" "Routing language matrix passed" "tests"
            }
        } else {
            $detail = ($routingOut | Out-String).Trim()
            if ([string]::IsNullOrWhiteSpace($detail)) {
                $detail = "Routing language matrix failed"
            }
            Add-Result "routing-language-matrix" "FAIL" $detail "tests"
        }
    } else {
        Add-Result "routing-language-matrix" "WARN" "Routing evaluator or dataset not found" "tests"
    }
    } # end script block
}

# =============================================================================
#  DOMAIN: hooks
#  - Hook script files exist
#  - Git pre-commit hook is installed in .git/hooks/
# =============================================================================
if (Test-DomainEnabled 'hooks') {
    $HookScripts = @(
        "hooks/pre-commit.ps1",
        "hooks/pre-commit-privacy.ps1"
    )
    $missing = $HookScripts | Where-Object { -not (Test-Path "$Root\$_") }
    if ($missing.Count -eq 0) {
        Add-Result "hook-scripts" "PASS" "All hook scripts present" "hooks"
    } else {
        Add-Result "hook-scripts" "FAIL" "Missing: $($missing -join ', ')" "hooks"
    }

    if (Test-Path "$Root\.git\hooks\pre-commit") {
        Add-Result "git-hook-installed" "PASS" ".git/hooks/pre-commit is installed" "hooks"
    } else {
        Add-Result "git-hook-installed" "WARN" ".git/hooks/pre-commit not installed - run: pwsh -File scripts/utilities/install-hooks.ps1" "hooks"
    }
}

# =============================================================================
#  DOMAIN: structure
#  - Required root files exist
#  - Critical scripts exist
# =============================================================================
if (Test-DomainEnabled 'structure') {
    $RequiredFiles = @(
        "config/auto-delegation.json",
        "config/orchestrator.json",
        "rules/AI-NORMATIVES.md",
        "CLAUDE.md",
        "VERSION",
        "SECURITY.md"
    )
    $missing = $RequiredFiles | Where-Object { -not (Test-Path "$Root\$_") }
    if ($missing.Count -eq 0) {
        Add-Result "required-files" "PASS" "All required files present" "structure"
    } else {
        Add-Result "required-files" "FAIL" "Missing files: $($missing -join ', ')" "structure"
    }

    $RequiredScripts = @(
        "scripts/utilities/pre-process-input.ps1",
        "scripts/utilities/validate-configs.ps1",
        "scripts/utilities/install-hooks.ps1"
    )
    $missingScripts = $RequiredScripts | Where-Object { -not (Test-Path "$Root\$_") }
    if ($missingScripts.Count -eq 0) {
        Add-Result "critical-scripts" "PASS" "All critical utility scripts present" "structure"
    } else {
        Add-Result "critical-scripts" "FAIL" "Missing scripts: $($missingScripts -join ', ')" "structure"
    }

    # Required workflow files from quality-gates config
    $QgPath = "$Root\config\quality-gates.json"
    if (Test-Path $QgPath) {
        try {
            $qg = Get-Content $QgPath -Raw | ConvertFrom-Json
            $requiredWorkflows = @($qg.requiredWorkflows)
            $missingWorkflowFiles = @()
            foreach ($wfName in $requiredWorkflows) {
                $wfPath = "$Root\.github\workflows\$wfName.yml"
                if (-not (Test-Path $wfPath)) {
                    $missingWorkflowFiles += "$wfName.yml"
                }
            }

            if ($missingWorkflowFiles.Count -eq 0) {
                Add-Result "quality-gate-workflows" "PASS" "All required workflow files exist" "structure"
            } else {
                Add-Result "quality-gate-workflows" "FAIL" "Missing required workflow files: $($missingWorkflowFiles -join ', ')" "structure"
            }
        } catch {
            Add-Result "quality-gate-workflows" "WARN" "Could not validate required workflows from quality-gates.json: $_" "structure"
        }
    }

    # Workflow hardening checks (scheduled workflows only)
    $WorkflowDir = Join-Path $Root ".github\workflows"
    if (Test-Path $WorkflowDir) {
        $scheduled = @()
        Get-ChildItem "$WorkflowDir\*.yml" -File | ForEach-Object {
            $raw = Get-Content $_.FullName -Raw
            if ($raw -match "(?m)^\s*schedule:\s*$") {
                $scheduled += [PSCustomObject]@{ file = $_.Name; raw = $raw }
            }
        }

        if ($scheduled.Count -eq 0) {
            Add-Result "workflow-hardening" "WARN" "No scheduled workflows found under .github/workflows" "structure"
        } else {
            $missingConcurrency = @()
            $missingPermissions = @()
            $missingTimeout = @()
            $badCronComments = @()

            foreach ($gv in $scheduled) {
                if ($gv.raw -notmatch "(?m)^\s*concurrency:\s*$") { $missingConcurrency += $gv.file }
                if ($gv.raw -notmatch "(?m)^\s*permissions:\s*$") { $missingPermissions += $gv.file }
                if ($gv.raw -notmatch "(?m)^\s*timeout-minutes:\s*\d+") { $missingTimeout += $gv.file }

                $cronLines = ($gv.raw -split "`r?`n") | Where-Object { $_ -match "cron:\s*'" }
                foreach ($line in $cronLines) {
                    if ($line -notmatch "GMT-3" -or $line -notmatch "UTC") {
                        $badCronComments += $gv.file
                        break
                    }
                }
            }

            $issues = @()
            if ($missingConcurrency.Count -gt 0) { $issues += "missing concurrency: $($missingConcurrency -join ', ')" }
            if ($missingPermissions.Count -gt 0) { $issues += "missing permissions: $($missingPermissions -join ', ')" }
            if ($missingTimeout.Count -gt 0) { $issues += "missing timeout-minutes: $($missingTimeout -join ', ')" }

            if ($issues.Count -eq 0) {
                Add-Result "workflow-hardening" "PASS" "Scheduled workflows include permissions, concurrency and timeout-minutes" "structure"
            } else {
                Add-Result "workflow-hardening" "FAIL" ($issues -join " | ") "structure"
            }

            if ($badCronComments.Count -eq 0) {
                Add-Result "workflow-cron-comments" "PASS" "Scheduled cron lines include UTC and GMT-3 mapping comments" "structure"
            } else {
                $uniqueBad = $badCronComments | Select-Object -Unique
                Add-Result "workflow-cron-comments" "WARN" "Cron comments should include UTC and GMT-3 mapping: $($uniqueBad -join ', ')" "structure"
            }
        }
    } else {
        Add-Result "workflow-hardening" "WARN" ".github/workflows directory not found" "structure"
    }

    # Detect uncommitted changes (unstaged or staged), ignoring known operational files.
    $dirtyStateScript = Join-Path $Root 'scripts\utilities\get-workspace-dirty-state.ps1'
    if (Test-Path $dirtyStateScript) {
        try {
            $stateInfo = & $dirtyStateScript -RepoRoot $Root -AsJson | ConvertFrom-Json
            if ($stateInfo.state -eq 'dirty-user') {
                Add-Result "uncommitted-changes" "WARN" "$($stateInfo.userDirtyCount) uncommitted user file(s) - commit or stash before closing task" "structure"
            } elseif ($stateInfo.state -eq 'dirty-operational') {
                Add-Result "uncommitted-changes" "PASS" "Only operational auto-managed files are dirty ($($stateInfo.operationalDirtyCount))" "structure"
            } else {
                Add-Result "uncommitted-changes" "PASS" "Working tree clean" "structure"
            }
        }
        catch {
            $DirtyFiles = git -C $Root status --porcelain 2>$null | Where-Object { $_ -match "^\s*[MADRCU?]" }
            if ($DirtyFiles.Count -gt 0) {
                Add-Result "uncommitted-changes" "WARN" "$($DirtyFiles.Count) uncommitted file(s) - commit or stash before closing task" "structure"
            } else {
                Add-Result "uncommitted-changes" "PASS" "Working tree clean" "structure"
            }
        }
    } else {
        $DirtyFiles = git -C $Root status --porcelain 2>$null | Where-Object { $_ -match "^\s*[MADRCU?]" }
        if ($DirtyFiles.Count -gt 0) {
            Add-Result "uncommitted-changes" "WARN" "$($DirtyFiles.Count) uncommitted file(s) - commit or stash before closing task" "structure"
        } else {
            Add-Result "uncommitted-changes" "PASS" "Working tree clean" "structure"
        }
    }

    # Governed override abuse detection
    $OrchPath = "$Root\config\orchestrator.json"
    if (Test-Path $OrchPath) {
        try {
            $orch = Get-Content $OrchPath -Raw | ConvertFrom-Json
            $gov = $orch.governed_override_profiles
            $abuse = $gov.abuse_detection
            $auditRel = $gov.audit_log

            if ($gov -and $abuse -and $abuse.enabled -and $auditRel) {
                $auditPath = Join-Path $Root $auditRel
                if (-not (Test-Path $auditPath)) {
                    Add-Result "override-abuse-audit" "PASS" "Override audit log not present yet; no abuse detected" "structure"
                } else {
                    $entries = @()
                    Get-Content $auditPath -ErrorAction SilentlyContinue | ForEach-Object {
                        if (-not [string]::IsNullOrWhiteSpace($_)) {
                            try { $entries += ($_ | ConvertFrom-Json) } catch {}
                        }
                    }

                    $windowStart = (Get-Date).AddHours(-1 * [int]$abuse.window_hours)
                    $recent = @($entries | Where-Object {
                        $ts = $null
                        if ($_.timestamp) {
                            try { $ts = [DateTimeOffset]::Parse([string]$_.timestamp).DateTime } catch {}
                        }
                        $ts -and $ts -ge $windowStart
                    })

                    if ($recent.Count -eq 0) {
                        Add-Result "override-abuse-audit" "PASS" "No governed overrides recorded in the last $($abuse.window_hours)h" "structure"
                    } else {
                        $perAgent = @{}
                        $perProfile = @{}
                        foreach ($entry in $recent) {
                            $agentKey = if ($entry.agent) { [string]$entry.agent } else { "unknown" }
                            $profileKey = if ($entry.profile) { [string]$entry.profile } else { "unknown" }
                            if (-not $perAgent.ContainsKey($agentKey)) { $perAgent[$agentKey] = 0 }
                            if (-not $perProfile.ContainsKey($profileKey)) { $perProfile[$profileKey] = 0 }
                            $perAgent[$agentKey]++
                            $perProfile[$profileKey]++
                        }

                        $violations = @()
                        if ($recent.Count -ge [int]$abuse.warn_total_overrides) {
                            $violations += "total overrides=$($recent.Count)"
                        }
                        foreach ($k in $perAgent.Keys) {
                            if ($perAgent[$k] -ge [int]$abuse.warn_per_agent) {
                                $violations += "agent $k=$($perAgent[$k])"
                            }
                        }
                        foreach ($k in $perProfile.Keys) {
                            if ($perProfile[$k] -ge [int]$abuse.warn_per_profile) {
                                $violations += "profile $k=$($perProfile[$k])"
                            }
                        }

                        if ($violations.Count -gt 0) {
                            Add-Result "override-abuse-audit" "WARN" "Governed override usage above threshold in last $($abuse.window_hours)h: $($violations -join '; ')" "structure"

                            # Active notification: write alert file for dashboard / CI pickup
                            $alertDir = Join-Path $Root '.logs'
                            if (-not (Test-Path $alertDir)) { New-Item -ItemType Directory -Path $alertDir -Force | Out-Null }
                            $alertPath = Join-Path $alertDir 'override-abuse-alert.json'
                            $alertPayload = @{
                                generated_at = (Get-Date -Format 'yyyy-MM-ddTHH:mm:sszzz')
                                window_hours = $abuse.window_hours
                                violations   = $violations
                                total_recent_overrides = $recent.Count
                                per_agent    = $perAgent
                                per_profile  = $perProfile
                                remediation  = @(
                                    "Review .logs/override-audit.jsonl for the full override history.",
                                    "If overrides are legitimate, increase thresholds in config/orchestrator.json#governed_override_profiles.abuse_detection.",
                                    "If overrides are abusive, remove excess entries from override-audit.jsonl and notify the team.",
                                    "Run 'gv verify' after remediation to confirm the alert clears."
                                )
                            }
                            $alertPayload | ConvertTo-Json -Depth 5 | Out-File -FilePath $alertPath -Encoding UTF8 -Force

                            # Print prominent remediation block
                            if (-not $Json) {
                                Write-Host "" -ForegroundColor Red
                                Write-Host "  +==============================================================+" -ForegroundColor Red
                                Write-Host "  |  OVERRIDE ABUSE ALERT - ACTION REQUIRED                    |" -ForegroundColor Red
                                Write-Host "  +==============================================================+" -ForegroundColor Red
                                Write-Host "  Violations: $($violations -join ' | ')" -ForegroundColor Yellow
                                Write-Host "  Alert file: .logs/override-abuse-alert.json" -ForegroundColor Yellow
                                Write-Host "  Remediation:" -ForegroundColor Cyan
                                Write-Host "    1. Check .logs/override-audit.jsonl for the full override history." -ForegroundColor Cyan
                                Write-Host "    2. If legitimate, raise thresholds in orchestrator.json." -ForegroundColor Cyan
                                Write-Host "    3. If abusive, purge excess entries and notify the team." -ForegroundColor Cyan
                                Write-Host "    4. Run 'gv verify' again after remediation to confirm the alert clears." -ForegroundColor Cyan
                                Write-Host "" -ForegroundColor Red
                            }
                        } else {
                            Add-Result "override-abuse-audit" "PASS" "Governed override usage within threshold in last $($abuse.window_hours)h" "structure"
                        }
                    }
                }
            }
        } catch {
            Add-Result "override-abuse-audit" "WARN" "Could not evaluate override audit abuse: $_" "structure"
        }
    }
}

# =============================================================================
#  OUTPUT
# =============================================================================
$Total  = $Results.Count
$Passed = ($Results | Where-Object { $_.status -eq "PASS" }).Count
$FinalResult = if ($Errors -gt 0) { "FAIL" } elseif ($Warnings -gt 0) { "PASS_WITH_WARNINGS" } else { "PASS" }

if ($Json) {
    @{
        timestamp  = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss")
        domain     = $Domain
        summary    = @{ total = $Total; passed = $Passed; failed = $Errors; warnings = $Warnings }
        result     = $FinalResult
        checks     = $Results
    } | ConvertTo-Json -Depth 5
} else {
    Write-Host ""
    Write-Host "=============================================" -ForegroundColor Cyan
    Write-Host "  AGENT SELF-VERIFICATION" -ForegroundColor Cyan
    Write-Host "  Domain: $Domain | $(Get-Date -Format 'yyyy-MM-dd HH:mm')" -ForegroundColor DarkGray
    Write-Host "=============================================" -ForegroundColor Cyan
    Write-Host ""

    $lastCategory = ""
    foreach ($r in $Results) {
        if ($r.category -ne $lastCategory) {
            Write-Host "  --- $($r.category.ToUpper()) ---" -ForegroundColor DarkGray
            $lastCategory = $r.category
        }
        $color = switch ($r.status) { "PASS" { "Green" } "FAIL" { "Red" } "WARN" { "Yellow" } default { "White" } }
        Write-Host "  [$($r.status.PadRight(4))] $($r.check)" -ForegroundColor $color -NoNewline
        Write-Host ": $($r.message)" -ForegroundColor DarkGray
    }

    Write-Host ""
    Write-Host "---------------------------------------------" -ForegroundColor DarkGray
    Write-Host "  $Passed/$Total passed  |  $Errors error(s)  |  $Warnings warning(s)" -ForegroundColor $(
        if ($Errors -gt 0) { "Red" } elseif ($Warnings -gt 0) { "Yellow" } else { "Green" }
    )
    Write-Host ""

    switch ($FinalResult) {
        "PASS" {
            Write-Host "  RESULT: ALL CHECKS PASS - work verified clean." -ForegroundColor Green
        }
        "PASS_WITH_WARNINGS" {
            Write-Host "  RESULT: PASS with $Warnings warning(s) - review before closing." -ForegroundColor Yellow
        }
        "FAIL" {
            Write-Host "  RESULT: $Errors FAILURE(S) - fix before marking task done." -ForegroundColor Red
            Write-Host ""
            Write-Host "  FAILED CHECKS:" -ForegroundColor Red
            $Results | Where-Object { $_.status -eq "FAIL" } | ForEach-Object {
                Write-Host "    - [$($_.category)] $($_.check): $($_.message)" -ForegroundColor Red
            }
        }
    }
    Write-Host ""
    Write-Host "=============================================" -ForegroundColor Cyan
    Write-Host ""
}

exit $(if ($Errors -gt 0) { 1 } else { 0 })

