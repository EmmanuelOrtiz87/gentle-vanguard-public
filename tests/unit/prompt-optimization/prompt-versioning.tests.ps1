Describe "Prompt Versioning Tests" {
    BeforeAll {
        $scriptPath = "C:\Workspace_local\gentle-vanguard\scripts\utilities\memory\PROMPT\prompt-versioning.ps1"
        $testDir = "C:\Workspace_local\gentle-vanguard\tests\unit\prompt-optimization\test-versions"
    }
    
    BeforeEach {
        if (Test-Path $testDir) { Remove-Item $testDir -Recurse -Force }
        New-Item -ItemType Directory -Path $testDir -Force | Out-Null
    }
    
    It "Should save a version" {
        $output = & $scriptPath -Action save -PromptName "test" -Content "test content" -VersionDir $testDir
        $output | Should -Match "SAVED"
        $versions = Get-ChildItem $testDir -Filter "test-*.md"
        $versions.Count | Should -BeGreaterThan 0
    }
    
    It "Should list versions" {
        & $scriptPath -Action save -PromptName "test" -Content "v1" -VersionDir $testDir
        & $scriptPath -Action save -PromptName "test" -Content "v2" -VersionDir $testDir
        $output = & $scriptPath -Action list -PromptName "test" -VersionDir $testDir | Out-String
        $output | Should -Match "test-"
    }
    
    AfterAll {
        if (Test-Path $testDir) { Remove-Item $testDir -Recurse -Force }
    }
}



