<#
.SYNOPSIS
    Unit tests for token-budget-guard.ps1
.DESCRIPTION
    Tests for token budget monitoring and alerting
#>

BeforeAll {
    $script:TestScriptPath = Join-Path $PSScriptRoot "..\..\..\scripts\utilities\TELEMETRY-METRICS\token-budget-guard.ps1"
    $script:TestMetricsPath = Join-Path $TestDrive "test-metrics.csv"
    
    # Create mock metrics file
    @"
SessionID,Timestamp,TokensUsed,CumulativeTokens
TEST-001,2026-06-01T10:00:00Z,1000,1000
TEST-001,2026-06-01T10:30:00Z,5000,6000
TEST-001,2026-06-01T11:00:00Z,4000,10000
"@ | Set-Content -Path $script:TestMetricsPath
}

describe "token-budget-guard.ps1" {
    context "Budget Calculation" {
        it "Should calculate daily usage correctly" {
            $result = & $script:TestScriptPath -Action status -MetricsPath $script:TestMetricsPath
            $result.dailyUsage | Should -Be 10000
        }
        
        it "Should calculate remaining budget" {
            $result = & $script:TestScriptPath -Action status -MetricsPath $script:TestMetricsPath -DailyBudget 30000
            $result.remaining | Should -Be 20000
        }
        
        it "Should calculate percentage used" {
            $result = & $script:TestScriptPath -Action status -MetricsPath $script:TestMetricsPath -DailyBudget 30000
            $result.percentageUsed | Should -Be 33.33
        }
    }
    
    context "Threshold Alerts" {
        it "Should trigger soft alert at 70%" {
            $highUsage = @"
SessionID,Timestamp,TokensUsed,CumulativeTokens
TEST-001,2026-06-01T10:00:00Z,21000,21000
"@
            $highUsage | Set-Content -Path $script:TestMetricsPath
            
            $result = & $script:TestScriptPath -Action check -MetricsPath $script:TestMetricsPath -DailyBudget 30000
            $result.alertLevel | Should -Be "soft"
            $result.shouldContinue | Should -Be $true
        }
        
        it "Should trigger hard block at 90%" {
            $veryHighUsage = @"
SessionID,Timestamp,TokensUsed,CumulativeTokens
TEST-001,2026-06-01T10:00:00Z,27000,27000
"@
            $veryHighUsage | Set-Content -Path $script:TestMetricsPath
            
            $result = & $script:TestScriptPath -Action check -MetricsPath $script:TestMetricsPath -DailyBudget 30000
            $result.alertLevel | Should -Be "hard"
            $result.shouldContinue | Should -Be $false
        }
        
        it "Should allow operations under threshold" {
            $lowUsage = @"
SessionID,Timestamp,TokensUsed,CumulativeTokens
TEST-001,2026-06-01T10:00:00Z,5000,5000
"@
            $lowUsage | Set-Content -Path $script:TestMetricsPath
            
            $result = & $script:TestScriptPath -Action check -MetricsPath $script:TestMetricsPath -DailyBudget 30000
            $result.alertLevel | Should -Be "none"
            $result.shouldContinue | Should -Be $true
        }
    }
    
    context "Per-Agent Budget" {
        it "Should track per-agent usage" {
            $multiAgent = @"
SessionID,Agent,Timestamp,TokensUsed
TEST-001,DEV,2026-06-01T10:00:00Z,5000
TEST-001,QA,2026-06-01T10:30:00Z,3000
TEST-001,BA,2026-06-01T11:00:00Z,2000
"@
            $multiAgent | Set-Content -Path $script:TestMetricsPath
            
            $result = & $script:TestScriptPath -Action status -MetricsPath $script:TestMetricsPath
            $result.perAgent.DEV | Should -Be 5000
            $result.perAgent.QA | Should -Be 3000
            $result.perAgent.BA | Should -Be 2000
        }
        
        it "Should enforce per-agent limit" {
            $exceedAgent = @"
SessionID,Agent,Timestamp,TokensUsed
TEST-001,DEV,2026-06-01T10:00:00Z,3500
"@
            $exceedAgent | Set-Content -Path $script:TestMetricsPath
            
            $result = & $script:TestScriptPath -Action check -MetricsPath $script:TestMetricsPath -PerAgentBudget 3000
            $result.alertLevel | Should -Be "hard"
        }
    }
    
    context "Error Handling" {
        it "Should handle missing metrics file" {
            $result = & $script:TestScriptPath -Action status -MetricsPath "nonexistent.csv"
            $result.error | Should -Not -BeNullOrEmpty
            $result.dailyUsage | Should -Be 0
        }
        
        it "Should handle malformed CSV" {
            "invalid,csv,content" | Set-Content -Path $script:TestMetricsPath
            $result = & $script:TestScriptPath -Action status -MetricsPath $script:TestMetricsPath
            $result.error | Should -Not -BeNullOrEmpty
        }
    }
}
