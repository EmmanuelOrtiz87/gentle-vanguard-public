# Smoke tests for Gentle-Vanguard stack core structure.
# Validates that critical operational components exist and are wired correctly.
# These are lightweight structural checks (not full integration tests).

Describe "Gentle-Vanguard stack smoke" {
    BeforeAll {
        # tests/smoke/ -> repo root (2 levels up via Split-Path -Parent, robusto bajo Pester)
        $script:repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
        if (-not $script:repoRoot) {
            throw "Could not resolve repo root from PSScriptRoot: $PSScriptRoot"
        }
    }

    Context "Core TypeScript entrypoints" {
        It "session-autostart.ts exists" {
            Test-Path (Join-Path $script:repoRoot "src/session-autostart.ts") | Should -BeTrue
        }

        It "dashboard-start.ts exists" {
            Test-Path (Join-Path $script:repoRoot "src/dashboard-start.ts") | Should -BeTrue
        }

        It "has TypeScript source directory with at least 20 files" {
            $count = (Get-ChildItem (Join-Path $script:repoRoot "src") -Filter "*.ts" -ErrorAction SilentlyContinue).Count
            $count | Should -BeGreaterOrEqual 20
        }
    }

    Context "Core configuration" {
        It "package.json exists and has scripts" {
            $pkg = Get-Content (Join-Path $script:repoRoot "package.json") -Raw | ConvertFrom-Json
            $scriptCount = @($pkg.scripts.PSObject.Properties).Count
            $scriptCount | Should -BeGreaterOrEqual 10
        }

        It "session-autostart config exists" {
            Test-Path (Join-Path $script:repoRoot "config/session-autostart.config.json") | Should -BeTrue
        }

        It "model-router config exists" {
            Test-Path (Join-Path $script:repoRoot "config/model-router.json") | Should -BeTrue
        }

        It "opencode.json exists" {
            Test-Path (Join-Path $script:repoRoot "opencode.json") | Should -BeTrue
        }
    }

    Context "Operational data" {
        It "has a tests directory with unit tests" {
            (Get-ChildItem (Join-Path $script:repoRoot "tests/unit") -Filter "*.test.ts" -ErrorAction SilentlyContinue).Count |
                Should -BeGreaterOrEqual 5
        }

        It "has GitHub workflows" {
            (Get-ChildItem (Join-Path $script:repoRoot ".github/workflows") -Filter "*.yml" -ErrorAction SilentlyContinue).Count |
                Should -BeGreaterOrEqual 5
        }
    }
}
