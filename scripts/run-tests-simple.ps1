# run-tests-simple.ps1
# Multi-category test runner for Pester
#
# Usage:
#   .\run-tests-simple.ps1                   # run all tests
#   .\run-tests-simple.ps1 -WithCoverage     # run all tests + generate coverage report
#   .\run-tests-simple.ps1 -IncludeE2E       # include e2e tests (slower, needs git)

param(
    [switch]$WithCoverage,
    [switch]$IncludeE2E
)

$script:root = $PSScriptRoot | Split-Path -Parent
$testDir = Join-Path $script:root "tests"
$passed = 0
$failed = 0
$total = 0

$categories = @(
    @{ Name = "Unit Tests";        Path = "unit\*.tests.ps1" }
    @{ Name = "Integration Tests"; Path = "integration\*.tests.ps1" }
    @{ Name = "Security Tests";    Path = "security\*.tests.ps1" }
    @{ Name = "Performance Tests"; Path = "performance\*.tests.ps1" }
)

if ($IncludeE2E) {
    $categories += @{ Name = "E2E Tests"; Path = "e2e\*.e2e.tests.ps1" }
}

$globalStart = Get-Date

$allFiles = @()
foreach ($cat in $categories) {
    $files = Get-ChildItem "$testDir\$($cat.Path)" -ErrorAction SilentlyContinue
    foreach ($f in $files) { $allFiles += @{ File = $f; Category = $cat.Name } }
}
$totalFiles = $allFiles.Count
$fileIndex = 0

Write-Host "┌────────────────────────────────────────────────┐" -ForegroundColor Cyan
Write-Host "│  TEST SUITE: $($totalFiles.ToString().PadLeft(2)) archivos a ejecutar                   │" -ForegroundColor Cyan
Write-Host "└────────────────────────────────────────────────┘" -ForegroundColor Cyan

foreach ($cat in $categories) {
    $files = Get-ChildItem "$testDir\$($cat.Path)" -ErrorAction SilentlyContinue
    if ($files.Count -eq 0) { continue }

    Write-Host "`n=== $($cat.Name) ($($files.Count) archivos) ===" -ForegroundColor Cyan

    foreach ($file in $files) {
        $fileIndex++
        $elapsed = [math]::Round(((Get-Date) - $globalStart).TotalSeconds)
        $elapsedStr = "{0:mm\:ss}" -f ([datetime]::new(0).AddSeconds($elapsed))

        $pct = [math]::Round(($fileIndex / $totalFiles) * 100)
        Write-Host "  [$elapsedStr] [$fileIndex/$totalFiles] ($pct%) $($file.Name) ... " -NoNewline

        $t0 = Get-Date
        $output = pwsh -NoProfile -Command "Invoke-Pester -Path '$($file.FullName)' -PassThru" 2>&1
        $duration = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
        $total++

        if ($output -match "Passed:\s*(\d+)" -and $output -notmatch "Failed:\s*[1-9]") {
            $passed++
            Write-Host "PASSED (${duration}s)" -ForegroundColor Green
        } else {
            $failed++
            Write-Host "FAILED (${duration}s)" -ForegroundColor Red
            $output | Select-String "FAIL|Error|RuntimeException" | Select-Object -First 3 |
                ForEach-Object { Write-Host "      $_" -ForegroundColor DarkRed }
        }
    }
}

$totalElapsed = [math]::Round(((Get-Date) - $globalStart).TotalSeconds, 1)
Write-Host "`n┌────────────────────────────────────────────────┐" -ForegroundColor Cyan
Write-Host "│  RESULT: $passed passed, $failed failed | ${totalElapsed}s                │" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
Write-Host "└────────────────────────────────────────────────┘" -ForegroundColor Cyan

# Code coverage report (optional, requires Pester CodeCoverage support)
if ($WithCoverage) {
    $coverageConfigPath = Join-Path $testDir "coverage-config.json"
    $coverageOutDir = Join-Path $testDir "coverage"

    if (-not (Test-Path $coverageOutDir)) {
        New-Item -ItemType Directory -Path $coverageOutDir -Force | Out-Null
    }

    $coverageConfig = if (Test-Path $coverageConfigPath) {
        Get-Content $coverageConfigPath | ConvertFrom-Json
    } else {
        [pscustomobject]@{ thresholds = @{ lines = 70; functions = 75; branches = 65 } }
    }

    # Collect all script files to measure
    $scriptsToMeasure = Get-ChildItem "$script:root\scripts\**\*.ps1" -Recurse -ErrorAction SilentlyContinue |
        Where-Object {
            $rel = $_.FullName.Replace($script:root, '').TrimStart('\')
            $coverageConfig.exclude -notcontains $rel -and
            $_.Name -notmatch '^(run-tests|setup-complete|check-)'
        } |
        Select-Object -ExpandProperty FullName

    if ($scriptsToMeasure.Count -gt 0) {
        Write-Host "`n=== Coverage Report ===" -ForegroundColor Cyan

        # Collect all test files
        $allTestFiles = Get-ChildItem "$testDir\**\*.tests.ps1" -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -notmatch '\.e2e\.' } |
            Select-Object -ExpandProperty FullName

        $coverageCmd = @'
            $r = Invoke-Pester -Path $args[0] -CodeCoverage $args[1] -PassThru -Quiet
            $cov = $r.CodeCoverage
            if ($cov) {
                $hitLines   = ($cov.HitCommands  | Measure-Object).Count
                $missLines  = ($cov.MissedCommands | Measure-Object).Count
                $totalLines = $hitLines + $missLines
                $pct = if ($totalLines -gt 0) { [math]::Round(($hitLines / $totalLines) * 100, 1) } else { 100 }
                Write-Host "Lines covered: $hitLines / $totalLines ($pct%)"
                if ($pct -lt 70) { Write-Host '[WARNING] Coverage below threshold (70%)'; exit 1 }
            }
'@
        pwsh -NoProfile -Command $coverageCmd -args @(,$allTestFiles) @(,$scriptsToMeasure)
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[WARN] Coverage check failed or below threshold" -ForegroundColor Yellow
        }
    }
}

if ($failed -gt 0) { exit 1 }
