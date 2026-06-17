Describe "Prompt Model Adapter Tests" {
    BeforeAll {
        $scriptPath = "C:\Workspace_local\gentle-vanguard\scripts\utilities\memory\PROMPT\prompt-model-adapter.ps1"
    }
    
    It "Should adapt to OpenAI format" {
        $result = & $scriptPath -PromptContent "test" -TargetModel openai
        $result | Should -Match "# System"
        $result | Should -Match "# User"
    }
    
    It "Should adapt to Anthropic format" {
        $result = & $scriptPath -PromptContent "test" -TargetModel anthropic
        $result | Should -Match "<instructions>"
        $result | Should -Match "<user>"
    }
    
    It "Should adapt to Google format" {
        $result = & $scriptPath -PromptContent "test" -TargetModel google
        $result | Should -Match "system:"
        $result | Should -Match "user:"
    }
}



