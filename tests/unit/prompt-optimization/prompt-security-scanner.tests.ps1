Describe "Prompt Security Scanner Tests" {
    BeforeAll {
        $scriptPath = "C:\Workspace_local\gentle-vanguard\scripts\utilities\memory\PROMPT\prompt-security-scanner.ps1"
    }
    
    It "Should detect secrets" {
        $output = & $scriptPath -PromptContent "password: secret123" | Out-String
        $output | Should -Match "ISSUES"
        $output | Should -Match "secret"
    }
    
    It "Should detect XSS attempts" {
        $output = & $scriptPath -PromptContent "<script>alert(1)</script>" | Out-String
        $output | Should -Match "ISSUES"
        $output | Should -Match "XSS"
    }
    
    It "Should pass safe content" {
        $output = & $scriptPath -PromptContent "This is safe content" | Out-String
        $output | Should -Match "PASSED"
    }
}



