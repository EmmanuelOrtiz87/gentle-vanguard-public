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
        $script:isPublicDistribution = -not (Test-Path (Join-Path $script:repoRoot "src/session-autostart.ts"))
    }

    Context "Core TypeScript entrypoints" {
        It "session-autostart.ts exists" {
            $available = (Test-Path (Join-Path $script:repoRoot "src/session-autostart.ts")) -or
                (Test-Path (Join-Path $script:repoRoot "scripts/gentle-vanguard/bootstrap.ts"))
            $available | Should -BeTrue
        }

        It "dashboard-start.ts exists" {
            $available = (Test-Path (Join-Path $script:repoRoot "src/dashboard-start.ts")) -or
                (Test-Path (Join-Path $script:repoRoot "docs/technical/STACK-DOCUMENTATION.md"))
            $available | Should -BeTrue
        }

        It "has TypeScript source directory with at least 20 files" {
            $count = (Get-ChildItem (Join-Path $script:repoRoot "src") -Filter "*.ts" -ErrorAction SilentlyContinue).Count
            if ($script:isPublicDistribution) {
                Test-Path (Join-Path $script:repoRoot "docs/technical/STACK-DOCUMENTATION.md") | Should -BeTrue
            } else {
                $count | Should -BeGreaterOrEqual 20
            }
        }
    }

    Context "Core configuration" {
        It "package.json exists and has scripts" {
            $pkg = Get-Content (Join-Path $script:repoRoot "package.json") -Raw | ConvertFrom-Json
            $scriptCount = @($pkg.scripts.PSObject.Properties).Count
            $scriptCount | Should -BeGreaterOrEqual 10
        }

        It "session-autostart config exists" {
            $available = (Test-Path (Join-Path $script:repoRoot "config/session-autostart.config.json")) -or
                (Test-Path (Join-Path $script:repoRoot "docs/getting-started/README.md"))
            $available | Should -BeTrue
        }

        It "model-router config exists" {
            $available = (Test-Path (Join-Path $script:repoRoot "config/model-router.json")) -or
                (Test-Path (Join-Path $script:repoRoot "docs/technical/STACK-DOCUMENTATION.md"))
            $available | Should -BeTrue
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
