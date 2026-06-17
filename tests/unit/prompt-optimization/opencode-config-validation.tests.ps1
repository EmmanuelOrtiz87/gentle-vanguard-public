Describe "OpenCode Config Validation Tests" {
    BeforeAll {
        $validatorPath = Join-Path $PSScriptRoot "..\..\..\scripts\utilities\config\validate-opencode-config.ps1"
        $configPath = Join-Path $PSScriptRoot "..\..\..\opencode.json"
        $optimizerPath = Join-Path $PSScriptRoot "..\..\..\scripts\utilities\system\system-prompt-optimizer.ps1"
    }

    It "Should pass validation (no unknown properties in opencode.json)" {
        $result = & $validatorPath -ConfigPath $configPath 2>&1
        $result | Should -Not -Match "FAIL"
        $LASTEXITCODE | Should -Be 0
    }

    It "Should detect unknown properties in opencode.json" {
        $tempConfig = Join-Path $env:TEMP "test-opencode-bad.json"
        @'
{
  "$schema": "https://opencode.ai/config.json",
  "model": "test",
  "systemPromptOptimization": { "enabled": true },
  "unknownProperty": true
}
'@ | Set-Content $tempConfig
        $result = & $validatorPath -ConfigPath $tempConfig *>&1 | Out-String
        $result | Should -Match "FAIL"
        $LASTEXITCODE | Should -Be 1
        Remove-Item $tempConfig -ErrorAction SilentlyContinue
    }

    It "Should pass clean config with only valid properties" {
        $tempConfig = Join-Path $env:TEMP "test-opencode-clean.json"
        @'
{
  "$schema": "https://opencode.ai/config.json",
  "model": "test",
  "agent": { "orchestrator": { "mode": "primary" } },
  "permission": { "read": "allow" }
}
'@ | Set-Content $tempConfig
        $result = & $validatorPath -ConfigPath $tempConfig *>&1 | Out-String
        $result | Should -Match "PASS"
        $LASTEXITCODE | Should -Be 0
        Remove-Item $tempConfig -ErrorAction SilentlyContinue
    }

    It "Should restore optimizer config-check action" {
        if (Test-Path $optimizerPath) {
            $result = & $optimizerPath -Action config-check -WorkspaceRoot (Join-Path $PSScriptRoot "..\..\..") *>&1 | Out-String
            $result | Should -Match "Config:"
        }
    }

    It "Should reject systemPromptOptimization in optimizer validate" {
        if (Test-Path $optimizerPath) {
            $result = & $optimizerPath -Action validate -WorkspaceRoot (Join-Path $PSScriptRoot "..\..\..") 2>&1
            $result | Should -Not -Match "systemPromptOptimization"
        }
    }

    It "Separate config file should exist and be valid JSON" {
        $cfgPath = Join-Path $PSScriptRoot "..\..\..\config\system-prompt-optimization.json"
        $cfgPath | Should -Exist
        $content = Get-Content $cfgPath -Raw | ConvertFrom-Json
        $content.enabled | Should -Be $true
        $content.targetTokens | Should -Be 2000
        $content.maxTokens | Should -Be 5000
        $content.compression | Should -Be "semantic"
    }

    It "Separate config should have all required sections" {
        $cfgPath = Join-Path $PSScriptRoot "..\..\..\config\system-prompt-optimization.json"
        $content = Get-Content $cfgPath -Raw | ConvertFrom-Json
        $content.abbreviations | Should -Not -BeNullOrEmpty
        $content.cache | Should -Not -BeNullOrEmpty
        $content.security | Should -Not -BeNullOrEmpty
        $content.versioning | Should -Not -BeNullOrEmpty
        $content.monitoring | Should -Not -BeNullOrEmpty
    }
}
