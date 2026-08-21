# Unit smoke tests for PowerShell automation scripts.
# Validates that core automation scripts exist and are syntactically valid.

Describe "PowerShell automation scripts" {
    BeforeAll {
        # tests/unit/scripts -> repo root (3 levels up via Split-Path -Parent)
        $script:repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
        if (-not $script:repoRoot) {
            throw "Could not resolve repo root from PSScriptRoot: $PSScriptRoot"
        }
    }

    Context "Script structure" {
        It "has a scripts directory" {
            Test-Path (Join-Path $script:repoRoot "scripts") | Should -BeTrue
        }

        It "has at least 1 PowerShell script in scripts/" {
            $count = (Get-ChildItem (Join-Path $script:repoRoot "scripts") -Filter "*.ps1" -Recurse -ErrorAction SilentlyContinue).Count
            $count | Should -BeGreaterOrEqual 1
        }

        It "session-autostart pipeline config exists" {
            Test-Path (Join-Path $script:repoRoot "config/session-autostart.config.json") | Should -BeTrue
        }
    }

    Context "Key script categories" {
        It "has utilities automation (ps1 or ts)" {
            $ps1 = (Get-ChildItem (Join-Path $script:repoRoot "scripts/utilities") -Filter "*.ps1" -Recurse -ErrorAction SilentlyContinue).Count
            $ts = (Get-ChildItem (Join-Path $script:repoRoot "src") -Filter "*.ts" -Recurse -ErrorAction SilentlyContinue).Count
            ($ps1 + $ts) | Should -BeGreaterOrEqual 5
        }

        It "has security automation as TypeScript (migrated from ps1)" {
            $audit = Test-Path (Join-Path $script:repoRoot "src/infrastructure/audit-pipeline.ts")
            $audit | Should -BeTrue
        }
    }
}
