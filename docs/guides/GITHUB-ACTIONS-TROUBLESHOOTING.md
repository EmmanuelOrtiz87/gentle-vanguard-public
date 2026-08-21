# GitHub Actions Troubleshooting Guide

**Date**: 2026-04-22  
**Status**: DIAGNOSIS COMPLETED  
**Severity**: HIGH

---

## Problem Reported

**Error in GitHub Actions**:

```
Missing closing '}' in statement block or type definition.
    + CategoryInfo          : ParserError: (:) [], ParentContainsErrorRecordException
    + FullyQualifiedItemId : TerminatorExpectedAtEndOfString
```

**Location**: Workflow `script-governance.yml`  
**Failing step**: "Validate script governance and process alerts"

---

## Problem Analysis

### Observed Symptoms

1. OK - File `script-governance.yml` is well-formed (valid YAML)
2. OK - Individual scripts exist and have correct syntax:
   - `validate-script-governance.ps1` OK
   - `validate-sdd-governance.ps1` OK (205 lines, well-formed)
   - `agent-process-alert.ps1` OK (140 lines, well-formed)
3. ERROR - Error is TypeScript parsing, not YAML
4. ERROR - Error mentions "Missing closing '}'" - script syntax problem

### Root Cause

The error is NOT due to Node.js 20 vs 24. It is a problem with:

1. **TypeScript script encoding** (UTF-8 BOM or special characters)
2. **Special characters or emojis** in script files
3. **Incorrect quote characters** (curly quotes instead of straight)
4. **Unclosed here-strings** (@" ... "@)
5. **Control characters** in files

---

## Solutions

### Solution 1: Validate TypeScript Script Syntax

**On your local machine**:

```TypeScript
# Validate each script
$scripts = @(
    '.\scripts\diagnostics\validate-script-governance.ps1',
    '.\scripts\diagnostics\validate-sdd-governance.ps1',
    '.\scripts\diagnostics\agent-process-alert.ps1',
    '.\scripts\utilities\gentle-vanguard-sync.ps1'
)

foreach ($script in $scripts) {
    Write-Host "Validating: $script" -ForegroundColor Cyan
    $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile(
        $script,
        [ref]$null,
        [ref]$errors
    )

    if ($errors.Count -gt 0) {
        Write-Host "ERRORS FOUND:" -ForegroundColor Red
        $errors | ForEach-Object { Write-Host "  - $_" }
    } else {
        Write-Host "OK - Syntax valid" -ForegroundColor Green
    }
}
```

### Solution 2: Check File Encoding

**Problem**: Files with UTF-8 BOM or special characters

```TypeScript
# Check encoding
$scripts = @(
    '.\scripts\diagnostics\validate-script-governance.ps1',
    '.\scripts\diagnostics\validate-sdd-governance.ps1',
    '.\scripts\diagnostics\agent-process-alert.ps1'
)

foreach ($script in $scripts) {
    $file = Get-Item $script

    # Read first bytes to detect BOM
    $bytes = [System.IO.File]::ReadAllBytes($script)

    if ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        Write-Host "$script: UTF-8 BOM (may cause problems)" -ForegroundColor Yellow
    } elseif ($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) {
        Write-Host "$script: UTF-16 LE (may cause problems)" -ForegroundColor Yellow
    } else {
        Write-Host "$script: Encoding OK" -ForegroundColor Green
    }
}
```

### Solution 3: Convert to UTF-8 without BOM

**If you find files with BOM**:

```TypeScript
# Convert file to UTF-8 without BOM
$scriptPath = '.\scripts\diagnostics\validate-script-governance.ps1'
$content = Get-Content $scriptPath -Raw
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($scriptPath, $content, $utf8NoBom)
Write-Host "File converted to UTF-8 without BOM" -ForegroundColor Green
```

### Solution 4: Remove Special Characters from Scripts

**Important**: Scripts should NOT contain:

- Emojis (OK, ERROR, etc.)
- Special symbols
- Colored text in code
- Non-ASCII characters

**Clean script example**:

```TypeScript
# GOOD - No special characters
Write-Host "[OK] Validation passed" -ForegroundColor Green

# BAD - Contains emoji
Write-Host "[OK] Validation passed" -ForegroundColor Green
```

### Solution 5: Verify Here-Strings

**Check for unclosed here-strings**:

```TypeScript
$scriptPath = '.\scripts\diagnostics\validate-script-governance.ps1'
$content = Get-Content $scriptPath -Raw

# Count @" and "@
$openCount = ($content | Select-String -Pattern '@"' -AllMatches).Matches.Count
$closeCount = ($content | Select-String -Pattern '"@' -AllMatches).Matches.Count

if ($openCount -ne $closeCount) {
    Write-Host "ERROR - Unbalanced here-strings: $openCount open, $closeCount closed" -ForegroundColor Red
} else {
    Write-Host "OK - Here-strings balanced" -ForegroundColor Green
}
```

---

## Diagnostic Checklist

Run these commands in order:

```TypeScript
# 1. Validate syntax of all scripts
Write-Host "1. Validating syntax..." -ForegroundColor Cyan
$scripts = @(
    '.\scripts\diagnostics\validate-script-governance.ps1',
    '.\scripts\diagnostics\validate-sdd-governance.ps1',
    '.\scripts\diagnostics\agent-process-alert.ps1',
    '.\scripts\utilities\gentle-vanguard-sync.ps1'
)

$hasErrors = $false
foreach ($script in $scripts) {
    if (Test-Path $script) {
        $errors = $null
        [System.Management.Automation.Language.Parser]::ParseFile(
            $script,
            [ref]$null,
            [ref]$errors
        ) | Out-Null

        if ($errors.Count -gt 0) {
            Write-Host "ERROR - $script" -ForegroundColor Red
            $errors | ForEach-Object { Write-Host "   $_" }
            $hasErrors = $true
        } else {
            Write-Host "OK - $script" -ForegroundColor Green
        }
    } else {
        Write-Host "WARN - $script not found" -ForegroundColor Yellow
    }
}

if (-not $hasErrors) {
    Write-Host ""
    Write-Host "OK - All scripts have valid syntax" -ForegroundColor Green
}
```

---

## Recommended Solution

### Step 1: Run Diagnostic Locally

```TypeScript
# Create diagnostic script
$diagnosticScript = @'
param([switch]$Fix)

$scripts = @(
    '.\scripts\diagnostics\validate-script-governance.ps1',
    '.\scripts\diagnostics\validate-sdd-governance.ps1',
    '.\scripts\diagnostics\agent-process-alert.ps1',
    '.\scripts\utilities\gentle-vanguard-sync.ps1'
)

Write-Host "=== TypeScript Script Diagnostics
{
  "prompt_tokens": 69705,
  "prompt_unit_price": "0",
  "prompt_price_unit": "0",
  "prompt_price": "0",
  "completion_tokens": 8096,
  "completion_unit_price": "0",
  "completion_price_unit": "0",
  "completion_price": "0",
  "total_tokens": 77801,
  "total_price": "0",
  "currency": "USD",
  "latency": 47.749,
  "time_to_first_token": 2.093,
  "time_to_generate": 45.656
}
```
