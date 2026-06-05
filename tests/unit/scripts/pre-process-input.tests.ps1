<#
.SYNOPSIS
    Unit tests for pre-process-input.ps1
.DESCRIPTION
    Tests for the input preprocessing and trigger detection logic
#>

BeforeAll {
    $script:TestScriptPath = Join-Path $PSScriptRoot "..\..\..\scripts\utilities\WORKFLOW-ORCHESTRATION\pre-process-input.ps1"
    $script:MockConfigPath = Join-Path $TestDrive "test-config.json"
    
    # Create mock config
    $mockConfig = @{
        autoDelegation = @{
            enabled = $true
            keywordMappings = @(
                @{ keyword = "implement"; skill = "implementation-skill"; agent = "DEV" }
                @{ keyword = "test"; skill = "testing-skill"; agent = "QA" }
                @{ keyword = "document"; skill = "documentation-skill"; agent = "DOC" }
            )
        }
    }
    $mockConfig | ConvertTo-Json -Depth 5 | Set-Content -Path $script:MockConfigPath
}

describe "pre-process-input.ps1" {
    context "Trigger Detection" {
        it "Should detect implementation keyword" {
            $input = "implement new feature"
            $result = & $script:TestScriptPath -UserInput $input -WorkspaceRoot $TestDrive -ConfigPath $script:MockConfigPath
            $result.triggerFound | Should -Be $true
            $result.skill | Should -Be "implementation-skill"
        }
        
        it "Should detect testing keyword" {
            $input = "test the application"
            $result = & $script:TestScriptPath -UserInput $input -WorkspaceRoot $TestDrive -ConfigPath $script:MockConfigPath
            $result.triggerFound | Should -Be $true
            $result.agent | Should -Be "QA"
        }
        
        it "Should return no match for unrelated input" {
            $input = "hello world"
            $result = & $script:TestScriptPath -UserInput $input -WorkspaceRoot $TestDrive -ConfigPath $script:MockConfigPath
            $result.triggerFound | Should -Be $false
        }
    }
    
    context "Plan Mode Detection" {
        it "Should enable plan mode for multi-step tasks" {
            $input = "implement and test new feature with documentation"
            $result = & $script:TestScriptPath -UserInput $input -WorkspaceRoot $TestDrive -ConfigPath $script:MockConfigPath
            $result.planMode | Should -Be $true
        }
        
        it "Should disable plan mode for simple queries" {
            $input = "what is the weather"
            $result = & $script:TestScriptPath -UserInput $input -WorkspaceRoot $TestDrive -ConfigPath $script:MockConfigPath
            $result.planMode | Should -Be $false
        }
    }
    
    context "Confidence Scoring" {
        it "Should assign high confidence for exact matches" {
            $input = "implement"
            $result = & $script:TestScriptPath -UserInput $input -WorkspaceRoot $TestDrive -ConfigPath $script:MockConfigPath
            $result.confidence | Should -BeGreaterThan 0.8
        }
        
        it "Should assign lower confidence for partial matches" {
            $input = "implementation"
            $result = & $script:TestScriptPath -UserInput $input -WorkspaceRoot $TestDrive -ConfigPath $script:MockConfigPath
            $result.confidence | Should -BeGreaterThan 0.5
            $result.confidence | Should -BeLessThan 0.8
        }
    }
    
    context "Error Handling" {
        it "Should handle missing config gracefully" {
            $input = "test"
            $result = & $script:TestScriptPath -UserInput $input -WorkspaceRoot $TestDrive -ConfigPath "nonexistent.json"
            $result.triggerFound | Should -Be $false
            $result.error | Should -Not -BeNullOrEmpty
        }
        
        it "Should handle empty input" {
            $result = & $script:TestScriptPath -UserInput "" -WorkspaceRoot $TestDrive -ConfigPath $script:MockConfigPath
            $result.triggerFound | Should -Be $false
        }
    }
}
