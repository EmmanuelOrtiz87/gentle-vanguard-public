# Quick Fix Guide - Script Normalization

**For Developers**: Fast reference to fix remaining scripts

---

## One-Minute Diagnosis

```TypeScript
# Check which scripts have issues
.\scripts\utilities\audit-script-normalization.ps1 -Report

# View the report
Get-Content .\docs\audit\script-normalization-report.md
```

---

## Top 5 Scripts to Fix First

### 1. src/cli/gv.ts

**Problem**: Missing 1 closing brace, 2 extra closing parentheses  
**Quick Fix**:

1. Open: `scripts/gentle-vanguard/src/cli/gv.ts`
2. Search for: `function` and count braces
3. Look for unclosed `if` or `foreach` statements

### 2. bootstrap-workspace.ps1

**Problem**: Missing 2 closing braces  
**Quick Fix**:

1. Open: `scripts/gentle-vanguard/bootstrap-workspace.ps1`
<!-- REF-OBSOLETA: scripts/gentle-vanguard/bootstrap-workspace.ps1 no tiene equivalente TS (migración PS1→TS) -->
2. Check all `function` definitions
3. Verify all `if/else` blocks are closed

### 3. validate-script-governance.ps1

**Problem**: Syntax error with token 'Script'  
**Quick Fix**:

1. Open: `scripts/diagnostics/validate-script-governance.ps1`
<!-- REF-OBSOLETA: scripts/diagnostics/validate-script-governance.ps1 no tiene equivalente TS (migración PS1→TS) -->
2. Search for: `Script` keyword
3. Check for incomplete statements

### 4. session-manager.ps1

**Problem**: 2 extra closing parentheses  
**Quick Fix**:

1. Open: `src/session-manager.ts`
2. Remove 2 extra `)` characters
3. Validate with audit tool

### 5. homologate-workspace.ps1

**Problem**: 5 extra closing parentheses  
**Quick Fix**:

1. Open: `scripts/validation/homologate-workspace.ps1`
<!-- REF-OBSOLETA: scripts/validation/homologate-workspace.ps1 no tiene equivalente TS (migración PS1→TS) -->
2. Find and remove 5 extra `)` characters
3. Validate with audit tool

---

## Validation Commands

```TypeScript
# Validate single script
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
    '.\scripts\path\to\script.ps1',
    [ref]$null,
    [ref]$errors
)
if ($errors) { $errors | ForEach-Object { Write-Host $_.Message } }
else { Write-Host "OK" }

# Run full audit
.\scripts\utilities\audit-script-normalization.ps1 -Report

# Check specific category
Get-ChildItem .\scripts\utilities\*.ps1 | ForEach-Object {
    $errors = $null
    [System.Management.Automation.Language.Parser]::ParseFile(
        $_.FullName,
        [ref]$null,
        [ref]$errors
    ) | Out-Null
    if ($errors) { Write-Host "$($_.Name): FAIL" }
    else { Write-Host "$($_.Name): OK" }
}
```

---

## Common Issues & Fixes

### Extra Closing Parentheses

```TypeScript
# WRONG - Extra )
Write-Host "test"))

# RIGHT
Write-Host "test"
```

### Missing Closing Brace

```TypeScript
# WRONG - Missing }
function Test {
    Write-Host "test"

# RIGHT
function Test {
    Write-Host "test"
}
```

### Unbalanced Here-Strings

```TypeScript
# WRONG - Missing "@
$text = @"
This is a
multi-line string

# RIGHT
$text = @"
This is a
multi-line string
"@
```

---

## Workflow

1. **Identify** - Run audit to see which scripts fail
2. **Prioritize** - Start with Critical scripts
3. **Fix** - Use VS Code to find and fix issues
4. **Validate** - Run audit again to confirm
5. **Commit** - Push changes to Git

---

## Need Help?

- **Full Guide**: `docs/guides/REMAINING-SCRIPTS-TO-FIX.md`
- **Standards**: `docs/guides/SCRIPT-NORMALIZATION-STANDARDS.md`
- **Audit Tool**: `scripts/utilities/audit-script-normalization.ps1`
<!-- REF-OBSOLETA: scripts/utilities/audit-script-normalization.ps1 no tiene equivalente TS (migración PS1→TS) -->
