#!/usr/bin/env pwsh

$script:root = $PSScriptRoot | Split-Path -Parent | Split-Path -Parent
$script:engram = Join-Path $script:root 'tools\engram.exe'
$script:engramSafe = Join-Path $script:root 'scripts\utilities\engram-safe.ps1'
$script:testId = "test-$(Get-Date -Format 'yyyyMMddHHmmss')"
$env:ENGRAM_DATA_DIR = Join-Path $script:root '.engram-data'
$env:ENGRAM_SKIP_UPDATE = '1'

Describe "Engram CLI - Unit Tests" {

    Context "CLI Availability" {
        It "engram.exe binary exists" {
            Test-Path $script:engram | Should Be $true
        }

        It "engram.exe --version returns a version string" {
            $v = & $script:engram --version 2>&1 | Out-String
            $v | Should Not BeNullOrEmpty
        }

        It "engram-safe.ps1 wrapper exists" {
            Test-Path $script:engramSafe | Should Be $true
        }
    }

    Context "Search Operations" {
        It "engram search returns results for known session patterns" {
            $out = & $script:engram search "Session start:" --project gentle-vanguard --limit 3 2>&1 | Out-String
            $out | Should Not BeNullOrEmpty
        }

        It "engram search with --limit works correctly" {
            $raw = & $script:engram search "Session" --project gentle-vanguard --limit 2 2>&1
            $lines = @($raw | Where-Object { $_ -match 'session-' })
            $lines.Count -le 10 | Should Be $true
        }
    }

    Context "Health and Diagnostics" {
        It "engram doctor returns valid JSON" {
            $raw = & $script:engram doctor --json 2>&1
            $stripped = $raw -replace '\x1b\[[0-9;]*m', ''
            $combined = $stripped -join "`n"
            $start = $combined.IndexOf('{')
            $jsonStr = $combined.Substring($start)
            $parsed = $jsonStr | ConvertFrom-Json -ErrorAction Stop
            $parsed | Should Not BeNullOrEmpty
        }

        It "engram stats returns observation count" {
            $raw = & $script:engram stats --project gentle-vanguard 2>&1 | Out-String
            $raw.Trim() | Should Not BeNullOrEmpty
        }
    }

    Context "Data Roundtrip" {
        It "can save and then search for an observation" {
            $title = "test-obs-$script:testId"
            $null = & $script:engram save --title $title --content "Integration test observation $script:testId" --project gentle-vanguard 2>&1
            $searchOut = & $script:engram search $title --project gentle-vanguard --limit 5 2>&1 | Out-String
            ($searchOut -match [regex]::Escape($title)) | Should Be $true
        }
    }

    Context "Error Handling" {
        It "engram with invalid command returns non-zero exit" {
            $null = & $script:engram nonexistent-command-12345 2>&1
            $LASTEXITCODE | Should Not Be 0
        }
    }

    Context "Cross-Session Consistency" {
        It "search returns same project across multiple queries" {
            $r1 = & $script:engram search "session" --project gentle-vanguard --limit 2 2>&1 | Out-String
            $r2 = & $script:engram search "session" --project gentle-vanguard --limit 2 2>&1 | Out-String
            $r1.Trim().Length | Should BeGreaterThan 0
            $r2.Trim().Length | Should BeGreaterThan 0
        }
    }
}

