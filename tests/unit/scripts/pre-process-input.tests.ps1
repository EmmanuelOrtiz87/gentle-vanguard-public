BeforeAll {
    $script:TestScriptPath = Join-Path $PSScriptRoot "..\..\..\scripts\utilities\utils\pre-process-input.ps1"
}

describe "pre-process-input.ps1" {
    context "Basic Output" {
        it "Should return result object" {
            $output = & $script:TestScriptPath -UserInput "hello world" -WorkspaceRoot $TestDrive
            $result = $output[-1]
            $result.HasMatch | Should -Not -BeNullOrEmpty
            $result.Skill | Should -Not -BeNullOrEmpty
        }

        it "Should always return a skill" {
            $output = & $script:TestScriptPath -UserInput "implement new feature" -WorkspaceRoot $TestDrive
            $result = $output[-1]
            $result.Skill | Should -Be "sdd-lifecycle"
        }

        it "Should return AgentCode" {
            $output = & $script:TestScriptPath -UserInput "implement new feature" -WorkspaceRoot $TestDrive
            $result = $output[-1]
            $result.AgentCode | Should -Be "BA"
        }
    }

    context "Confidence" {
        it "Should return numeric confidence" {
            $output = & $script:TestScriptPath -UserInput "implement" -WorkspaceRoot $TestDrive
            $result = $output[-1]
            $result.Confidence | Should -BeGreaterOrEqual 0
        }

        it "Should return confidence for any input" {
            $output = & $script:TestScriptPath -UserInput "hello world" -WorkspaceRoot $TestDrive
            $result = $output[-1]
            $result.Confidence | Should -BeGreaterOrEqual 0
        }
    }
}
