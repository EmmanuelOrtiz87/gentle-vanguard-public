# bootstrap-machine.ps1
# Global Gentle-Vanguard Installation Script
# Installs Gentle-Vanguard to ~/.gentleman/ for enterprise-wide development

param(
    [string]$Version = "latest",
    [string]$Source = "",
    [string]$InstallRoot = "",
    [switch]$Portable,
    [switch]$Force,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$script:homePath = if ($env:USERPROFILE) { $env:USERPROFILE } else { $env:HOME }

if ([string]::IsNullOrWhiteSpace($InstallRoot)) {
    if ($env:GENTLE_VANGUARD_HOME) {
        $InstallRoot = $env:GENTLE_VANGUARD_HOME
    } else {
        $InstallRoot = Join-Path $script:homePath ".gentle-vanguard"
    }
}

$legacyRoot = Join-Path $script:homePath ".gentleman"
if ((-not (Test-Path $InstallRoot)) -and (Test-Path $legacyRoot)) {
    $InstallRoot = $legacyRoot
}

$Gentle-VanguardRoot = $InstallRoot
$Global = -not $Portable

function Write-Step {
    param([string]$Message)
    Write-Host "`n=== $Message ===" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Gray
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-Err {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Ensure-Directory {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
        Write-Info "Created: $Path"
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Gentle-Vanguard Installer" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

if (-not $Source) {
    $possibleSources = @(
        ".\gentle-vanguard",
        ".\gentle-vanguard",
        (Join-Path (Split-Path -Parent $PSScriptRoot) "gentle-vanguard"),
        (Join-Path (Split-Path -Parent $PSScriptRoot) "gentle-vanguard"),
        (Join-Path (Split-Path -Parent $PSScriptRoot) "gentle-vanguard")
    )
    
    foreach ($src in $possibleSources) {
        if (Test-Path $src) {
            $Source = $src
            break
        }
    }
    
    if (-not $Source) {
        Write-Err "Source not found. Specify with -Source parameter."
        Write-Host "Checked locations:"
        foreach ($src in $possibleSources) {
            Write-Host "  - $src"
        }
        exit 1
    }
}

Write-Host "Source:      $Source"
Write-Host "Target:      $Gentle-VanguardRoot"
Write-Host "Mode:        $(if ($Global) { 'Global (Symlinks)' } else { 'Portable (Copy)' })"
Write-Host "Version:     $Version"
Write-Host ""

if ($DryRun) {
    Write-Warn "DRY RUN - No changes will be made"
    exit 0
}

Write-Step "1. Creating Directory Structure"
$directories = @(
    $Gentle-VanguardRoot,
    (Join-Path $Gentle-VanguardRoot "skills"),
    (Join-Path $Gentle-VanguardRoot "tools"),
    (Join-Path $Gentle-VanguardRoot "hooks"),
    (Join-Path $Gentle-VanguardRoot "bin"),
    (Join-Path $Gentle-VanguardRoot "config"),
    (Join-Path $Gentle-VanguardRoot "templates")
)

foreach ($dir in $directories) {
    Ensure-Directory -Path $dir
}
Write-Success "Directory structure created"

Write-Step "2. Creating Gentle-Vanguard Version File"
$versionFile = Join-Path $Gentle-VanguardRoot "gentle-vanguard.version"
@{
    version = $Version
    installed = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    source = $Source
} | ConvertTo-Json | Set-Content -Path $versionFile
Write-Success "Version file created"

Write-Step "3. Processing Skills"
$sourceSkills = Join-Path $Source "skills"
$targetSkills = Join-Path $Gentle-VanguardRoot "skills"

if (-not (Test-Path $sourceSkills)) {
    Write-Err "Skills source not found: $sourceSkills"
    exit 1
}

$skillDirs = Get-ChildItem -Path $sourceSkills -Directory | Where-Object { 
    Test-Path (Join-Path $_.FullName "SKILL.md") 
}

$syncCount = 0
$skipCount = 0

foreach ($skillDir in $skillDirs) {
    $targetPath = Join-Path $targetSkills $skillDir.Name
    $shouldSkip = (Test-Path $targetPath) -and -not $Force
    
    if ($shouldSkip) {
        Write-Info "[SKIP] $($skillDir.Name) (already exists)"
        $skipCount++
        continue
    }
    
    if ($Global) {
        if (Test-Path $targetPath) {
            Remove-Item -Recurse -Force $targetPath
        }
        
        try {
            New-Item -ItemType SymbolicLink -Path $targetPath -Target $skillDir.FullName -Force | Out-Null
            Write-Success "[SYMLINK] $($skillDir.Name)"
            $syncCount++
        } catch {
            Write-Warn "[COPY] Symlink failed, copying instead: $($skillDir.Name)"
            Copy-Item -Path $skillDir.FullName -Destination $targetPath -Recurse -Force
            $syncCount++
        }
    } else {
        if (Test-Path $targetPath) {
            Remove-Item -Recurse -Force $targetPath
        }
        Copy-Item -Path $skillDir.FullName -Destination $targetPath -Recurse -Force
        Write-Success "[COPY] $($skillDir.Name)"
        $syncCount++
    }
}

Write-Host ""
Write-Success "Skills processed: $syncCount synced, $skipCount skipped"

Write-Step "4. Copying Templates"
$sourceTemplates = Join-Path $Source "templates"
$targetTemplates = Join-Path $Gentle-VanguardRoot "templates"

if (Test-Path $sourceTemplates) {
    $templateDirs = Get-ChildItem -Path $sourceTemplates -Directory
    foreach ($dir in $templateDirs) {
        $targetPath = Join-Path $targetTemplates $dir.Name
        if ((Test-Path $targetPath) -and -not $Force) {
            Write-Info "[SKIP] Template $($dir.Name) (exists)"
            continue
        }
        Copy-Item -Path $dir.FullName -Destination $targetPath -Recurse -Force
        Write-Success "[TEMPLATE] $($dir.Name)"
    }
}

Write-Step "5. Installing Global Git Hooks"
$gitHooksDir = Join-Path $script:homePath ".git-hooks"

Ensure-Directory -Path $gitHooksDir

$hookScripts = Get-ChildItem -Path $sourceSkills -Recurse -Filter "pre-commit*.ps1"
foreach ($hook in $hookScripts) {
    $hookName = $hook.BaseName + ".ps1"
    $targetHook = Join-Path $gitHooksDir $hookName
    
    if ($Global) {
        if (Test-Path $targetHook) { Remove-Item $targetHook -Force }
        try {
            New-Item -ItemType SymbolicLink -Path $targetHook -Target $hook.FullName -Force | Out-Null
            Write-Success "[HOOK] $hookName (symlinked)"
        } catch {
            Copy-Item -Path $hook.FullName -Destination $targetHook -Force
            Write-Success "[HOOK] $hookName (copied)"
        }
    } else {
        Copy-Item -Path $hook.FullName -Destination $targetHook -Force
        Write-Success "[HOOK] $hookName (copied)"
    }
}

$gitConfigHookPath = (git config --global core.hooksPath 2>$null)
if ($gitConfigHookPath -ne $gitHooksDir) {
    git config --global core.hooksPath $gitHooksDir
    Write-Success "Git hooks path configured: $gitHooksDir"
}

Write-Step "5b. Installing PreTool Auto-Format Hooks"
$preToolHookSource = Join-Path $Gentle-VanguardRoot "hooks"
$preToolHookTarget = Join-Path $script:homePath ".pretool-hooks"

Ensure-Directory -Path $preToolHookTarget

$preToolHooks = Get-ChildItem -Path $preToolHookSource -Filter "pre-tool*.ps1" -ErrorAction SilentlyContinue
foreach ($hook in $preToolHooks) {
    $targetHook = Join-Path $preToolHookTarget $hook.Name
    
    try {
        New-Item -ItemType SymbolicLink -Path $targetHook -Target $hook.FullName -Force | Out-Null
        Write-Success "[PreTool] $($hook.Name) (symlinked)"
    } catch {
        Copy-Item -Path $hook.FullName -Destination $targetHook -Force
        Write-Success "[PreTool] $($hook.Name) (copied)"
    }
}

$env:PRETOOL_HOOKS_PATH = $preToolHookTarget

Write-Step "6. Creating CLI Wrapper"
$cliPath = Join-Path (Join-Path $Gentle-VanguardRoot "bin") "gv.ps1"

$cliContent = @"
# gv.ps1 - Gentle-Vanguard CLI
# Auto-generated by bootstrap-machine.ps1

`$ErrorActionPreference = 'Stop'

`$GF_ROOT = "`$(Split-Path -Parent `$PSScriptRoot)"
`$SkillsDir = Join-Path `$GF_ROOT 'skills'

function Get-GfSkill {
    param([string]`$Name)
    `$skillPath = Join-Path `$SkillsDir "`$Name"
    if (Test-Path (Join-Path `$skillPath 'SKILL.md')) {
        return Get-Content (Join-Path `$skillPath 'SKILL.md') -Raw
    }
    return `$null
}

`$cmd = `$args[0]
switch (`$cmd) {
    'skills' {
        Get-ChildItem `$SkillsDir -Directory | Select-Object Name
    }
    'validate' {
        Write-Host "Validating gentle-vanguard..."
        Write-Host "Skills: `$(`(Get-ChildItem `$SkillsDir -Directory).Count`)"
    }
    'update' {
        & "`$PSScriptRoot\..\scripts\sync-skills.ps1" -Force
    }
    default {
        Write-Host "Gentle-Vanguard CLI"
        Write-Host "Usage: gv <command>"
        Write-Host "Commands: skills, validate, update"
    }
}
"@

Set-Content -Path $cliPath -Value $cliContent
Write-Success "CLI created: $cliPath"

Write-Step "7. Adding to PATH"
$binPath = Join-Path $Gentle-VanguardRoot "bin"
$currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")

if ($currentPath -notlike "*$binPath*") {
    [Environment]::SetEnvironmentVariable("PATH", "$binPath;$currentPath", "User")
    $env:PATH = "$binPath;$env:PATH"
    Write-Success "Added to PATH: $binPath"
} else {
    Write-Info "Already in PATH: $binPath"
}

Write-Step "8. Configuring Git Global Settings"
git config --global init.defaultBranch "develop" 2>$null | Out-Null
git config --global pull.rebase "false" 2>$null | Out-Null
git config --global commit.template "$Gentle-VanguardRoot\config\commit-template.txt" 2>$null | Out-Null

$commitTemplate = @"
# <type>(<scope>): <description>
#
# Types: feat, fix, docs, refactor, test, chore, perf, ci
#
# Examples:
#   feat(api): add user authentication
#   fix(dashboard): resolve pagination bug
#   docs(readme): update installation guide
"@

$templatePath = Join-Path $Gentle-VanguardRoot "config" "commit-template.txt"
Set-Content -Path $templatePath -Value $commitTemplate
Write-Success "Git commit template configured"

Write-Step "Summary"
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Installation Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Gentle-Vanguard Location: $Gentle-VanguardRoot"
Write-Host "CLI Command:        gv"
Write-Host "Skills Installed:   $syncCount"
Write-Host "Git Hooks:          $gitHooksDir"
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "  1. Restart your terminal or run: refreshenv"
Write-Host "  2. Run 'gv validate' to verify installation"
Write-Host "  3. Run 'gv update' to sync latest skills"
Write-Host ""
Write-Host "For new projects, use:" -ForegroundColor Cyan
Write-Host "  gv new --name my-project --type service"
Write-Host ""


