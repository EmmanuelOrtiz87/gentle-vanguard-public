# Script Normalization Standards

**Date**: 2026-04-22  
**Status**: AUDIT COMPLETED  
**Compliance**: 63.8% (74/116 scripts compliant)

---

## Overview

All TypeScript scripts in the project must follow strict normalization standards to ensure:

- Compatibility with GitHub Actions CI/CD
- Consistent behavior across environments
- Prevention of parsing errors
- Reliable automation

---

## Normalization Standards

### 1. Character Encoding

**REQUIRED**:

- UTF-8 encoding without BOM (Byte Order Mark)
- ASCII-only text content
- No Unicode characters, emojis, or special symbols

**NOT ALLOWED**:

```TypeScript
# BAD - Contains emoji
Write-Host "OK - Task completed"

# BAD - Contains special Unicode
Write-Host " Validation passed"

# BAD - Contains curly quotes
Write-Host "Error: 'Invalid input'"
```

**CORRECT**:

```TypeScript
# GOOD - ASCII only
Write-Host "[OK] Task completed"
Write-Host "Validation passed"
Write-Host "Error: Invalid input"
```

### 2. Syntax Balance

**REQUIRED**:

- All opening braces `{` must have closing braces `}`
- All opening parentheses `(` must have closing parentheses `)`
- All opening here-strings `@"` must have closing `"@`
- All opening single quotes `'` must have closing `'`
- All opening double quotes `"` must have closing `"`

**Validation**:

```TypeScript
# Count braces
$content = Get-Content script.ps1 -Raw
$openBraces = ($content | Select-String -Pattern '\{' -AllMatches).Matches.Count
$closeBraces = ($content | Select-String -Pattern '\}' -AllMatches).Matches.Count
Write-Host "Braces: $openBraces open, $closeBraces closed"
```

### 3. TypeScript Syntax

**REQUIRED**:

- Valid TypeScript 5.1+ syntax
- No shell operators like `||` or `&&` (use TypeScript equivalents)
- Proper variable references with `$` prefix
- Correct parameter syntax

**NOT ALLOWED**:

```TypeScript
# BAD - Shell operators
command1 || command2
command1 && command2

# BAD - Invalid variable reference
$env:MY_VAR
$:variable

# BAD - Incorrect escaping
$_\"
```

**CORRECT**:

```TypeScript
# GOOD - TypeScript operators
if (-not (command1)) { command2 }
if (command1) { command2 }

# GOOD - Valid variable reference
$env:MY_VAR
$variable

# GOOD - Correct escaping
$_
```

### 4. Output Messages

**REQUIRED**:

- Use text-based status indicators: `[OK]`, `[ERROR]`, `[WARN]`, `[INFO]`
- Use simple ASCII characters for decoration
- Use TypeScript color parameters for emphasis

**NOT ALLOWED**:

```TypeScript
# BAD - Emojis
Write-Host "OK - Task completed"
Write-Host "ERROR - Something failed"
Write-Host "WARNING - Check this"

# BAD - Special symbols
Write-Host " Success"
Write-Host " Failed"
Write-Host " Next step"
```

**CORRECT**:

```TypeScript
# GOOD - Text indicators
Write-Host "[OK] Task completed" -ForegroundColor Green
Write-Host "[ERROR] Something failed" -ForegroundColor Red
Write-Host "[WARN] Check this" -ForegroundColor Yellow

# GOOD - Simple decoration
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "Section Title" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
```

### 5. File Organization

**REQUIRED**:

- One function per logical unit
- Clear parameter documentation
- Consistent indentation (4 spaces)
- Comments for complex logic

**STRUCTURE**:

```TypeScript
param(
    [string]$Parameter1,
    [switch]$Flag,
    [ValidateSet('option1', 'option2')]
    [string]$Choice
)

$ErrorActionPreference = 'Stop'

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Do-Something {
    param([string]$Input)

    Write-Info "Processing: $Input"

    # Logic here

    return $result
}

# Main execution
Write-Info "Starting script"
Do-Something -Input "test"
Write-Info "Script completed"
exit 0
```

---

## Audit Results

### Current Status

- **Total Scripts**: 116
- **Compliant**: 74 (63.8%)
- **Non-Compliant**: 42 (36.2%)

### Issues by Category

#### Non-ASCII Characters (18 scripts)

Scripts containing emojis or special Unicode characters:

- `validate-script-governance.ps1`
- `check-api.ps1`
- `check-documentation.ps1`
- `check-gitflow.ps1`
- `check-security.ps1`
- `check-testing.ps1`
- `continuous-status-monitor.ps1`
- `cross-workspace-validator.ps1`
- `weekly-metrics.ps1`
- `migrate.ps1`
- `day-end-closure.ps1`
- `deploy.ps1`
- `ensure-tools-active.ps1`
- `export-backlog-csv.ps1`
- `generate-pr-artifacts.ps1`
- `generate-session-artifacts.ps1`
- `manage-backlog.ps1`
- `Microsoft.TypeScript_profile.ps1`
- `migrate-structure.ps1`
- `orchestrator-status.ps1`
- `pre-compact-hook.ps1`
- `setup-remote-agent.ps1`
- `validate-project.ps1`
- `validate-workspace.ps1`

#### Unbalanced Syntax (24 scripts)

Scripts with unbalanced braces, parentheses, or here-strings:

- `bootstrap-workspace.ps1` - Unbalanced braces
- `gv.ps1` - Multiple unbalanced elements
- `check-quality.ps1` - Invalid shell operators
- `check-testing.ps1` - Invalid shell operators
- `create-gitflow-branch.ps1` - Unbalanced parentheses
- `create-skill.ps1` - Invalid escape sequences
- `enable-optional-post-commit.ps1` - Unbalanced parentheses
- `end-session.ps1` - Unbalanced here-strings
- `generate-audit-report.ps1` - Unbalanced here-strings
- `invoke-ai-review.ps1` - Unbalanced here-strings
- `judgment-day.ps1` - Unbalanced parentheses
- `session-idle-monitor.ps1` - Unbalanced parentheses
- `session-manager.ps1` - Unbalanced parentheses
- `simplify-text.ps1` - Unbalanced parentheses
- `homologate-workspace.ps1` - Unbalanced parentheses
- And others...

#### Syntax Errors (Multiple)

Scripts with invalid TypeScript syntax:

- Shell operators (`||`, `&&`) not supported in TypeScript
- Invalid variable references
- Incomplete hash literals
- Missing closing delimiters

---

## Remediation Plan

### Phase 1: Critical (Week 1)

Fix scripts that cause GitHub Actions failures:

1. Remove all non-ASCII characters
2. Fix unbalanced syntax elements
3. Replace shell operators with TypeScript equivalents
4. Validate all scripts parse correctly

### Phase 2: Important (Week 2)

Fix remaining compliance issues:

1. Normalize all output messages
2. Standardize encoding across all files
3. Update documentation

### Phase 3: Verification (Week 3)

1. Run full audit again
2. Validate in GitHub Actions
3. Update this document

---

## How to Fix

### Automated Fix

```TypeScript
# Run audit with automatic fixes
.\scripts\utilities\audit-script-normalization.ps1 -Fix -Report
```

### Manual Fix

**Remove Non-ASCII Characters**:

```TypeScript
$scriptPath = '.\scripts\path\to\script.ps1'
$content = Get-Content $scriptPath -Raw
$content = $content -replace '[^\x00-\x7F]', ''
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($scriptPath, $content, $utf8NoBom)
```

**Replace Shell Operators**:

```TypeScript
# Before
command1 || command2
command1 && command2

# After
if (-not (command1)) { command2 }
if (command1) { command2 }
```

**Fix Unbalanced Syntax**:

- Use TypeScript ISE or VS Code to identify unmatched braces
- Ensure all `{` have matching `}`
- Ensure all `(` have matching `)`
- Ensure all `@"` have matching `"@`

---

## Validation

### Check Script Compliance

```TypeScript
# Validate single script
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
    '.\scripts\path\to\script.ps1',
    [ref]$null,
    [ref]$errors
)

if ($errors.Count -gt 0) {
    Write-Host "Errors found:"
    $errors | ForEach-Object { Write-Host "  $_" }
} else {
    Write-Host "Script is valid"
}
```

### Run Full Audit

```TypeScript
# Generate report
.\scripts\utilities\audit-script-normalization.ps1 -Report

# View report
Get-Content .\docs\audit\script-normalization-report.md
```

---

## Best Practices

### DO

- Use `[OK]`, `[ERROR]`, `[WARN]`, `[INFO]` for status messages
- Use UTF-8 encoding without BOM
- Use ASCII-only characters in code
- Balance all syntax elements
- Test scripts locally before committing
- Use TypeScript operators, not shell operators

### DON'T

- Use emojis or special Unicode characters in scripts
- Use shell operators (`||`, `&&`)
- Use UTF-8 BOM encoding
- Leave unbalanced braces or parentheses
- Use curly quotes or special quote characters
- Mix TypeScript and shell syntax

### CRITICAL: Parser-Breaking Patterns

**The `[OK]`, `[ERROR]`, `[FAIL]`, `[WARN]` pattern at the start of a line (without `Write-Host` or
`Write-Output`) BREAKS the TypeScript parser.**

**PROBLEM**:

```TypeScript
# This breaks the parser - TypeScript interprets [OK] as an index expression
[OK] Validation passed     ERROR: Index expression without array

# This also breaks in here-strings without proper handling
Write-Host @"
[OK] Validation passed
"@
```

**CORRECT**:

```TypeScript
# GOOD - Use Write-Host or Write-Output
Write-Host "[OK] Validation passed" -ForegroundColor Green
Write-Output "[OK] Validation passed"

# GOOD - Prefix with # in examples and here-strings
Write-Host @"
[# OK] Validation passed
[] All good
"@

# GOOD - Use Write- function
function Write-Ok { param($m) Write-Host "[OK] $m" -ForegroundColor Green }
Write-Ok "Validation passed"
```

---

## Resources

- [TypeScript Syntax](https://docs.microsoft.com/en-us/TypeScript/module/microsoft.TypeScript.core/about/about_syntax)
- [Encoding in TypeScript](https://docs.microsoft.com/en-us/TypeScript/module/microsoft.TypeScript.core/about/about_character_encoding)
- [Script Analyzer](https://github.com/TypeScript/PSScriptAnalyzer)

---

## Next Steps

1. Review audit report: `docs/audit/script-normalization-report.md`
2. Fix critical issues in Phase 1 scripts
3. Run automated fixes: `audit-script-normalization.ps1 -Fix`
4. Validate all scripts parse correctly
5. Commit changes and verify GitHub Actions passes
