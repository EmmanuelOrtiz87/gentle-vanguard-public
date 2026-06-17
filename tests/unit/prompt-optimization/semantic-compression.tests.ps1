Describe "Semantic Compression Tests" {
    BeforeAll {
        $scriptPath = Join-Path $PSScriptRoot "..\..\..\scripts\utilities\memory\PROMPT\semantic-compression.ps1"
        $testInput = "C:\Workspace_local\gentle-vanguard\tests\unit\prompt-optimization\test-input.md"
        $testOutput = "C:\Workspace_local\gentle-vanguard\tests\unit\prompt-optimization\test-output.md"
        "implementation function configuration" | Set-Content $testInput
    }
    
    It "Should compress common words" {
        & $scriptPath -InputPath $testInput -OutputPath $testOutput
        $content = Get-Content $testOutput -Raw
        $content | Should -Match "impl"
        $content | Should -Match "fn"
        $content | Should -Match "cfg"
    }
    
    AfterAll {
        Remove-Item $testInput -ErrorAction SilentlyContinue
        Remove-Item $testOutput -ErrorAction SilentlyContinue
    }
}



