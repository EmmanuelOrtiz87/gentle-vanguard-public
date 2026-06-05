BeforeAll {
    $scriptRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
    $ftDir = Join-Path $scriptRoot "scripts" "utilities" "FINE-TUNING"
    $ProjectRoot = $scriptRoot
}

Describe "FT-DataCollector" {
    It "Should have ft-data-collector.ps1 script" {
        Join-Path $ftDir "ft-data-collector.ps1" | Should -Exist
    }

    It "Should create raw output directory" {
        $rawDir = Join-Path $ProjectRoot ".ft" "dataset" "raw"
        $rawDir | Should -Exist
    }

    It "Should collect data with Source=session without error" {
        { & (Join-Path $ftDir "ft-data-collector.ps1") -Source session -Force *>$null } | Should -Not -Throw
    }

    It "Should collect data with Source=skills without error" {
        { & (Join-Path $ftDir "ft-data-collector.ps1") -Source skills -Force *>$null } | Should -Not -Throw
    }

    It "Should collect data with Source=routing without error" {
        { & (Join-Path $ftDir "ft-data-collector.ps1") -Source routing -Force *>$null } | Should -Not -Throw
    }
}

Describe "FT-DatasetBuilder" {
    It "Should have ft-dataset-builder.ps1 script" {
        Join-Path $ftDir "ft-dataset-builder.ps1" | Should -Exist
    }

    It "Should have dataset directories" {
        Join-Path $ProjectRoot ".ft" "dataset" "train" | Should -Exist
        Join-Path $ProjectRoot ".ft" "dataset" "val" | Should -Exist
    }
}

Describe "FT-Registry" {
    It "Should have ft-registry.ps1 script" {
        Join-Path $ftDir "ft-registry.ps1" | Should -Exist
    }

    It "Should list adapters (empty initially)" {
        { & (Join-Path $ftDir "ft-registry.ps1") -Action list *>$null } | Should -Not -Throw
    }

    It "Should show status" {
        { & (Join-Path $ftDir "ft-registry.ps1") -Action status *>$null } | Should -Not -Throw
    }
}

Describe "FT-Trainer" {
    It "Should have ft-trainer.ps1 script" {
        Join-Path $ftDir "ft-trainer.ps1" | Should -Exist
    }

    It "Should run dry-run without error" {
        { & (Join-Path $ftDir "ft-trainer.ps1") -Domain BA -Mode dry-run *>$null } | Should -Not -Throw
    }
}

Describe "FT-Inference" {
    It "Should have ft-inference.ps1 script" {
        Join-Path $ftDir "ft-inference.ps1" | Should -Exist
    }
}

Describe "FT-Evaluator" {
    It "Should have ft-evaluator.ps1 script" {
        Join-Path $ftDir "ft-evaluator.ps1" | Should -Exist
    }

    It "Should run evaluator without error" {
        { & (Join-Path $ftDir "ft-evaluator.ps1") *>$null } | Should -Not -Throw
    }
}
