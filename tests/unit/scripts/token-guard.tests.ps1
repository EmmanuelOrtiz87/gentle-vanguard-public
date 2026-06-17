BeforeAll {
    $script:TestScriptPath = Join-Path $PSScriptRoot "..\..\..\scripts\utilities\telemetry\TELEMETRY-METRICS\token-budget-guard.ps1"
}

describe "token-budget-guard.ps1" {
    context "Basic Output" {
        it "Should return PASS status for default budget" {
            $records = & $script:TestScriptPath -Action status *>&1
            $msg = ($records | ForEach-Object { $_.MessageData }) -join "`n"
            $msg | Should -Match "PASS"
        }

        it "Should report token budget within threshold" {
            $records = & $script:TestScriptPath -Action status *>&1
            $msg = ($records | ForEach-Object { $_.MessageData }) -join "`n"
            $msg | Should -Match "threshold"
        }
    }

    context "Risk and Task" {
        it "Should report risk level" {
            $records = & $script:TestScriptPath -Action status *>&1
            $msg = ($records | ForEach-Object { $_.MessageData }) -join "`n"
            $msg | Should -Match "Risk:"
        }

        it "Should report task type" {
            $records = & $script:TestScriptPath -Action status *>&1
            $msg = ($records | ForEach-Object { $_.MessageData }) -join "`n"
            $msg | Should -Match "Task:"
        }
    }
}
