BeforeAll {
    $repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

Describe 'Stack Smoke Tests' {

    It 'Repo root has VERSION file' {
        "$repoRoot\VERSION" | Should -Exist
    }

    It 'VERSION is parseable' {
        $v = Get-Content "$repoRoot\VERSION" -Raw
        $v.Trim() | Should -Match '^\d+\.\d+\.\d+$'
    }

    It 'Logger.psm1 loads without errors' {
        { Import-Module "$repoRoot\scripts\common\Logger.psm1" -Force -ErrorAction Stop } | Should -Not -Throw
    }

    It 'Write-Log function is exported' {
        Import-Module "$repoRoot\scripts\common\Logger.psm1" -Force
        Get-Command Write-Log -ErrorAction SilentlyContinue | Should -Not -BeNullOrEmpty
    }

    It 'docker-compose.yml is valid YAML' {
        $content = Get-Content "$repoRoot\docker-compose.yml" -Raw
        $content | Should -Not -BeNullOrEmpty
        $content | Should -Match 'services:'
    }

    It 'docker-compose.yml defines required services' {
        $content = Get-Content "$repoRoot\docker-compose.yml" -Raw
        $content | Should -Match 'web-dashboard'
        $content | Should -Match 'mcp-server'
        $content | Should -Match 'health-api'
    }

    It 'norms-registry.json is valid JSON with 144+ norms' {
        $norms = Get-Content "$repoRoot\rules\adaptive\norms-registry.json" -Raw | ConvertFrom-Json
        $norms.norms.Count | Should -BeGreaterOrEqual 144
    }

    It 'adapters/index.ts exists and is non-empty' {
        "$repoRoot\adapters\index.ts" | Should -Exist
        (Get-Item "$repoRoot\adapters\index.ts").Length | Should -BeGreaterThan 100
    }

    It 'No skills-archive directory remains' {
        "$repoRoot\skills-archive" | Should -Not -Exist
    }

    It 'CI workflows are consolidated (<= 15 files)' {
        $count = (Get-ChildItem "$repoRoot\.github\workflows\*.yml").Count
        $count | Should -BeLessOrEqual 15
    }

    It 'Prettier passes on key files' {
        $result = & "npx" prettier --check "README.md" "README-PUBLIC.md" "CHANGELOG.md" "VERSION" 2>&1
        $LASTEXITCODE | Should -Be 0
    }

}
