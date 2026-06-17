Describe "Prompt A/B Testing Tests" {
    BeforeAll {
        $scriptPath = "C:\Workspace_local\gentle-vanguard\scripts\utilities\memory\PROMPT\prompt-ab-testing.ps1"
        $testDir = "C:\Workspace_local\gentle-vanguard\tests\unit\prompt-optimization\test-ab"
    }
    
    BeforeEach {
        if (Test-Path $testDir) { Remove-Item $testDir -Recurse -Force }
    }
    
    It "Should create a test" {
        & $scriptPath -Action create -TestName "test1" -VariantA "A" -VariantB "B" -ResultsDir $testDir
        $testFile = Join-Path $testDir "test1.json"
        Test-Path $testFile | Should -Be $true
    }
}



