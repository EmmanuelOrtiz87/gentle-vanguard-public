# gv.ps1 - Workflow CLI
# Automated development workflow for Gentle-Vanguard

param(
    [Parameter(Position=0)]
    [ValidateSet('review', 'audit', 'pr', 'push', 'publish', 'status', 'health', 'update', 'update-all', 'update-tools', 'install', 'install-engram', 'orchestrator-status', 'stack-dashboard', 'runtime-route', 'runtime-gate', 'custom-rules-status', 'response-mode', 'ide-status', 'diagnose', 'verify', 'start-session', 'end-session', 'day-end-closure', 'task-brief', 'migrate-structure', 'context-pack', 'compact-start', 'context-metrics', 'token-guard', 'checkpoint', 'list-checkpoints', 'rollback-checkpoint', 'clean-branches', 'homologate', 'gentle-vanguard-sync', 'release-homologation', 'agent-alert', 'agent', 'skills', 'dispatch', 'events', 'reset-demo', 'judgment-day', 'simplify-text', 'context-dashboard', 'dashboard', 'mq', 'export-metrics', 'monthly-report', 'platform-info', 'sdd-gate', 'sdd-metrics', 'sync-drift', 'benchmark', 'version', 'route', 'webhook', 'predictor', 'sla-dashboard', 'escalation', 'live-server', 'learning', 'watchtower', 'heal', 'gateway', 'help')]
    [string]$Command = 'help',
    
    [Parameter(Position=1)]
    [string]$Scope = '',

    [Parameter(Position=2, ValueFromRemainingArguments=$true)]
    [string[]]$RemainingArgs = @(),
    
    [switch]$SkipTests,
    [switch]$SkipReview,
    [switch]$SkipHomologationGate,
    [switch]$StrictCleanup,
    [switch]$Force,
    [switch]$JSON
)

$ErrorActionPreference = 'Continue'
# Prefer GENTLE_VANGUARD_BASE_DIR when running cached from AppData (launcher v2.1+)
# Falls back to $MyInvocation for development mode
if ($env:GENTLE_VANGUARD_BASE_DIR -and (Test-Path $env:GENTLE_VANGUARD_BASE_DIR)) {
    $scriptDir = "$env:GENTLE_VANGUARD_APPDATA_DIR\scripts\utilities\WORKFLOW-ORCHESTRATION"
    $repoRoot = $env:GENTLE_VANGUARD_BASE_DIR
} else {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    # repoRoot: go up 3 levels from gv.ps1 (WORKFLOW-ORCHESTRATION -> utilities -> scripts -> repo)
    $repoRoot = (Resolve-Path (Join-Path $scriptDir '..\..\..')).Path
}

# Export for command modules
$global:repoRoot = $repoRoot
$global:scriptDir = $scriptDir

# Source modular command files
. (Join-Path $scriptDir 'commands\common.ps1')
. (Join-Path $scriptDir 'commands\git.ps1')
. (Join-Path $scriptDir 'commands\context.ps1')

function Invoke-Update {
    Write-Step "Updating repository, gentle-vanguard, skills, and tools"

    $updateScript = Join-Path $scriptDir '..\validation\update-all.ps1'
    if (Test-Path $updateScript) {
        Invoke-LocalPowerShellScript -ScriptPath $updateScript -ScriptArgs @('-All', '-Force')
        if ($LASTEXITCODE -ne 0) { Write-Warning "Gentle-Vanguard update returned exit $LASTEXITCODE" }
    } else {
        Write-Warning "update-all.ps1 not found - skipping gentle-vanguard update"
    }
}

function Invoke-UpdateAll {
    Invoke-Update
}

function Show-Help {
    Write-Host @"
Gentle-Vanguard - Development Stack Workflow CLI
================================

USAGE:
    .\scripts\utilities\gv.ps1 <command> [options]

COMMANDS:
    review [scope]       Run code review (security, quality, all, judgment-day)
    audit                Generate audit document
    pr                   Create PR with template
    push [pr|later]      Prepare publish flow; choose push+PR now or push-only
    publish              Full PR workflow: validate, document, decide, and merge
    status               Show current status
    start-session [task]   Create a session brief and optional task brief
    end-session [task]     Run session closure checks and create delivery closure artifact
    day-end-closure        Automated daily closure: delivery closure + workspace validation + Engram memory capture
    task-brief <task>      Create or refresh a task brief only
    judgment-day          Run dual-review adversarial protocol (pre-merge validation)
    health               Check system health & activate tools
    install-engram       Install or verify Engram CLI availability
    orchestrator-status  Validate orchestrator and Engram integration
    stack-dashboard      Show one-shot stack health, token risk, and next action recommendation
                        Scope: live (real-time observability loop)
    runtime-route        Resolve runtime mode (AI/Hybrid/Offline) and delegation strategy
    runtime-gate [type]  Gate check: is task type allowed? type=ai|heavy-ai|network|local|metrics|any
    custom-rules-status  Show custom technical/business/review rule loading status
    response-mode [arg]  Show/set language, detail, profile, chat level, presets, and recommendation
    ide-status           Detect IDE session and suggest activation command
    diagnose             Full system diagnostics report
    verify               Quick stack verification & auto-repair
    update               Update repository, gentle-vanguard, skills, and tools
    update-all           Alias for update
    update-tools         Update toolchain (required + optional integrations)
    migrate-structure    Preflight and guided migration of loose scripts
    context-pack [goal]  Generate compact context summary for new chat thread
    compact-start [goal]  Generate context pack and copy compact continuation prompt
    simplify-text [text]   Simplify input text (remove emojis, normalize, abbreviate)
    context-metrics [days] Show context/token usage metrics from local logs
    token-guard [task]   Check token budget thresholds and continuity alternatives (Engram-aware/autopilot-aware)
    checkpoint [label]   Save a live rollback point (git stash -u) before risky edits
    list-checkpoints     List workflow-created checkpoints
    rollback-checkpoint [selector] Restore latest checkpoint or one matching selector
    clean-branches [apply] Preview or clean merged local feature/release branches
    homologate [apply]  Normalize docs/artifacts and update references (dry-run default)
    gentle-vanguard-sync [apply] [optional -CreatePr]  Sync managed assets declared in gentle-vanguard manifest
    release-homologation [vX.Y.Z]  Run complementary release gate across gentle-vanguard and gentle-vanguard-public
    agent-alert [strict] Check process-compliance signals for off-process AI activity
    agent <AGENT> [TASK] Route task to specialized sub-agent (BA|SAD|DEV|QA|OPS|GOV|DOC)
    dashboard [open|live|auto|status|stop] Generate professional HTML dashboard (auto = background live service)
    mq [action]          Message queue adapter: status|publish|consume|test (file/redis/webhook)
    export-metrics [fmt] Export metrics to analytical store: csv|jsonl|sqlite|all (default: csv)
    monthly-report [fmt] Run export-metrics + generate-management-report (fmt: csv|jsonl|sqlite|all)
    platform-info        Show current platform and PowerShell version
    sdd-gate             FF-001: Validate SDD spec status before merging to protected branches
    sdd-metrics          FF-002: SDD process KPIs: spec coverage, lead time, rework ratio
    sync-drift           FF-004: Detect drift between declared config and actual skills/files
    benchmark [cmds]     FF-006: Profile gv commands vs SLO thresholds (default: status,health)
                        Scope: full [remediate] [baseline-update] (adds regression guard + optional auto-remediation)
    version              Show current stack version (from VERSION file + orchestrator.json)
    gateway [action]     Multi-platform gateway: start|stop|restart|status|install|uninstall|process|send|logs|setup
    help                 Show this help

OPTIONS:
    -SkipTests        Skip test execution
    -SkipReview       Skip code review
    -StrictCleanup    Fail if homologation drift is detected (CI-oriented)
    -Force            Proceed without confirmation
    -JSON             Output diagnostics in JSON format (diagnose command)

EXAMPLES:
    .\scripts\utilities\gv.ps1 review              Run full code review
    .\scripts\utilities\gv.ps1 review security     Run security scan only
    .\scripts\utilities\gv.ps1 review judgment-day Run dual-review adversarial protocol
    .\scripts\utilities\gv.ps1 judgment-day       Run judgment day directly
    .\scripts\utilities\gv.ps1 audit              Generate audit document
    .\scripts\utilities\gv.ps1 pr                 Create PR
    .\scripts\utilities\gv.ps1 push               Commit and push
    .\scripts\utilities\gv.ps1 push pr            Push and open PR now
    .\scripts\utilities\gv.ps1 push later         Push only and create PR later
    .\scripts\utilities\gv.ps1 publish            Run end-to-end PR flow with auto-merge on clean validation
    .\scripts\utilities\gv.ps1 start-session      Create the session brief for today
    .\scripts\utilities\gv.ps1 end-session        Run end-of-session checks and create closure artifact
    .\scripts\utilities\gv.ps1 task-brief auth    Create a task brief for auth work
    .\scripts\utilities\gv.ps1 diagnose            Full diagnostics report (JSON available)
    .\scripts\utilities\gv.ps1 diagnose -JSON      Full diagnostics report in JSON format
    .\scripts\utilities\gv.ps1 verify              Quick verify & auto-repair if needed
    .\scripts\utilities\gv.ps1 health              Check system health & activate tools
    .\scripts\utilities\gv.ps1 install-engram      Install or verify Engram CLI
    .\scripts\utilities\gv.ps1 stack-dashboard     One-shot operational dashboard (health + token risk + action)
    .\scripts\utilities\gv.ps1 stack-dashboard live Real-time observability loop (agents/events/tokens/context)
    .\scripts\utilities\gv.ps1 stack-dashboard strict  Fail with non-zero exit when executive traffic light is RED
    .\scripts\utilities\gv.ps1 dashboard open       Generate dashboard and open it in browser
    .\scripts\utilities\gv.ps1 dashboard live       Continuous professional dashboard refresh (foreground)
    .\scripts\utilities\gv.ps1 dashboard auto       Start automated background live dashboard and open browser
    .\scripts\utilities\gv.ps1 dashboard status     Show automated live dashboard process status
    .\scripts\utilities\gv.ps1 dashboard stop       Stop automated live dashboard process
    .\scripts\utilities\gv.ps1 runtime-route        Resolve runtime mode and recommended fallback actions
    .\scripts\utilities\gv.ps1 runtime-route -JSON  Emit machine-readable runtime mode data
    .\scripts\utilities\gv.ps1 custom-rules-status Show loaded custom rule scopes and files
    .\scripts\utilities\gv.ps1 response-mode                Show active communication settings
    .\scripts\utilities\gv.ps1 response-mode list           List language/detail/profile options
    .\scripts\utilities\gv.ps1 response-mode profile:ultra  Set compression profile
    .\scripts\utilities\gv.ps1 response-mode chat:chat-compact Set chat level bundle
    .\scripts\utilities\gv.ps1 response-mode language:pt-BR Set communication language
    .\scripts\utilities\gv.ps1 response-mode detail:expanded Set detail level
    .\scripts\utilities\gv.ps1 response-mode preset:bugfix Apply preset for task type
    .\scripts\utilities\gv.ps1 response-mode recommend:docs:high Recommend mode for preset+risk
    .\scripts\utilities\gv.ps1 response-mode ahorro         On-demand token saving mode (chat-compact)
    .\scripts\utilities\gv.ps1 response-mode normal         On-demand balanced mode (chat-balanced, override)
    .\scripts\utilities\gv.ps1 response-mode detallado      On-demand detailed mode (chat-detailed, override)
    .\scripts\utilities\gv.ps1 benchmark full      Run full stack benchmark with baseline regression guard
    .\scripts\utilities\gv.ps1 benchmark full remediate Run full benchmark + auto-remediation incident playbook
    .\scripts\utilities\gv.ps1 benchmark full baseline-update Force baseline update with current run
    .\scripts\utilities\gv.ps1 ide-status          Detect IDE and show recommended activation
    .\scripts\utilities\gv.ps1 update              Refresh repository, gentle-vanguard, skills, and optional tools
    .\scripts\utilities\gv.ps1 update-tools         Update required tools and optional integrations
    .\scripts\utilities\gv.ps1 context-pack "fix ci noise"  Generate compact handoff summary for token-efficient continuation
    .\scripts\utilities\gv.ps1 compact-start "fix ci noise" Generate handoff summary and copy compact prompt
    .\scripts\utilities\gv.ps1 context-metrics 14  Show 14-day context usage summary
    .\scripts\utilities\gv.ps1 token-guard         Show token budget status for current session
    .\scripts\utilities\gv.ps1 token-guard publish Check token budget for publish-level workflow
    .\scripts\utilities\gv.ps1 token-guard auto    Run token check and execute autopilot if thresholds persist
    .\scripts\utilities\gv.ps1 token-guard profile:hard      Set autopilot default to hard mode
    .\scripts\utilities\gv.ps1 token-guard profile:balanced  Set autopilot default to balanced mode
    .\scripts\utilities\gv.ps1 checkpoint feature-doc-cleanup  Save rollback point including untracked files
    .\scripts\utilities\gv.ps1 list-checkpoints        Show available rollback points
    .\scripts\utilities\gv.ps1 rollback-checkpoint     Restore latest checkpoint
    .\scripts\utilities\gv.ps1 rollback-checkpoint feature-doc-cleanup Restore matching checkpoint
    .\scripts\utilities\gv.ps1 clean-branches          Preview merged local branches for cleanup
    .\scripts\utilities\gv.ps1 clean-branches apply    Delete merged local branches (asks confirmation)
    .\scripts\utilities\gv.ps1 clean-branches apply -Force  Delete merged branches without prompt, fallback to -D when needed
    .\scripts\utilities\gv.ps1 homologate          Preview normalization actions
    .\scripts\utilities\gv.ps1 homologate apply    Execute normalization and reference updates
    .\scripts\utilities\gv.ps1 release-homologation         Validate VERSION + branch alignment across repos
    .\scripts\utilities\gv.ps1 release-homologation v1.0.0  Validate alignment plus optional tag consistency
    .\scripts\utilities\gv.ps1 health -StrictCleanup  Run health and fail if cleanup drift exists
    .\scripts\utilities\gv.ps1 monthly-report all      Export metrics and build monthly management report
    .\scripts\utilities\gv.ps1 agent-alert           Show process-compliance warnings (non-blocking)
    .\scripts\utilities\gv.ps1 agent-alert strict    Fail if process-compliance warnings are detected
    .\scripts\utilities\gv.ps1 agent list            List all available specialized agents
    .\scripts\utilities\gv.ps1 agent status          Check agent readiness and skill availability
    .\scripts\utilities\gv.ps1 agent DEV "implement login"  Delegate implementation to DEV agent
    .\scripts\utilities\gv.ps1 agent QA "validate checkout"  Delegate testing to QA agent

CHECKPOINT LABEL CONVENTION:
    Use '<scope>-<objective>' in lowercase kebab-case.
    Examples: feature-doc-cleanup, bugfix-hook-timeout, release-prep-check.

"@
}


# Main execution
Invoke-ContextEfficiencyLiveAssist -CommandName $Command -Objective $Scope

switch ($Command) {
    'help' {
        Show-Help
    }
    
    'status' {
        Show-Status
    }

    'checkpoint' {
        Invoke-LiveCheckpoint -Label $Scope
    }

    'list-checkpoints' {
        Show-LiveCheckpoints
    }

    'rollback-checkpoint' {
        Invoke-RollbackCheckpoint -Selector $Scope
    }

    'clean-branches' {
        Invoke-CleanBranches -ApplyNow:($Scope -eq 'apply')
    }

    'start-session' {
        Write-Step "Creating session brief"
        $startScript = Join-Path $scriptDir 'start-session.ps1'
        if (Test-Path $startScript) {
            $startSessionArgs = @()
            if (-not [string]::IsNullOrWhiteSpace($Scope)) { $startSessionArgs += @('-TaskName', $Scope) }
            if ($Force) { $startSessionArgs += '-Force' }
            Invoke-LocalPowerShellScript -ScriptPath $startScript -ScriptArgs $startSessionArgs
        } else {
            Write-Error "Start session script not found: $startScript"
            exit 1
        }
    }

    'task-brief' {
        Write-Step "Creating task brief"
        if ([string]::IsNullOrWhiteSpace($Scope)) {
            Write-Error "Task name required. Example: .\scripts\utilities\gv.ps1 task-brief auth-flow"
            exit 1
        }

        $startScript = Join-Path $scriptDir 'start-session.ps1'
        if (Test-Path $startScript) {
            $taskBriefArgs = @('-TaskName', $Scope, '-Force')
            Invoke-LocalPowerShellScript -ScriptPath $startScript -ScriptArgs $taskBriefArgs
        } else {
            Write-Error "Start session script not found: $startScript"
            exit 1
        }
    }

    'end-session' {
        Write-Step "Running session closure"
        Invoke-TokenBudgetGuard -Task 'end-session' -Risk 'medium' -EstimatedChars 7200
        $endScript = Join-Path $scriptDir '..\SESSION-MANAGEMENT\end-session.ps1'
        if (Test-Path $endScript) {
            # Build end-session params robustly:
            # - supports unquoted multi-word scope (first non-switch tokens)
            # - forwards known options like -MaxArtifacts/-MaxLocalArtifacts
            $endParams = @{}
            $rawArgs = @()
            if (-not [string]::IsNullOrWhiteSpace($Scope)) { $rawArgs += [string]$Scope }
            if ($RemainingArgs) { $rawArgs += @($RemainingArgs | ForEach-Object { [string]$_ }) }

            $taskParts = @()
            $idx = 0
            while ($idx -lt $rawArgs.Count) {
                $token = [string]$rawArgs[$idx]
                if ($token.StartsWith('-')) { break }
                $taskParts += $token
                $idx++
            }

            if ($taskParts.Count -gt 0) {
                $taskName = ($taskParts -join ' ').Trim()
                if (-not [string]::IsNullOrWhiteSpace($taskName)) {
                    $endParams['TaskName'] = $taskName
                }
            }

            while ($idx -lt $rawArgs.Count) {
                $arg = [string]$rawArgs[$idx]
                $next = if ($idx + 1 -lt $rawArgs.Count) { [string]$rawArgs[$idx + 1] } else { '' }

                switch ($arg.ToLowerInvariant()) {
                    '-taskname' {
                        if (-not [string]::IsNullOrWhiteSpace($next)) {
                            $endParams['TaskName'] = $next
                            $idx += 2
                            continue
                        }
                    }
                    '-skipreview' { $endParams['SkipReview'] = $true; $idx++; continue }
                    '-skiptests' { $endParams['SkipTests'] = $true; $idx++; continue }
                    '-skipaudit' { $endParams['SkipAudit'] = $true; $idx++; continue }
                    '-skipgovernance' { $endParams['SkipGovernance'] = $true; $idx++; continue }
                    '-skiprotation' { $endParams['SkipRotation'] = $true; $idx++; continue }
                    '-allowunpublishedclose' { $endParams['AllowUnpublishedClose'] = $true; $idx++; continue }
                    '-force' { $endParams['Force'] = $true; $idx++; continue }
                    '-maxartifacts' {
                        if ($next -match '^\d+$') {
                            $endParams['MaxArtifacts'] = [int]$next
                            $idx += 2
                            continue
                        }
                    }
                    '-maxlocalartifacts' {
                        if ($next -match '^\d+$') {
                            $endParams['MaxLocalArtifacts'] = [int]$next
                            $idx += 2
                            continue
                        }
                    }
                }

                $idx++
            }

            if ($SkipReview) { $endParams['SkipReview'] = $true }
            if ($SkipTests) { $endParams['SkipTests'] = $true }
            if ($Force) { $endParams['Force'] = $true }

            & $endScript @endParams
        } else {
            Write-Error "End session script not found: $endScript"
            exit 1
        }
    }

    'reset-demo' {
        Write-Step "Resetting Demo 07"
        $demoRoot = Join-Path $repoRoot 'demos\07-mixed-cookbook-real-request'
        $resetScript = Join-Path $demoRoot 'reset-demo.ps1'
        if (Test-Path $resetScript) {
            $resetArgs = @()
            if ($Force) { $resetArgs += '-SkipPreflight' }
            Invoke-LocalPowerShellScript -ScriptPath $resetScript -ScriptArgs $resetArgs
        } else {
            Write-Error "Reset script not found: $resetScript"
            exit 1
        }
    }

    'day-end-closure' {
        Write-Step "Running automated day-end closure"
        Invoke-TokenBudgetGuard -Task 'end-session' -Risk 'high' -EstimatedChars 14000
        $dayEndScript = Join-Path $scriptDir '..\UTILITIES\day-end-closure.ps1'
        if (Test-Path $dayEndScript) {
            if (-not [string]::IsNullOrWhiteSpace($Scope)) {
                & $dayEndScript -SessionId $Scope -SkipValidation:$SkipTests -Force:$Force
            } else {
                & $dayEndScript -SkipValidation:$SkipTests -Force:$Force
            }
        } else {
            Write-Error "Day-end closure script not found: $dayEndScript"
            exit 1
        }
    }
    
    'update' {
        Invoke-Update
    }

    'update-all' {
        Invoke-UpdateAll
    }

    'update-tools' {
        Write-Step "Updating tools (required + optional integrations)"
        $toolsScript = Join-Path $scriptDir 'update-tools.ps1'
        if (-not (Test-Path $toolsScript)) {
            Write-Error "update-tools.ps1 not found: $toolsScript"
            exit 1
        }
        $toolsArgs = @()
        if ($Force) { $toolsArgs += '-Force' }
        Invoke-LocalPowerShellScript -ScriptPath $toolsScript -ScriptArgs $toolsArgs
    }

    'review' {
        Write-Step "Code Review - $($Scope.ToUpper())"

        if ($Scope -eq 'judgment-day') {
            $jdScript = Join-Path $scriptDir 'judgment-day.ps1'
            if (-not (Test-Path $jdScript)) {
                Write-Error "judgment-day.ps1 not found at WORKFLOW-ORCHESTRATION"
                exit 1
            }

            Write-Host " Running: judgment-day.ps1 (dual-review adversarial protocol)" -ForegroundColor Cyan
            & $jdScript -Scope Full -NoPrompt
            $exitCode = $LASTEXITCODE
        } else {
            $reviewScript = Join-Path $repoRoot 'skills\code-review-orchestrator-skill\code-review.ps1'
            if (-not (Test-Path $reviewScript)) {
                Write-Error "Code review script not found: $reviewScript"
                exit 1
            }

            $reviewArgs = @()
            if ($Scope) {
                $reviewArgs += $Scope
            } else {
                $reviewArgs += 'all'
            }

            Write-Host " Running: code-review.ps1 --scope $($reviewArgs -join ' ')" -ForegroundColor Cyan
            & $reviewScript @reviewArgs
            $exitCode = $LASTEXITCODE
        }

        if ($exitCode -ne 0) {
            Write-Error "Code review found issues"
            exit $exitCode
        }

        Write-Success "Code review complete"
    }

    'judgment-day' {
        Write-Step "Judgment Day - Dual-Review Adversarial Protocol"

        $jdScript = Join-Path $scriptDir 'judgment-day.ps1'
        if (-not (Test-Path $jdScript)) {
            Write-Error "judgment-day.ps1 not found at WORKFLOW-ORCHESTRATION"
            exit 1
        }

        $jdArgs = @{}
        if ($Scope) { $jdArgs.Target = $Scope }

        & $jdScript @jdArgs
        $exitCode = $LASTEXITCODE

        if ($exitCode -ne 0) {
            Write-Error "Judgment Day found issues - escalation required"
            exit $exitCode
        }

        Write-Success "Judgment Day complete - APPROVED"
    }
    
    'audit' {
        Write-Step "Generating Audit"
        Invoke-TokenBudgetGuard -Task 'audit' -Risk 'medium' -EstimatedChars 8800

        $auditWorkflow = Join-Path $repoRoot 'skills\gentle-vanguard-audit-skill\scripts\audit-workflow.ps1'
        $auditModes = @('quick', 'standard', 'full', 'deep', 'judgment', 'unified')
        $normalizedScope = if ($Scope) { $Scope.ToLowerInvariant() } else { $null }

        if ($normalizedScope) {
            if (-not ($auditModes -contains $normalizedScope)) {
                Write-Error "Invalid audit scope '$Scope'. Valid scopes: $($auditModes -join ', ')"
                exit 1
            }

            # Structured audit via audit-workflow.ps1
            if (-not (Test-Path $auditWorkflow)) {
                Write-Error "audit-workflow.ps1 not found: $auditWorkflow"
                exit 1
            }
            Write-Host " Mode: $normalizedScope" -ForegroundColor Gray
            & $auditWorkflow -Mode $normalizedScope -BasePath $repoRoot
            if ($LASTEXITCODE -ne 0) {
                Write-Error "audit-workflow failed with exit code $LASTEXITCODE"
                exit $LASTEXITCODE
            }
        } else {
            # Default: generate audit markdown document
            $outputDir = Join-Path $repoRoot 'docs/audits'
            if (-not (Test-Path $outputDir)) {
                New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
            }

            $dateStr = Get-Date -Format "yyyy-MM-dd-HHmmss"
            $outputPath = Join-Path $outputDir "$dateStr-audit.md"

            New-AuditDocument -OutputPath $outputPath

            Write-Host ""
            Write-Host "Tip: Use scoped audit modes for structural validation:" -ForegroundColor DarkGray
            Write-Host "  gv.ps1 audit quick     -- fast structure check (0 tokens)" -ForegroundColor DarkGray
            Write-Host "  gv.ps1 audit standard  -- + links and skill validation" -ForegroundColor DarkGray
            Write-Host "  gv.ps1 audit full      -- complete batch sweep" -ForegroundColor DarkGray
            Write-Host "  gv.ps1 audit deep      -- + orphaned docs sweep" -ForegroundColor DarkGray
            Write-Host "  gv.ps1 audit judgment  -- full sweep + adversarial AI review" -ForegroundColor DarkGray
        }
    }
    
    'pr' {
        if (-not (Get-BranchStatus)) { exit 0 }
        
        Write-Step "Creating Pull Request"
        
        # Run review first
        if (-not $SkipReview) {
            & "$PSCommandPath" review -SkipTests
        }
        
        # Generate PR template
        $prPath = Join-Path $repoRoot '.github/PULL_REQUEST_TEMPLATE.md'
        if (-not (Test-Path (Split-Path $prPath))) {
            New-Item -ItemType Directory -Path (Split-Path $prPath) -Force | Out-Null
        }
        
        New-PRDescription -OutputPath $prPath
        Write-Host ""
        Write-Host "PR template created at: $prPath" -ForegroundColor Cyan
        Write-Host "Edit the template and run: gh pr create" -ForegroundColor Cyan
    }
    
    'push' {
        if (-not (Get-BranchStatus)) { exit 0 }
        
        Write-Step "Pushing Changes"
        Warn-OldWorkflowCheckpoints -ThresholdDays 7
        
        # Check secrets
        if (-not (Test-Secrets)) {
            Write-Error "Secrets detected - push blocked"
            exit 1
        }
        
        # Run tests
        if (-not $SkipTests) {
            Test-GoTests | Out-Null
            Test-AngularTests | Out-Null
        }
        
        # Generate audit
        & "$PSCommandPath" audit

        $publishMode = Resolve-PublishMode -RequestedMode $Scope -ForceMode:$Force
        $gitInfo = Get-GitInfo
        $branchName = if ([string]::IsNullOrWhiteSpace($gitInfo.Branch)) { '<current-branch>' } else { $gitInfo.Branch }
        
        # Commit and push
        Write-Host ""
        if ($publishMode -eq 'push+pr') {
            Write-Host "Run the following commands (push + PR):" -ForegroundColor Cyan
            Write-Host "  git add ." -ForegroundColor Yellow
            Write-Host "  git commit -m 'type(scope): description'" -ForegroundColor Yellow
            Write-Host "  git push -u origin $branchName" -ForegroundColor Yellow
            Write-Host "  gh pr create --fill" -ForegroundColor Yellow
        } else {
            Write-Host "Run the following commands (push only):" -ForegroundColor Cyan
            Write-Host "  git add ." -ForegroundColor Yellow
            Write-Host "  git commit -m 'type(scope): description'" -ForegroundColor Yellow
            Write-Host "  git push" -ForegroundColor Yellow
            Write-Host "" 
            Write-Host "Later, create PR with:" -ForegroundColor Cyan
            Write-Host "  .\scripts\utilities\gv.ps1 pr" -ForegroundColor Yellow
        }
    }

    'publish' {
        Invoke-TokenBudgetGuard -Task 'publish' -Risk 'high' -EstimatedChars 18000
        Invoke-PublishWorkflow -SkipReviewGate:$SkipReview -SkipTestsGate:$SkipTests -SkipHomologationGate:$SkipHomologationGate -ForceMode:$Force
    }
    
    'health' {
        Write-Step "System Health Check & Tool Activation"
        
        $healthScript = Join-Path $scriptDir '..\SKILLS-TOOLS\ensure-tools-active.ps1'
        if (Test-Path $healthScript) {
            $healthArgs = @('-AutoStart')
            if ($Force) { $healthArgs += "-Force" }
            Invoke-LocalPowerShellScript -ScriptPath $healthScript -ScriptArgs $healthArgs
        } else {
            Write-Error "Health check script not found: $healthScript"
            exit 1
        }

        $homologateScript = Join-Path $scriptDir '..\..\validation\homologate-workspace.ps1'
        if (Test-Path $homologateScript) {
            Write-Step "Homologation Drift Preview"
            $homologateArgs = @('-OrganizeRootDocs')
            if ($StrictCleanup) {
                $homologateArgs += '-FailOnChanges'
            }

            Invoke-LocalPowerShellScript -ScriptPath $homologateScript -ScriptArgs $homologateArgs

            if ($StrictCleanup -and $LASTEXITCODE -ne 0) {
                Write-Error "Strict cleanup mode failed: run '.\scripts\utilities\gv.ps1 homologate apply' to remediate drift."
                exit $LASTEXITCODE
            }
        }
    }

    'orchestrator-status' {
        Write-Step "Checking Orchestrator and Engram integration"
        $statusScript = Join-Path $scriptDir 'orchestrator-status.ps1'
        if (Test-Path $statusScript) {
            Invoke-LocalPowerShellScript -ScriptPath $statusScript
        } else {
            Write-Error "Orchestrator status script not found: $statusScript"
            exit 1
        }
    }

    'stack-dashboard' {
        $dashboardScript = Join-Path $scriptDir '..\UTILITIES\stack-dashboard.ps1'
        $liveScript = Join-Path $scriptDir '..\UTILITIES\stack-live-observability.ps1'
        if (-not (Test-Path $dashboardScript)) {
            Write-Error "Stack dashboard script not found: $dashboardScript"
            exit 1
        }

        $isStrict = $StrictCleanup -or ($Scope -eq 'strict')

        if ($Scope -eq 'live') {
            if (-not (Test-Path $liveScript)) {
                Write-Error "Live observability script not found: $liveScript"
                exit 1
            }

            if ($JSON) {
                & $liveScript -AsJson
            } else {
                & $liveScript -Watch
            }
            exit $LASTEXITCODE
        }

        if ($JSON) {
            if ($isStrict) {
                & $dashboardScript -AsJson -Strict
            } else {
                & $dashboardScript -AsJson
            }
        } else {
            if ($isStrict) {
                & $dashboardScript -Strict
            } else {
                Invoke-LocalPowerShellScript -ScriptPath $dashboardScript
            }
        }
    }

    'runtime-route' {
        if (-not $JSON) {
            Write-Step "Runtime Route"
        }
        $routeScript = Join-Path $scriptDir 'runtime-router.ps1'
        if (-not (Test-Path $routeScript)) {
            Write-Error "Runtime router script not found: $routeScript"
            exit 1
        }

        $isStrict = $StrictCleanup -or ($Scope -eq 'strict')
        if ($JSON) {
            if ($isStrict) {
                & $routeScript -Mode route -AsJson -Strict
            } else {
                & $routeScript -Mode route -AsJson
            }
        } else {
            if ($isStrict) {
                & $routeScript -Mode route -Strict
            } else {
                & $routeScript -Mode route
            }
        }
    }

    'runtime-gate' {
        $routeScript = Join-Path $scriptDir 'runtime-router.ps1'
        if (-not (Test-Path $routeScript)) {
            Write-Error "Runtime router script not found: $routeScript"
            exit 1
        }
        $taskType = if ($Scope) { $Scope } else { 'any' }
        if ($JSON) {
            & $routeScript -Mode gate -TaskType $taskType -AsJson
        } else {
            Write-Step "Runtime Gate - task: $taskType"
            & $routeScript -Mode gate -TaskType $taskType
        }
    }

    'custom-rules-status' {
        Write-Step "Custom Rules Status"
        $rulesScript = Join-Path $scriptDir '..\UTILITIES\custom-rules.ps1'
        if (-not (Test-Path $rulesScript)) {
            Write-Error "Custom rules script not found: $rulesScript"
            exit 1
        }

        $rulesArgs = @('status')
        if ($JSON) { $rulesArgs += '-AsJson' }
        Invoke-LocalPowerShellScript -ScriptPath $rulesScript -ScriptArgs $rulesArgs
    }
    'response-mode' {
        Write-Step 'Response Profile'
        $modeScript = Join-Path $scriptDir '..\UTILITIES\response-mode.ps1'
        if (-not (Test-Path $modeScript)) {
            Write-Error "Response mode script not found: $modeScript"
            exit 1
        }

        $modeParams = @{
            Mode = 'status'
        }

        $scopeText = [string]$Scope
        if (-not [string]::IsNullOrWhiteSpace($scopeText)) {
            if ($scopeText -eq 'list') {
                $modeParams = @{ Mode = 'list' }
            }
            elseif ($scopeText -match '^profile:(.+)$') {
                $modeParams = @{ Mode = 'set'; Profile = $matches[1] }
            }
            elseif ($scopeText -match '^language:(.+)$') {
                $modeParams = @{ Mode = 'set-language'; Language = $matches[1] }
            }
            elseif ($scopeText -match '^detail:(.+)$') {
                $modeParams = @{ Mode = 'set-detail'; Detail = $matches[1] }
            }
            elseif ($scopeText -match '^chat:(.+)$') {
                $modeParams = @{ Mode = 'set-chat-level'; ChatLevel = $matches[1] }
            }
            elseif ($scopeText -match '^preset:(.+)$') {
                $modeParams = @{ Mode = 'set-preset'; Preset = $matches[1] }
            }
            elseif ($scopeText -match '^recommend:([^:]+):([^:]+)$') {
                $modeParams = @{ Mode = 'recommend'; Preset = $matches[1]; Risk = $matches[2] }
            }
            elseif ($scopeText -match '^recommend:([^:]+)$') {
                $modeParams = @{ Mode = 'recommend'; Preset = $matches[1] }
            }
            elseif ($scopeText -in @('lite', 'lleno', 'ultra')) {
                $modeParams = @{ Mode = 'set'; Profile = $scopeText }
            }
            elseif ($scopeText -in @('es', 'pt-BR', 'en')) {
                $modeParams = @{ Mode = 'set-language'; Language = $scopeText }
            }
            elseif ($scopeText -in @('simple', 'executive', 'expanded')) {
                $modeParams = @{ Mode = 'set-detail'; Detail = $scopeText }
            }
            elseif ($scopeText -in @('chat-compact', 'chat-balanced', 'chat-detailed')) {
                $modeParams = @{ Mode = 'set-chat-level'; ChatLevel = $scopeText }
            }
            elseif ($scopeText -in @('ahorro', 'modo-ahorro', 'ahorro-on', 'economy', 'token-save')) {
                $modeParams = @{ Mode = 'set-chat-level'; ChatLevel = 'chat-compact' }
            }
            elseif ($scopeText -in @('normal', 'balanceado', 'modo-normal', 'ahorro-off')) {
                $modeParams = @{ Mode = 'set-chat-level'; ChatLevel = 'chat-balanced'; AllowPolicyOverride = $true; OverrideReason = 'manual-demand:balanced-chat' }
            }
            elseif ($scopeText -in @('detallado', 'detalle', 'full', 'verbose')) {
                $modeParams = @{ Mode = 'set-chat-level'; ChatLevel = 'chat-detailed'; AllowPolicyOverride = $true; OverrideReason = 'manual-demand:detailed-chat' }
            }
            elseif ($scopeText -in @('bugfix', 'refactor', 'docs', 'audit-review', 'executive-demo')) {
                $modeParams = @{ Mode = 'set-preset'; Preset = $scopeText }
            }
        }

        if ($JSON) { $modeParams['AsJson'] = $true }
        & $modeScript @modeParams
    }
    'ide-status' {
        Show-IdeStatus
    }
    'install-engram' {
        Write-Step "Installing or verifying Engram CLI"
        $installScript = Join-Path $scriptDir '..\SKILLS-TOOLS\install-engram.ps1'
        if (Test-Path $installScript) {
            $installArgs = @()
            if ($Force) { $installArgs += '-Force' }
            Invoke-LocalPowerShellScript -ScriptPath $installScript -ScriptArgs $installArgs
        } else {
            Write-Error "Install script not found: $installScript"
            exit 1
        }
    }
    
    'verify' {
        Write-Step "Quick Stack Verification & Auto-Repair"
        $diagScript = $null
        $diagPaths = @(
            (Join-Path $scriptDir '..\..\diagnostics\system-diagnostics.ps1'),
            (Join-Path $repoRoot 'scripts\diagnostics\system-diagnostics.ps1')
        )
        foreach ($path in $diagPaths) {
            if (Test-Path $path) {
                $diagScript = $path
                break
            }
        }
        if ($diagScript) {
            Invoke-LocalPowerShellScript -ScriptPath $diagScript -ScriptArgs @('-AutoRepair', '-Quiet')
            Write-Success "Stack verification and repair completed"
        } else {
            Write-Error "Diagnostics script not found"
            exit 1
        }
    }

    'diagnose' {
        Write-Step "Running Full System Diagnostics"
        # Try multiple paths to find diagnostics script
        $diagPaths = @(
            (Join-Path $scriptDir '..\..\diagnostics\system-diagnostics.ps1'),
            (Join-Path $repoRoot 'scripts\diagnostics\system-diagnostics.ps1')
        )
        $found = $false
        foreach ($path in $diagPaths) {
            if (Test-Path $path) {
                $diagnoseArgs = @()
                if ($JSON) { $diagnoseArgs += '-JSON' }
                Invoke-LocalPowerShellScript -ScriptPath $path -ScriptArgs $diagnoseArgs
                $found = $true
                break
            }
        }
        if (-not $found) {
            Write-Error "Diagnostics script not found"
            exit 1
        }
    }
    
    'migrate-structure' {
        Write-Step "Structure Migration"
        $migrateScript = Join-Path $scriptDir 'migrate-structure.ps1'
        if (-not (Test-Path $migrateScript)) {
            Write-Error "Migration script not found: $migrateScript"
            exit 1
        }
        $migrateArgs = @()
        if ($SkipTests) { $migrateArgs += '-DryRun' }
        if ($Force)     { $migrateArgs += '-Force' }
        Invoke-LocalPowerShellScript -ScriptPath $migrateScript -ScriptArgs $migrateArgs
    }

    'context-dashboard' {
        $dashScript = Join-Path $repoRoot 'scripts\utilities\TELEMETRY-METRICS\context-dashboard.ps1'
        if (-not (Test-Path $dashScript)) {
            Write-Error "context-dashboard.ps1 not found at: $dashScript"
            exit 1
        }
        $promptCharsArg = if ($Scope -match '^\d+$') { [int]$Scope } else { 0 }
        & $dashScript -PromptChars $promptCharsArg
    }

    'dashboard' {
        $genScript = Join-Path $repoRoot 'scripts\utilities\TELEMETRY-METRICS\generate-dashboard.ps1'
        $liveDashboardScript = Join-Path $repoRoot 'scripts\utilities\TELEMETRY-METRICS\dashboard-live-refresh.ps1'
        $dashboardPidFile = Join-Path $repoRoot 'reports\dashboard-live.pid'
        $liveUrl = 'http://localhost:8090/dashboard.html'
        if (-not (Test-Path $genScript)) {
            Write-Error "generate-dashboard.ps1 not found at: $genScript"; exit 1
        }

        if ($Scope -in @('auto', 'start', 'background', 'bg')) {
            if (-not (Test-Path $liveDashboardScript)) {
                Write-Error "dashboard-live-refresh.ps1 not found at: $liveDashboardScript"; exit 1
            }

            $existingMeta = $null
            $existingPid = 0
            if (Test-Path $dashboardPidFile) {
                try {
                    $existingMeta = Get-Content $dashboardPidFile -Raw | ConvertFrom-Json -ErrorAction Stop
                    $existingPid = [int]$existingMeta.pid
                }
                catch {
                    $existingMeta = $null
                    $existingPid = 0
                }
            }

            if ($existingPid -gt 0) {
                $existingProc = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
                if ($existingProc) {
                    Write-Success "Dashboard auto service already running (PID $existingPid)."
                    Write-Host "Live URL: $liveUrl" -ForegroundColor Cyan
                    if ($IsWindows -or $env:OS -eq 'Windows_NT') {
                        Start-Process $liveUrl | Out-Null
                    }
                    exit 0
                }
            }

            $pwshPath = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
            if (-not $pwshPath) {
                $pwshPath = 'pwsh'
            }

            $liveArgs = @(
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-File', $liveDashboardScript,
                '-Open'
            )

            $i = 0
            while ($i -lt $RemainingArgs.Count) {
                $arg = [string]$RemainingArgs[$i]
                if ($arg -in @('-RefreshSeconds', '-BenchmarkEvery', '-Iterations', '-WebhookUrl', '-WebhookProvider', '-GitHubRepo', '-GitHubToken') -and $i + 1 -lt $RemainingArgs.Count) {
                    $liveArgs += $arg
                    $liveArgs += [string]$RemainingArgs[$i + 1]
                    $i += 2
                }
                elseif ($arg -in @('-AutoRemediateOnFail', '-EnablePredictor', '-EnableSLADashboard')) {
                    $liveArgs += $arg
                    $i++
                }
                else {
                    $i++
                }
            }

            $reportsDir = Split-Path -Parent $dashboardPidFile
            if (-not (Test-Path $reportsDir)) {
                New-Item -ItemType Directory -Path $reportsDir -Force | Out-Null
            }

            $proc = Start-Process -FilePath $pwshPath -ArgumentList $liveArgs -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
            $pidMeta = [ordered]@{
                pid = $proc.Id
                started_at = (Get-Date).ToString('o')
                url = $liveUrl
            }
            $pidMeta | ConvertTo-Json | Set-Content -Path $dashboardPidFile -Encoding UTF8

            Write-Success "Dashboard auto service started (PID $($proc.Id))."
            Write-Host "Live URL: $liveUrl" -ForegroundColor Cyan
            Write-Host "Use 'gv dashboard status' to check and 'gv dashboard stop' to stop." -ForegroundColor Gray
            if ($IsWindows -or $env:OS -eq 'Windows_NT') {
                Start-Process $liveUrl | Out-Null
            }
            exit 0
        }

        if ($Scope -eq 'status') {
            if (-not (Test-Path $dashboardPidFile)) {
                Write-Warning 'Dashboard auto service is not running (pid file not found).'
                exit 0
            }

            try {
                $pidMeta = Get-Content $dashboardPidFile -Raw | ConvertFrom-Json -ErrorAction Stop
                $pidValue = [int]$pidMeta.pid
            }
            catch {
                Write-Warning 'Dashboard pid metadata is invalid. Remove reports/dashboard-live.pid and restart auto mode.'
                exit 1
            }

            $statusProc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
            if ($statusProc) {
                Write-Success "Dashboard auto service running (PID $pidValue)."
                Write-Host "Started: $($pidMeta.started_at)" -ForegroundColor Gray
                Write-Host "Live URL: $($pidMeta.url)" -ForegroundColor Cyan
            }
            else {
                Write-Warning "Dashboard auto service is not running (stale pid $pidValue)."
                Remove-Item $dashboardPidFile -Force -ErrorAction SilentlyContinue
            }
            exit 0
        }

        if ($Scope -eq 'stop') {
            if (-not (Test-Path $dashboardPidFile)) {
                Write-Warning 'Dashboard auto service is not running.'
                exit 0
            }

            try {
                $pidMeta = Get-Content $dashboardPidFile -Raw | ConvertFrom-Json -ErrorAction Stop
                $pidValue = [int]$pidMeta.pid
            }
            catch {
                Remove-Item $dashboardPidFile -Force -ErrorAction SilentlyContinue
                Write-Warning 'Dashboard pid metadata was invalid and has been cleared.'
                exit 0
            }

            $stopProc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
            if ($stopProc) {
                Stop-Process -Id $pidValue -Force
                Write-Success "Dashboard auto service stopped (PID $pidValue)."
            }
            else {
                Write-Warning "Dashboard process $pidValue was not running."
            }

            Remove-Item $dashboardPidFile -Force -ErrorAction SilentlyContinue
            exit 0
        }

        if ($Scope -in @('live', 'live-open', 'open-live')) {
            if (-not (Test-Path $liveDashboardScript)) {
                Write-Error "dashboard-live-refresh.ps1 not found at: $liveDashboardScript"; exit 1
            }

            # Build hashtable for live dashboard parameters (supports RemainingArgs override)
            $liveParams = @{
                RefreshSeconds = 15
                BenchmarkEvery = 4
                Open = $true
            }
            
            # Parse RemainingArgs for parameter overrides
            $i = 0
            while ($i -lt $RemainingArgs.Count) {
                $arg = $RemainingArgs[$i]
                if ($arg -eq '-RefreshSeconds' -and $i + 1 -lt $RemainingArgs.Count) {
                    $liveParams['RefreshSeconds'] = [int]$RemainingArgs[$i + 1]
                    $i += 2
                } elseif ($arg -eq '-BenchmarkEvery' -and $i + 1 -lt $RemainingArgs.Count) {
                    $liveParams['BenchmarkEvery'] = [int]$RemainingArgs[$i + 1]
                    $i += 2
                } elseif ($arg -eq '-Iterations' -and $i + 1 -lt $RemainingArgs.Count) {
                    $liveParams['Iterations'] = [int]$RemainingArgs[$i + 1]
                    $i += 2
                } elseif ($arg -eq '-WebhookUrl' -and $i + 1 -lt $RemainingArgs.Count) {
                    $liveParams['WebhookUrl'] = [string]$RemainingArgs[$i + 1]
                    $i += 2
                } elseif ($arg -eq '-WebhookProvider' -and $i + 1 -lt $RemainingArgs.Count) {
                    $liveParams['WebhookProvider'] = [string]$RemainingArgs[$i + 1]
                    $i += 2
                } elseif ($arg -eq '-GitHubRepo' -and $i + 1 -lt $RemainingArgs.Count) {
                    $liveParams['GitHubRepo'] = [string]$RemainingArgs[$i + 1]
                    $i += 2
                } elseif ($arg -eq '-GitHubToken' -and $i + 1 -lt $RemainingArgs.Count) {
                    $liveParams['GitHubToken'] = [string]$RemainingArgs[$i + 1]
                    $i += 2
                } elseif ($arg -eq '-AutoRemediateOnFail') {
                    $liveParams['AutoRemediateOnFail'] = $true
                    $i++
                } elseif ($arg -eq '-EnablePredictor') {
                    $liveParams['EnablePredictor'] = $true
                    $i++
                } elseif ($arg -eq '-EnableSLADashboard') {
                    $liveParams['EnableSLADashboard'] = $true
                    $i++
                } else {
                    $i++
                }
            }
            
            & $liveDashboardScript @liveParams
            exit $LASTEXITCODE
        }

        $openFlag = if ($Scope -eq 'open') { $true } else { $false }
        if ($openFlag) { & $genScript -Open }
        else           { & $genScript }
    }

    'mq' {
        $mqScript = Join-Path $repoRoot 'scripts\utilities\WORKFLOW-ORCHESTRATION\mq-adapter.ps1'
        if (-not (Test-Path $mqScript)) {
            Write-Error "mq-adapter.ps1 not found at: $mqScript"; exit 1
        }
        $mqAction = if ($Scope) { $Scope } else { 'status' }
        & $mqScript -Action $mqAction
    }

    'export-metrics' {
        $exportScript = Join-Path $repoRoot 'scripts\utilities\TELEMETRY-METRICS\export-metrics.ps1'
        if (-not (Test-Path $exportScript)) {
            Write-Error "export-metrics.ps1 not found at: $exportScript"; exit 1
        }
        $fmt = if ($Scope -in @('csv','jsonl','sqlite','all')) { $Scope } else { 'csv' }
        & $exportScript -Format $fmt
    }

    'monthly-report' {
        Write-Step "Monthly management report pipeline"

        $fmt = if ($Scope -in @('csv','jsonl','sqlite','all')) { $Scope } else { 'csv' }
        $exportScript = Join-Path $repoRoot 'scripts\utilities\TELEMETRY-METRICS\export-metrics.ps1'
        $reportScript = Join-Path $repoRoot 'scripts\utilities\TELEMETRY-METRICS\generate-management-report.ps1'

        if (-not (Test-Path $exportScript)) {
            Write-Error "export-metrics.ps1 not found at: $exportScript"
            exit 1
        }

        if (-not (Test-Path $reportScript)) {
            Write-Error "generate-management-report.ps1 not found at: $reportScript"
            exit 1
        }

        & $exportScript -Format $fmt
        if (-not $?) {
            Write-Error "export-metrics failed."
            exit 1
        }

        & $reportScript -OnDemand
        if (-not $?) {
            Write-Error "generate-management-report failed."
            exit 1
        }

        Write-Success "Monthly report pipeline finished."
    }

    'platform-info' {
        $compat = Join-Path $repoRoot 'scripts\utilities\platform-compat.ps1'
        if (Test-Path $compat) {
            . $compat
            Write-Host (Get-PlatformInfo) -ForegroundColor Cyan
        } else {
            $platform = if ($IsWindows) { 'windows' } elseif ($IsMacOS) { 'macos' } else { 'linux' }
            Write-Host "[platform: $platform | pwsh: $($PSVersionTable.PSVersion)]" -ForegroundColor Cyan
        }
    }

    'sdd-gate' {
        # FF-001: Run SDD gate check (local validation)
        $sddGateScript = Join-Path $repoRoot 'scripts\hooks\check-sdd-gate.ps1'
        if (-not (Test-Path $sddGateScript)) {
            Write-Error "check-sdd-gate.ps1 not found: $sddGateScript"
            exit 1
        }
        & $sddGateScript
        exit $LASTEXITCODE
    }

    'sdd-metrics' {
        # FF-002: SDD process KPIs - spec coverage, lead time, rework ratio
        $metricsScript = Join-Path $repoRoot 'scripts\utilities\TELEMETRY-METRICS\sdd-process-metrics.ps1'
        if (-not (Test-Path $metricsScript)) {
            Write-Error "sdd-process-metrics.ps1 not found: $metricsScript"
            exit 1
        }
        $asJson = $Scope -eq '-JSON' -or $Scope -eq 'json'
        if ($asJson) { & $metricsScript -AsJson } else { & $metricsScript }
        exit $LASTEXITCODE
    }

    'sync-drift' {
        # FF-004: Sync drift report - declared config vs actual filesystem
        $driftScript = Join-Path $repoRoot 'scripts\utilities\sync-drift-report.ps1'
        if (-not (Test-Path $driftScript)) {
            Write-Error "sync-drift-report.ps1 not found: $driftScript"
            exit 1
        }
        $asJson = $Scope -eq '-JSON' -or $Scope -eq 'json'
        if ($asJson) { & $driftScript -AsJson } else { & $driftScript }
        exit $LASTEXITCODE
    }

    'gentle-vanguard-sync' {
        $syncScript = Join-Path $repoRoot 'scripts\utilities\UTILITIES\gentle-vanguard-sync.ps1'
        if (-not (Test-Path $syncScript)) {
            Write-Error "gentle-vanguard-sync.ps1 not found: $syncScript"
            exit 1
        }

        $createPr = $RemainingArgs -contains '-CreatePr' -or $RemainingArgs -contains '-CreatePR'

        if ($Scope -eq 'apply') {
            & $syncScript -Mode apply -Force:$Force -CreatePR:$createPr
        } else {
            & $syncScript -Mode check -Force:$Force
        }
        exit $LASTEXITCODE
    }

    'release-homologation' {
        $gateScript = Join-Path $repoRoot 'scripts\utilities\DEPLOYMENT\validate-release-homologation.ps1'
        if (-not (Test-Path $gateScript)) {
            Write-Error "validate-release-homologation.ps1 not found: $gateScript"
            exit 1
        }

        $gateArgs = @{}
        if (-not [string]::IsNullOrWhiteSpace($Scope)) {
            $gateArgs['ExpectedTag'] = $Scope
        }
        if ($JSON) {
            $gateArgs['AsJson'] = $true
        }

        & $gateScript @gateArgs
        exit $LASTEXITCODE
    }

    'benchmark' {
        if ($Scope -eq 'full') {
            $fullBenchScript = Join-Path $repoRoot 'scripts\utilities\gv-stack-benchmark.ps1'
            if (-not (Test-Path $fullBenchScript)) {
                Write-Error "gv-stack-benchmark.ps1 not found: $fullBenchScript"
                exit 1
            }

            $extraArgs = @($RemainingArgs | ForEach-Object { [string]$_ })
            $autoRemediate = $extraArgs -contains 'remediate' -or $extraArgs -contains 'auto-remediate'
            $updateBaseline = $extraArgs -contains 'baseline-update' -or $extraArgs -contains 'update-baseline'

            $benchParams = @{}
            if ($JSON) { $benchParams['AsJson'] = $true }
            if (-not $JSON) { $benchParams['Strict'] = $true }
            if ($autoRemediate) { $benchParams['AutoRemediate'] = $true }
            if ($updateBaseline) { $benchParams['UpdateBaseline'] = $true }

            & $fullBenchScript @benchParams
            exit $LASTEXITCODE
        }

        # FF-006: Profile key gv commands against SLO thresholds
        $benchScript = Join-Path $repoRoot 'scripts\utilities\gv-benchmark.ps1'
        if (-not (Test-Path $benchScript)) {
            Write-Error "gv-benchmark.ps1 not found: $benchScript"
            exit 1
        }
        $cmds = @()
        if ($Scope) {
            $cmds += $Scope -split ','
        }
        if ($RemainingArgs) {
            $cmds += $RemainingArgs
        }
        $cmds = @($cmds | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        if ($cmds.Count -eq 0) {
            $cmds = @('status', 'health')
        }
        & $benchScript -Commands $cmds
        exit $LASTEXITCODE
    }

    'learning' {
        # Post-session learning analysis — detect gaps, propose improvements
        Write-Step "Post-Session Learning Analysis"
        $learningScript = Join-Path $repoRoot 'scripts' 'utilities' 'post-session-learning.ps1'
        $executorScript = Join-Path $repoRoot 'scripts' 'utilities' 'proposal-executor.ps1'
        if (-not (Test-Path $learningScript)) {
            Write-Error "post-session-learning.ps1 not found"
            exit 1
        }
        if ($Scope -eq 'auto') {
            & $learningScript -AutoApplyLow
            if (Test-Path $executorScript) {
                & $executorScript -AutoApply -CreatePR:$($Scope -eq 'auto-pr')
            }
        } elseif ($Scope -eq 'apply') {
            if (Test-Path $executorScript) {
                & $executorScript -AutoApply -CreatePR:$false
            } else {
                Write-Error "proposal-executor.ps1 not found"
                exit 1
            }
        } elseif ($Scope -eq 'auto-pr') {
            & $learningScript -AutoApplyLow
            if (Test-Path $executorScript) {
                & $executorScript -AutoApply -CreatePR:$true
            }
        } else {
            & $learningScript
        }
        Write-Host "`n[HINT] Review proposals in: .local/improvement-proposals/" -ForegroundColor Yellow
        Write-Host "[HINT] Run 'gv learning apply' to execute pending proposals" -ForegroundColor Yellow
        Write-Host "[HINT] Run 'gv learning auto' to analyze + auto-apply low-severity" -ForegroundColor Yellow
        Write-Host "[HINT] Run 'gv learning auto-pr' to auto-apply + create PR" -ForegroundColor Yellow
        exit $LASTEXITCODE
    }

    'watchtower' {
        # Proactive session monitoring — git, tokens, context, proposals, errors
        Write-Step "Watchtower Agent"
        $watchtowerScript = Join-Path $repoRoot 'scripts' 'utilities' 'watchtower.ps1'
        if (-not (Test-Path $watchtowerScript)) {
            Write-Error "watchtower.ps1 not found"
            exit 1
        }
        if ($Scope -eq 'fix') {
            & $watchtowerScript -AutoFix
        } elseif ($Scope -eq 'quiet') {
            & $watchtowerScript -Quiet
        } elseif ($Scope -eq 'all') {
            & $watchtowerScript -AutoFix
        } elseif ($Scope -eq 'heal') {
            $healScript = Join-Path $repoRoot 'scripts' 'utilities' 'self-heal.ps1'
            if (Test-Path $healScript) {
                & $healScript -AutoFix
            } else {
                Write-Warning "self-heal.ps1 not found — skipping heal step"
            }
            & $watchtowerScript -AutoFix
        } else {
            & $watchtowerScript
        }
        Write-Host "`n[HINT] Run 'gv watchtower fix' to auto-remediate low-severity issues" -ForegroundColor Yellow
        Write-Host "[HINT] Run 'gv watchtower quiet' for silent mode" -ForegroundColor Yellow
        Write-Host "[HINT] Run 'gv watchtower all' for full check + auto-fix" -ForegroundColor Yellow
        Write-Host "[HINT] Run 'gv watchtower heal' for full check + auto-fix + self-heal" -ForegroundColor Yellow
        Write-Host "[HINT] Run 'gv watchtower heal' to run watchtower + auto-heal" -ForegroundColor Yellow
        exit $LASTEXITCODE
    }

    'heal' {
        # Self-Healing Stack — detect and repair common infrastructure issues
        Write-Step "Self-Healing Stack"
        $healScript = Join-Path $repoRoot 'scripts' 'utilities' 'self-heal.ps1'
        if (-not (Test-Path $healScript)) {
            Write-Error "self-heal.ps1 not found"
            exit 1
        }
        $autoFix = ($Scope -eq 'fix' -or $Force)
        if ($Scope -and $Scope -ne 'fix' -and $Scope -ne 'all') {
            & $healScript -Scope $Scope -AutoFix:$autoFix
        } else {
            & $healScript -AutoFix:$autoFix
        }
        Write-Host "`n[HINT] Run 'gv heal fix' to auto-repair all issues" -ForegroundColor Yellow
        Write-Host "[HINT] Run 'gv heal config' to check only config files" -ForegroundColor Yellow
        Write-Host "[HINT] Run 'gv heal hooks' to check only git hooks" -ForegroundColor Yellow
        Write-Host "[HINT] Run 'gv heal session' to check only session files" -ForegroundColor Yellow
        Write-Host "[HINT] Run 'gv heal skills' to check only skill integrity" -ForegroundColor Yellow
        Write-Host "[HINT] Run 'gv heal engram' to check only engram health" -ForegroundColor Yellow
        exit $LASTEXITCODE
    }

    'version' {
        # Show current stack version from VERSION file
        $versionFile = Join-Path $repoRoot 'VERSION'
        $ver = if (Test-Path $versionFile) {
            (Get-Content $versionFile -Raw -Encoding UTF8).Trim()
        } else {
            'unknown'
        }
        $orchConfig = Join-Path $repoRoot 'config\orchestrator.json'
        $orchVer = ''
        if (Test-Path $orchConfig) {
            try {
                $oc = Get-Content $orchConfig -Raw -Encoding UTF8 | ConvertFrom-Json
                $orchVer = if ($oc.version) { " | orchestrator: $($oc.version)" } else { '' }
            } catch {}
        }
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        Write-Host ""
        Write-Host " ██████╗ ███████╗███╗   ██╗████████╗██╗     ███████╗    ██╗   ██╗ █████╗ ███╗   ██╗ ██████╗ ██╗   ██╗ █████╗ ██████╗ ██████╗ " -ForegroundColor Cyan
        Write-Host "██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██║     ██╔════╝    ██║   ██║██╔══██╗████╗  ██║██╔════╝ ██║   ██║██╔══██╗██╔══██╗██╔══██╗" -ForegroundColor Cyan
        Write-Host "██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██║     █████╗      ██║   ██║███████║██╔██╗ ██║██║  ███╗██║   ██║███████║██████╔╝██║  ██║" -ForegroundColor Cyan
        Write-Host "██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██║     ██╔══╝      ╚██╗ ██╔╝██╔══██║██║╚██╗██║██║   ██║██║   ██║██╔══██║██╔══██╗██║  ██║" -ForegroundColor Cyan
        Write-Host "╚██████╔╝███████╗██║  ████║   ██║   ██║███████╗███████╗   ╚████╔╝ ██║  ██║██║  ████║╚██████╔╝╚██████╔╝██║  ██║██║  ██║██████╔╝" -ForegroundColor Cyan
        Write-Host " ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝╚══════╝╚══════╝    ╚═══╝  ╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ " -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  -- NATIVE AI COGNITIVE DEVELOPMENT ECOSYSTEM --" -ForegroundColor DarkGray
        Write-Host ""
        Write-Host "  Gentle-Vanguard v${ver}${orchVer}" -ForegroundColor Cyan
        Write-Host "  Stack: $($PSVersionTable.PSVersion) on $(if($IsWindows){'windows'}elseif($IsMacOS){'macos'}else{'linux'})" -ForegroundColor Gray
        Write-Host "  Skills: $(if(Test-Path (Join-Path $repoRoot 'skills')){(Get-ChildItem (Join-Path $repoRoot 'skills') -Dir -EA SilentlyContinue).Count}else{'n/a'})" -ForegroundColor Gray
    }

    'context-pack' {
        Write-Step "Generating Compact Context Pack"
        $scopeChars = if ([string]::IsNullOrWhiteSpace($Scope)) { 0 } else { $Scope.Length }
        Invoke-TokenBudgetGuard -Task 'context-pack' -Risk 'medium' -EstimatedChars (4800 + $scopeChars)
        $contextScript = Join-Path $scriptDir 'context-pack.ps1'
        if (-not (Test-Path $contextScript)) {
            Write-Error "Context pack script not found: $contextScript"
            exit 1
        }

        if ([string]::IsNullOrWhiteSpace($Scope)) {
            & $contextScript
        } else {
            & $contextScript -Objective $Scope
        }
    }

    'compact-start' {
        Write-Step "Preparing Compact Chat Start"
        $scopeChars = if ([string]::IsNullOrWhiteSpace($Scope)) { 0 } else { $Scope.Length }
        Invoke-TokenBudgetGuard -Task 'compact-start' -Risk 'medium' -EstimatedChars (6200 + $scopeChars)
        $compactScript = Join-Path $scriptDir 'compact-start.ps1'
        if (-not (Test-Path $compactScript)) {
            Write-Error "Compact start script not found: $compactScript"
            exit 1
        }

        if ([string]::IsNullOrWhiteSpace($Scope)) {
            & $compactScript
        } else {
            & $compactScript -Objective $Scope
        }

        $markerDir = Join-Path $repoRoot '.session'
        if (-not (Test-Path $markerDir)) { New-Item -ItemType Directory -Path $markerDir -Force | Out-Null }
        Set-Content -Path (Join-Path $markerDir '.compact-marker') -Value ((Get-Date).ToUniversalTime().ToString('o')) -Encoding UTF8
        Write-Success 'compact-start marker updated'
    }

    'simplify-text' {
        Write-Step "Simplifying Text for Token Efficiency"
        $simplifyScript = Join-Path $scriptDir 'simplify-text.ps1'
        if (-not (Test-Path $simplifyScript)) {
            Write-Error "Simplify text script not found: $simplifyScript"
            exit 1
        }

        if ([string]::IsNullOrWhiteSpace($Scope)) {
            Write-Host "Usage: gv.ps1 simplify-text '<text>'" -ForegroundColor Yellow
            Write-Host "       gv.ps1 simplify-text -Interactive" -ForegroundColor Yellow
            Write-Host "       gv.ps1 simplify-text -InputFile '<path>'" -ForegroundColor Yellow
        } else {
            & $simplifyScript -InputText $Scope -SaveMetrics
        }
    }

    'context-metrics' {
        Write-Step "Context Usage Metrics"
        $metricsScript = Join-Path $scriptDir '..\AUDIT-REPORTING\context-metrics-report.ps1'
        if (-not (Test-Path $metricsScript)) {
            Write-Error "Context metrics script not found: $metricsScript"
            exit 1
        }

        $days = 7
        if (-not [string]::IsNullOrWhiteSpace($Scope)) {
            if ($Scope -match '^\d+$') {
                $parsedDays = [int]$Scope
                if ($parsedDays -gt 0) {
                    $days = $parsedDays
                }
            }
        }

        & $metricsScript -Days $days
    }

    'token-guard' {
        Write-Step "Token Budget Guard"
        $guardScript = Join-Path $scriptDir '..\TELEMETRY-METRICS\token-budget-guard.ps1'
        if (-not (Test-Path $guardScript)) {
            Write-Error "Token budget guard script not found: $guardScript"
            exit 1
        }

        if ($Scope -match '^profile:(hard|balanced)$') {
            $selectedProfile = [string]$matches[1]
            Set-TokenAutopilotProfile -Profile $selectedProfile
            Write-Success "Token autopilot profile updated to: $selectedProfile"
            break
        }

        if ($Scope -eq 'auto') {
            Invoke-TokenBudgetGuard -Task 'general' -Risk 'medium' -EstimatedChars 4500
            Write-Success 'Token autopilot check completed.'
            break
        }

        $taskName = if ([string]::IsNullOrWhiteSpace($Scope)) { 'general' } else { $Scope }
        & $guardScript -Mode status -Task $taskName
    }

    'homologate' {
        Write-Step "Workspace Homologation"
        $homologateScript = Join-Path $scriptDir '..\..\validation\homologate-workspace.ps1'
        if (-not (Test-Path $homologateScript)) {
            Write-Error "Homologation script not found: $homologateScript"
            exit 1
        }

        $homologateArgs = @('-OrganizeRootDocs')
        if ($Force -or $Scope -eq 'apply') {
            $homologateArgs += '-Apply'
        }

        Invoke-LocalPowerShellScript -ScriptPath $homologateScript -ScriptArgs $homologateArgs
    }

    'agent-alert' {
        Write-Step "Agent Process Compliance Alert"
        $alertScript = Join-Path $scriptDir '..\diagnostics\agent-process-alert.ps1'
        if (-not (Test-Path $alertScript)) {
            Write-Error "Agent alert script not found: $alertScript"
            exit 1
        }

        $alertArgs = @('-WindowHours', '24')
        if ($StrictCleanup -or $Scope -eq 'strict') {
            $alertArgs += '-Strict'
        }

        Invoke-LocalPowerShellScript -ScriptPath $alertScript -ScriptArgs $alertArgs
    }

    'agent' {
        Write-Step "Multi-Agent Router"
        $agentScript = Join-Path $scriptDir 'agent-router.ps1'
        if (-not (Test-Path $agentScript)) {
            Write-Error "Agent router script not found: $agentScript"
            exit 1
        }

        if ([string]::IsNullOrWhiteSpace($Scope)) {
            Write-Host "Usage: .\gv.ps1 agent <AGENT> [TASK]" -ForegroundColor Yellow
            Write-Host "Agents: BA, SAD, DEV, QA, OPS, GOV, DOC, status, list" -ForegroundColor White
            exit 1
        }

        $agentParams = $Scope.Trim() -split ' ', 2
        $agentName = if ($agentParams.Count -ge 1) { $agentParams[0].Trim() } else { '' }
        $taskText = if ($agentParams.Count -ge 2) { $agentParams[1].Trim() -replace "^'", "" -replace "'$", "" } else { '' }

        if (-not [string]::IsNullOrWhiteSpace($agentName)) {
            & $agentScript -Agent $agentName -Task $taskText
        } else {
            & $agentScript
        }
    }

    'skills' {
        Write-Step "Skills Auto-Discovery"
        $skillsScript = Join-Path $scriptDir 'skills-discovery.ps1'
        if (-not (Test-Path $skillsScript)) {
            Write-Error "Skills discovery script not found: $skillsScript"
            exit 1
        }

        $validActions = @('discover', 'map', 'agents', 'validate')
        $action = if ($validActions -contains $Scope) { $Scope } else { 'discover' }

        & $skillsScript -Action $action
    }

    'dispatch' {
        Write-Step "Parallel Agent Dispatch with Memory Persistence"
        $dispatchScript = Join-Path $scriptDir 'dispatch-agent.ps1'
        $memoryScript = Join-Path $scriptDir 'dispatch-memory-manager.ps1'
        
        if (-not (Test-Path $dispatchScript)) {
            Write-Error "Dispatch script not found: $dispatchScript"
            exit 1
        }
        
        if (-not (Test-Path $memoryScript)) {
            Write-Error "Dispatch memory manager not found: $memoryScript"
            exit 1
        }

        # Parse dispatch command: dispatch [agents|memory] [action] [params...]
        $dispatchParts = $Scope -split ' ', 3
        $dispatchAction = if ($dispatchParts[0]) { $dispatchParts[0].ToLower() } else { 'execute' }
        
        switch ($dispatchAction) {
            'memory' {
                # Memory management: dispatch memory [list|load|save|clear|sync]
                $memAction = if ($dispatchParts[1]) { $dispatchParts[1].ToLower() } else { 'list' }
                Write-Host "Memory action: $memAction" -ForegroundColor Gray
                
                $memArgs = @('-Action', $memAction)
                if ($JSON) { $memArgs += '-AsJson' }
                
                & $memoryScript @memArgs
            }
            'list' {
                # List dispatch memory for current session
                Write-Host "Listing dispatch memory for current session..." -ForegroundColor Gray
                & $memoryScript -Action 'list' -AsJson | ConvertFrom-Json | Format-Table -AutoSize
            }
            'sync' {
                # Synchronize dispatch memory
                Write-Host "Synchronizing dispatch memory..." -ForegroundColor Gray
                & $memoryScript -Action 'sync' -AsJson | ConvertFrom-Json | Format-Table -AutoSize
            }
            'message' {
                $msgBus = Join-Path (Split-Path -Parent $scriptDir) 'adaptive\agent-message-bus.ps1'
                if (-not (Test-Path $msgBus)) { Write-Error "agent-message-bus.ps1 not found"; exit 1 }
                $msgAction = if ($dispatchParts[1]) { $dispatchParts[1].ToLower() } else { 'status' }
                $msgArgs = @('-Action', $msgAction)
                if ($dispatchParts[2]) { $msgArgs += @('-Recipient', $dispatchParts[2]) }
                if ($JSON) { $msgArgs += '-AsJson' }
                & $msgBus @msgArgs
            }
            default {
                # Execute dispatch with agents
                $agents = if ($dispatchAction -ne 'execute') { $dispatchAction } else { $dispatchParts[1] }
                $task = if ($dispatchParts.Count -gt 2) { $dispatchParts[2] } else { '' }
                
                $dispatchArgs = @()
                if ($agents) { $dispatchArgs += @('-Agents', $agents) }
                if ($task) { $dispatchArgs += @('-Task', $task) }
                if ($JSON) { $dispatchArgs += '-AsJson' }
                
                Invoke-TokenBudgetGuard -Task 'dispatch' -Risk 'medium' -EstimatedChars 5000
                & $dispatchScript @dispatchArgs
            }
        }
    }

    'install' {
        Write-Step "Gentle-Vanguard TUI Installer (FF-018)"
        $installScript = Join-Path $scriptDir '..\gentle-vanguard-installer-tui.ps1'
        if (-not (Test-Path $installScript)) {
            Write-Error "Installer script not found: $installScript"
            exit 1
        }
        & $installScript @RemainingArgs
    }

    'events' {
        Write-Step "Event Bus"
        $eventScript = Join-Path $scriptDir 'event-bus.ps1'
        if (-not (Test-Path $eventScript)) {
            Write-Error "Event bus script not found: $eventScript"
            exit 1
        }

        $scopeParts = $Scope -split ' ', 2
        $action = if ($scopeParts[0]) { $scopeParts[0] } else { 'list' }
        $eventName = if ($scopeParts.Count -gt 1) { $scopeParts[1] } else { '' }

        if ($eventName) {
            & $eventScript -Action $action -Event $eventName
        } else {
            & $eventScript -Action $action
        }
    }

    'route' {
        $routerScript = Join-Path $scriptDir '..\MODEL-ROUTER\model-router.ps1'
        $failoverScript = Join-Path $scriptDir '..\MODEL-ROUTER\provider-failover.ps1'
        if (-not (Test-Path $routerScript)) {
            Write-Error "Model router script not found: $routerScript"
            exit 1
        }
        if ($Scope -ne 'provider' -and (Test-Path $failoverScript)) {
            $foState = Join-Path $repoRoot '.session\provider-state.json'
            $stale = $true
            if (Test-Path $foState) {
                $foData = Get-Content $foState -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue
                if ($foData -and $foData.lastCheck) {
                    $elapsed = [DateTime]::Now - [DateTime]::Parse($foData.lastCheck)
                    if ($elapsed.TotalMinutes -lt 5) { $stale = $false }
                }
            }
            if ($stale) { & $failoverScript -Action check -Quiet 2>&1 | Out-Null }
        }

        $scopeParts = $Scope -split ' ', 2
        $routeAction = if ($scopeParts[0]) { $scopeParts[0] } else { '' }

        $routeParams = @{
            Action       = $routeAction
            Agent        = ''
            Model        = ''
            Provider     = ''
            Temperature  = ''
            AdminPassword = ''
            AdminKeyFile = ''
        }

        $allRawArgs = @($RemainingArgs)
        if ($scopeParts.Count -gt 1) {
            $allRawArgs = @($scopeParts[1]) + $allRawArgs
        }

        $i = 0
        while ($i -lt $allRawArgs.Count) {
            $arg = $allRawArgs[$i]
            if ($arg.StartsWith('-')) {
                $key = $arg.TrimStart('-').ToLower()
                $i++
                $val = if ($i -lt $allRawArgs.Count) { $allRawArgs[$i] } else { '' }
                switch ($key) {
                    'agent'       { $routeParams.Agent = $val }
                    'model'       { $routeParams.Model = $val }
                    'provider'    { $routeParams.Provider = $val }
                    'temperature' { $routeParams.Temperature = $val }
                    'adminpassword' { $routeParams.AdminPassword = $val }
                    'adminkeyfile'  { $routeParams.AdminKeyFile = $val }
                    'json'        { $routeParams.JSON = $true; $i-- }
                }
            } else {
                if ([string]::IsNullOrWhiteSpace($routeParams.Agent)) {
                    $routeParams.Agent = $arg
                } elseif ([string]::IsNullOrWhiteSpace($routeParams.Model)) {
                    $routeParams.Model = $arg
                } elseif ([string]::IsNullOrWhiteSpace($routeParams.Provider)) {
                    $routeParams.Provider = $arg
                }
            }
            $i++
        }

        & $routerScript @routeParams
    }
    
    'webhook' {
        Write-Step "Webhook Alerting Configuration"
        $webhookScript = Join-Path $repoRoot 'scripts\utilities\TELEMETRY-METRICS\webhook-alerting.ps1'
        if (-not (Test-Path $webhookScript)) {
            Write-Error "Webhook script not found: $webhookScript"
            exit 1
        }
        
        if ($Scope -eq 'test') {
            Write-Host "Testing webhook connection..." -ForegroundColor Cyan
            & $webhookScript -WebhookUrl $env:WEBHOOK_URL -Status 'YELLOW' `
                -AlertType 'status-change' -Provider ($env:WEBHOOK_PROVIDER ?? 'slack') `
                -Details @{message="Test alert"} -DryRun
        } else {
            Write-Host "Usage: gv webhook test" -ForegroundColor Yellow
            Write-Host "Set env vars: WEBHOOK_URL, WEBHOOK_PROVIDER (slack|teams|discord|generic)" -ForegroundColor Gray
        }
    }
    
    'predictor' {
        Write-Step "Baseline Predictor"
        $predictorScript = Join-Path $repoRoot 'scripts\utilities\TELEMETRY-METRICS\baseline-predictor.ps1'
        if (-not (Test-Path $predictorScript)) {
            Write-Error "Predictor script not found: $predictorScript"
            exit 1
        }
        
        $forecastHours = 24
        if ($Scope -match '^\d+$') {
            $forecastHours = [int]$Scope
        }
        
        & $predictorScript -ForecastHours $forecastHours
    }
    
    'sla-dashboard' {
        Write-Step "SLA Dashboard Generation"
        $slaScript = Join-Path $repoRoot 'scripts\utilities\TELEMETRY-METRICS\sla-dashboard-generator.ps1'
        if (-not (Test-Path $slaScript)) {
            Write-Error "SLA dashboard script not found: $slaScript"
            exit 1
        }
        
        $slaPath = Join-Path $repoRoot 'reports\sla-dashboard.html'
        $openFlag = $Scope -eq 'open'
        $slaParams = @{
            OutputPath = $slaPath
            MonthlyTarget = 99.5
            WeeklyTarget = 99.9
        }
        if ($openFlag) {
            $slaParams['Open'] = $true
        }

        & $slaScript @slaParams
    }
    
    'escalation' {
        Write-Step "Auto-Escalation Configuration"
        $escalationScript = Join-Path $repoRoot 'scripts\utilities\TELEMETRY-METRICS\auto-escalation.ps1'
        if (-not (Test-Path $escalationScript)) {
            Write-Error "Auto-escalation script not found: $escalationScript"
            exit 1
        }
        
        if ([string]::IsNullOrWhiteSpace($env:GITHUB_TOKEN)) {
            Write-Error "GITHUB_TOKEN environment variable not set"
            exit 1
        }
        
        $repo = $Scope
        if ([string]::IsNullOrWhiteSpace($repo)) {
            Write-Error "Usage: gv escalation <owner/repo>"
            exit 1
        }
        
        Write-Host "Auto-escalation enabled for: $repo" -ForegroundColor Green
        Write-Host "Threshold: 3 consecutive failures" -ForegroundColor Gray
    }
    
    'live-server' {
        Write-Step "Live Dashboard Server (SSE)"
        $liveServerScript = Join-Path $repoRoot 'scripts\utilities\TELEMETRY-METRICS\websocket-live-server.ps1'
        if (-not (Test-Path $liveServerScript)) {
            Write-Error "Live server script not found: $liveServerScript"
            exit 1
        }
        
        $port = 8090
        if ($Scope -match '^\d+$') {
            $port = [int]$Scope
        }
        
        & $liveServerScript -Port $port
    }

    'gateway' {
        $gwScript = Join-Path $repoRoot 'scripts\gateway\gateway-manager.ps1'
        if (-not (Test-Path $gwScript)) {
            Write-Error "Gateway script not found: $gwScript"
            exit 1
        }
        $action = if ($Scope) { $Scope } else { 'status' }
        & $gwScript -Command $action $RemainingArgs
    }
}

exit 0


