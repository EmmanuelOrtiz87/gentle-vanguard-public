# bootstrap.ps1
# This script initializes the complete work environment on a new machine.
# Designed to be agnostic:
# - OS: Works on Windows, Linux and macOS (via PowerShell Core).
# - IDE: Not dependent on VSCode, IntelliJ or specific editors.
# - AI: Sets the base for any model to use the MCP protocol.
# - Tech: Structures projects and tools in an isolated way.

param(
    [string]$GitUser,
    [string]$GitEmail,
    [switch]$InstallGitHubRunner,
    [string]$GitHubRunnerConfigPath = 'config/github-runner.local.json'
)

$ErrorActionPreference = 'Stop'

# Origin Configuration (Git Provider Agnostic)
$ENGRAM_REPO_URL = "https://github.com/gentle-vanguard/engram.git"

function Write-Step { param([string]$msg) Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-Success { param([string]$msg) Write-Host "   OK: $msg" -ForegroundColor Green }
function Write-ErrorMsg { param([string]$msg) Write-Host "   ERROR: $msg" -ForegroundColor Red }
function Write-InfoMsg { param([string]$msg) Write-Host "   INFO: $msg" -ForegroundColor Gray }

$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

Write-Step "Step 1: Creating Agnostic Directory Structure..."
$dirs = @('projects', 'tools', 'config', '.engram-data', 'docs/code-reviews')
foreach ($dir in $dirs) {
    $path = Join-Path $workspaceRoot $dir
    if (-not (Test-Path $path)) {
        New-Item -ItemType Directory -Path $path -Force | Out-Null
        Write-Success "Created: $dir/"
    } else {
        Write-InfoMsg "Existing: $dir/"
    }
}

Write-Step "Step 2: Verifying Core Dependencies..."

# 1. Git (Agnostic version control)
if (Get-Command git -ErrorAction SilentlyContinue) {
    Write-Success "Git detected: $(git --version | Select-Object -First 1)"
} else {
    Write-ErrorMsg "Git not found. Install it at: https://git-scm.com/"
    exit 1
}

# 1.1 Git Identity Verification
# Apply parameters if provided
if (-not [string]::IsNullOrWhiteSpace($GitUser)) { git config --global user.name "$GitUser" }
if (-not [string]::IsNullOrWhiteSpace($GitEmail)) { git config --global user.email "$GitEmail" }

$gitUserCheck = git config --get user.name 2>$null
$gitEmailCheck = git config --get user.email 2>$null

if ([string]::IsNullOrWhiteSpace($gitUserCheck) -or [string]::IsNullOrWhiteSpace($gitEmailCheck)) {
    Write-Step "Git Identity Configuration..."
    if ([string]::IsNullOrWhiteSpace($gitUserCheck)) {
        $gitUserCheck = Read-Host "Enter your name for Git (user.name)"
        if (-not [string]::IsNullOrWhiteSpace($gitUserCheck)) { git config --global user.name "$gitUserCheck" }
    }
    if ([string]::IsNullOrWhiteSpace($gitEmailCheck)) {
        $gitEmailCheck = Read-Host "Enter your email for Git (user.email)"
        if (-not [string]::IsNullOrWhiteSpace($gitEmailCheck)) { git config --global user.email "$gitEmailCheck" }
    }
}

$goAvailable = Get-Command go -ErrorAction SilentlyContinue
$engramAvailable = Get-Command engram -ErrorAction SilentlyContinue

# 2. Go (Tool engine and backend)
if ($goAvailable) {
    Write-Success "Go detected: $(go version)"
} elseif ($engramAvailable) {
    Write-InfoMsg "Go not found. Engram already available - skipping Go requirement."
    Write-InfoMsg "Install Go later for full functionality: winget install GoLang.Go"
} else {
    Write-ErrorMsg "Go (Golang) not found and Engram not available. Install Go: winget install GoLang.Go"
    exit 1
}

# 3. Engram (AI Orchestrator)
if ($engramAvailable) {
    Write-Success "Engram CLI detected."
} elseif (-not $goAvailable) {
    Write-ErrorMsg "Cannot install Engram: Go not found. Install Go first."
    exit 1
} else {
    Write-Step "Installing Engram CLI from repository..."
    $engramToolDir = Join-Path $workspaceRoot "scripts/utilities/engram"
    if (-not (Test-Path $engramToolDir)) {
        git clone $ENGRAM_REPO_URL "$engramToolDir"
    }
    Push-Location $engramToolDir
    & go install ./cmd/engram
    Pop-Location
    if (Get-Command engram -ErrorAction SilentlyContinue) {
        Write-Success "Engram CLI installed successfully."
    } else {
        Write-ErrorMsg "Could not install Engram. Ensure %GOPATH%\bin is in your PATH."
    }
}

# 4. GitHub CLI (Optional but recommended for repo automation)
Write-Step "Verifying GitHub CLI (gh)..."
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "[!] GitHub CLI not detected." -ForegroundColor Yellow
    $confirmGh = Read-Host "Do you want to attempt automated installation? (y/n)"
    if ($confirmGh -eq 'y') {
        try {
            if ($IsWindows) {
                Write-InfoMsg "Installing gh via winget..."
                winget install --id GitHub.cli --silent --accept-source-agreements --accept-package-agreements
            } elseif ($IsMacOS) {
                Write-InfoMsg "Installing gh via brew..."
                brew install gh
            } elseif ($IsLinux) {
                Write-InfoMsg "Installing gh via apt..."
                sudo apt update
                sudo apt install gh -y
                if ($?) { sudo apt install gh -y }
            }
            
            if (Get-Command gh -ErrorAction SilentlyContinue) {
                Write-Success "GitHub CLI installed successfully."
            }
        } catch {
            Write-ErrorMsg "Error during automated installation. Please install manually: https://cli.github.com/"
        }
    }
} else {
    Write-Success "GitHub CLI detected."
}

Write-Step "Step 3: Deploying Default Configuration..."
$configPath = Join-Path $workspaceRoot "config/workspace.config.json"
if (-not (Test-Path $configPath)) {
    # If the file does not exist, we create an agnostic AI base
    $defaultConfig = @{
        "workspaceRoot" = "{workspaceRoot}"
        "dataRoot"      = "{dataRoot}"
        "aiModelSettings" = @{
            "provider" = "generic"
            "model"    = "default"
            "protocol" = "mcp"
        }
    } | ConvertTo-Json -Depth 10
    $defaultConfig | Out-File -FilePath $configPath -Encoding UTF8
    Write-Success "Configuration generated: config/workspace.config.json"
} else {
    Write-InfoMsg "Existing configuration respected: config/workspace.config.json"
}

Write-Step "Step 4: Configuring Git Hooks..."
if (Test-Path (Join-Path $workspaceRoot ".git")) {
    # Set Git to look for hooks in our versioned directory instead of .git/hooks
    git config core.hooksPath scripts/git-hooks
    Write-Success "Git hooks path set to 'scripts/git-hooks'."
} else {
    Write-InfoMsg "Not a Git repository. Skipping hook configuration."
}

if ($InstallGitHubRunner) {
    Write-Step "Step 4b: Installing optional GitHub self-hosted runner..."
    $runnerInstaller = Join-Path $workspaceRoot 'scripts/utilities/DEPLOYMENT/install-github-runner.ps1'
    if (-not (Test-Path $runnerInstaller)) {
        Write-ErrorMsg "Runner installer not found: $runnerInstaller"
        exit 1
    }

    & $runnerInstaller -ConfigPath (Join-Path $workspaceRoot $GitHubRunnerConfigPath)
    if ($LASTEXITCODE -eq 0) {
        Write-Success 'GitHub runner installation finished.'
    } else {
        Write-ErrorMsg 'GitHub runner installation failed.'
        exit 1
    }
}

Write-Step "Step 5: System Health Report (Health Check)..."
$report = @{
    Git = if (Get-Command git -ErrorAction SilentlyContinue) { "PASS" } else { "FAIL" }
    GitHubCLI = if (Get-Command gh -ErrorAction SilentlyContinue) { 
        "PASS" 
    } else { 
        if (Test-Path "$env:ProgramFiles\GitHub CLI\gh.exe") { "RESTART REQUIRED (Installed but not in PATH)" } else { "INFO: Not installed" }
    }
    Go  = if (Get-Command go -ErrorAction SilentlyContinue) { "PASS" } elseif (Get-Command engram -ErrorAction SilentlyContinue) { "WARN: Not installed (Engram available)" } else { "FAIL" }
    Engram = if (Get-Command engram -ErrorAction SilentlyContinue) { "PASS" } else { "FAIL" }
    Config = if (Test-Path $configPath) { "PASS" } else { "FAIL" }
}

foreach ($item in $report.Keys) {
    $color = if ($report[$item] -eq "PASS") { "Green" } else { "Red" }
    Write-Host "   [Checking] $item : $($report[$item])" -ForegroundColor $color
}

Write-Host "`n[SUCCESS] Gentle-Vanguard Initialized and Verified!" -ForegroundColor Green
Write-Host "You can now run 'scripts/run-engram.ps1' to start your assisted development session." -ForegroundColor Green
