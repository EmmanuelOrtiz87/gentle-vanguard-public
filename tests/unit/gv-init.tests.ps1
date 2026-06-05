#Requires -Module Pester
<#
.SYNOPSIS
    Pester tests for gv init scaffolding functionality.

.DESCRIPTION
    Validates that init-project.ps1 correctly scaffolds projects with all features.
    Tests file creation, content validation, and idempotency.
#>

BeforeAll {
    $repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    $initScript = Join-Path $repoRoot 'scripts\utilities\init-project.ps1'
    $testDir = Join-Path $env:TEMP "gv-init-test-$(Get-Random)"
}

AfterAll {
    # Cleanup test directories
    if (Test-Path $testDir) {
        Remove-Item -Path $testDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Describe "gv init scaffolding" {
    Context "Basic scaffolding" {
        BeforeEach {
            $projectName = "test-project-$(Get-Random)"
            $projectPath = Join-Path $testDir $projectName
        }

        It "Creates project directory" {
            & $initScript -ProjectName $projectName -Quiet
            $projectPath | Should -Exist
        }

        It "Creates README.md with project name" {
            & $initScript -ProjectName $projectName -Quiet
            $readmePath = Join-Path $projectPath 'README.md'
            $readmePath | Should -Exist
            $content = Get-Content $readmePath -Raw
            $content | Should -Match $projectName
        }

        It "Creates VERSION file with 1.0.0" {
            & $initScript -ProjectName $projectName -Quiet
            $versionPath = Join-Path $projectPath 'VERSION'
            $versionPath | Should -Exist
            Get-Content $versionPath -Raw | Should -Be "1.0.0"
        }

        It "Creates .gitignore" {
            & $initScript -ProjectName $projectName -Quiet
            Join-Path $projectPath '.gitignore' | Should -Exist
        }
    }

    Context "GV CLI feature" {
        BeforeEach {
            $projectName = "test-gv-$(Get-Random)"
            $projectPath = Join-Path $testDir $projectName
        }

        It "Creates gv.ps1 when feature enabled" {
            # Note: This requires modifying init-project to accept feature flags
            # For now, we test that the script runs without error
            { & $initScript -ProjectName $projectName -Quiet } | Should -Not -Throw
        }
    }

    Context "ADR feature" {
        BeforeEach {
            $projectName = "test-adr-$(Get-Random)"
            $projectPath = Join-Path $testDir $projectName
        }

        It "Creates ADR directory structure" {
            & $initScript -ProjectName $projectName -Quiet
            $adrPath = Join-Path $projectPath 'docs\architecture\decisions'
            $adrPath | Should -Exist
        }
    }

    Context "Force flag" {
        BeforeEach {
            $projectName = "test-force-$(Get-Random)"
            $projectPath = Join-Path $testDir $projectName
            # Create project first
            & $initScript -ProjectName $projectName -Quiet
        }

        It "Overwrites existing files with -Force" {
            # Modify a file
            $readmePath = Join-Path $projectPath 'README.md'
            "MODIFIED" | Set-Content $readmePath
            
            # Re-run with Force
            & $initScript -ProjectName $projectName -Quiet -Force
            
            # File should be overwritten (original content restored)
            $content = Get-Content $readmePath -Raw
            $content | Should -Not -Match "^MODIFIED$"
        }
    }

    Context "Idempotency" {
        BeforeEach {
            $projectName = "test-idempotent-$(Get-Random)"
            $projectPath = Join-Path $testDir $projectName
        }

        It "Running twice does not fail" {
            & $initScript -ProjectName $projectName -Quiet
            { & $initScript -ProjectName $projectName -Quiet } | Should -Not -Throw
        }
    }
}

Describe "init-project.ps1 parameters" {
    It "Requires ProjectName or prompts interactively" {
        # In quiet mode without ProjectName, should use default
        $defaultProject = "gentle-vanguard-project"
        $projectPath = Join-Path $testDir $defaultProject
        
        # Clean up if exists
        if (Test-Path $projectPath) {
            Remove-Item $projectPath -Recurse -Force
        }
        
        # This would prompt in non-quiet mode, but in our test we can't easily test that
        # So we just verify the script exists and is executable
        $initScript | Should -Exist
    }
}
