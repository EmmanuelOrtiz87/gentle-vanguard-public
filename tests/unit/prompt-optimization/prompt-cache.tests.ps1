Describe "Prompt Cache Tests" {
    BeforeAll {
        $scriptPath = "C:\Workspace_local\gentle-vanguard\scripts\utilities\memory\PROMPT\prompt-cache.ps1"
        $testDir = "C:\Workspace_local\gentle-vanguard\tests\unit\prompt-optimization\test-cache"
    }
    
    BeforeEach {
        if (Test-Path $testDir) { Remove-Item $testDir -Recurse -Force }
        New-Item -ItemType Directory -Path $testDir -Force | Out-Null
    }
    
    It "Should cache and retrieve prompt" {
        $hash = "test123"
        $content = "Test prompt content"
        & $scriptPath -Action set -PromptHash $hash -PromptContent $content -CacheDir $testDir
        $cached = & $scriptPath -Action get -PromptHash $hash -CacheDir $testDir
        $cached.Trim() | Should -Be $content
    }
    
    AfterAll {
        if (Test-Path $testDir) { Remove-Item $testDir -Recurse -Force }
    }
}



