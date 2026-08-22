# Remaining Scripts to Fix - Priority List

**Date**: 2026-04-22  
**Status**: 21 scripts remaining (17.5%)  
**Current Compliance**: 82.5% (99/120 scripts)

---

## Critical Priority - Must Fix

These scripts are essential for project functionality and must be fixed first.

### 1. src/cli/gv.ts (Gentle-Vanguard - CRITICAL)

**Location**: `scripts/gentle-vanguard/src/cli/gv.ts`  
**Issues**:

- Unbalanced braces: 501 open, 500 closed (missing 1 closing brace)
- Unbalanced here-strings: 4 open, 6 closed
- Unbalanced parentheses: 664 open, 666 closed (2 extra closing)

**Impact**: Core workflow script - HIGH PRIORITY  
**Fix Strategy**:

1. Open in VS Code
2. Use Find & Replace to locate unmatched braces
3. Check function definitions and here-strings
4. Validate with:
   `[System.Management.Automation.Language.Parser]::ParseFile('.\scripts\gentle-vanguard\src/cli/gv.ts', [ref]$null, [ref]$errors)`

**Estimated Effort**: 30-45 minutes

---

### 2. bootstrap-workspace.ps1 (Gentle-Vanguard)

**Location**: `scripts/gentle-vanguard/bootstrap-workspace.ps1`
<!-- REF-OBSOLETA: scripts/gentle-vanguard/bootstrap-workspace.ps1 no tiene equivalente TS (migración PS1→TS) -->

**Issues**:

- Unbalanced braces: 219 open, 217 closed (missing 2 closing braces)

**Impact**: Workspace initialization - HIGH PRIORITY  
**Fix Strategy**:

1. Search for unclosed function blocks
2. Check conditional statements (if/else)
3. Verify hash table definitions

**Estimated Effort**: 20-30 minutes

---

### 3. validate-script-governance.ps1 (Diagnostics)

**Location**: `scripts/diagnostics/validate-script-governance.ps1`
<!-- REF-OBSOLETA: scripts/diagnostics/validate-script-governance.ps1 no tiene equivalente TS (migración PS1→TS) -->

**Issues**:

- Syntax error: Token 'Script' unexpected

**Impact**: Validation script - MEDIUM PRIORITY  
**Fix Strategy**:

1. Check for invalid variable references
2. Verify parameter definitions
3. Look for incomplete statements

**Estimated Effort**: 15-20 minutes

---

## High Priority - Should Fix

These scripts are used in important workflows but not critical path.

### 4. session-manager.ps1 (Utilities)

**Location**: `src/session-manager.ts`  
**Issues**:

- Unbalanced parentheses: 78 open, 80 closed (2 extra closing)

**Impact**: Session management - HIGH PRIORITY  
**Fix Strategy**:

1. Review function calls
2. Check parameter lists
3. Verify array definitions

**Estimated Effort**: 20-25 minutes

---

### 5. homologate-workspace.ps1 (Validation)

**Location**: `scripts/validation/homologate-workspace.ps1`
<!-- REF-OBSOLETA: scripts/validation/homologate-workspace.ps1 no tiene equivalente TS (migración PS1→TS) -->

**Issues**:

- Unbalanced parentheses: 119 open, 124 closed (5 extra closing)

**Impact**: Workspace validation - HIGH PRIORITY  
**Fix Strategy**:

1. Review complex function calls
2. Check nested parentheses
3. Verify parameter passing

**Estimated Effort**: 25-35 minutes

---

### 6. judgment-day.ps1 (Utilities)

**Location**: `scripts/utilities/judgment-day.ps1`
<!-- REF-OBSOLETA: scripts/utilities/judgment-day.ps1 no tiene equivalente TS (migración PS1→TS) -->

**Issues**:

- Unbalanced parentheses: 57 open, 60 closed (3 extra closing)

**Impact**: Judgment/review script - MEDIUM PRIORITY  
**Fix Strategy**:

1. Check function definitions
2. Review conditional logic
3. Verify method calls

**Estimated Effort**: 20-25 minutes

---

### 7. create-gitflow-branch.ps1 (Utilities - RECENTLY CREATED)

**Location**: `scripts/utilities/create-gitflow-branch.ps1`
<!-- REF-OBSOLETA: scripts/utilities/create-gitflow-branch.ps1 no tiene equivalente TS (migración PS1→TS) -->

**Issues**:

- Unbalanced parentheses: 35 open, 40 closed (5 extra closing)

**Impact**: GitFlow helper - MEDIUM PRIORITY  
**Note**: This is a script we created - needs review **Fix Strategy**:

1. Review all Write-Host statements
2. Check switch statement
3. Verify function calls

**Estimated Effort**: 15-20 minutes

---

## Medium Priority - Should Fix

These scripts have less critical impact but should be fixed for completeness.

### 8. session-idle-monitor.ps1 (Utilities)

**Location**: `scripts/utilities/session-idle-monitor.ps1`
<!-- REF-OBSOLETA: scripts/utilities/session-idle-monitor.ps1 no tiene equivalente TS (migración PS1→TS) -->

**Issues**:

- Unbalanced parentheses: 36 open, 40 closed (4 extra closing)

**Estimated Effort**: 15-20 minutes

---

### 9. simplify-text.ps1 (Utilities)

**Location**: `scripts/utilities/simplify-text.ps1`
<!-- REF-OBSOLETA: scripts/utilities/simplify-text.ps1 no tiene equivalente TS (migración PS1→TS) -->

**Issues**:

- Unbalanced parentheses: 73 open, 74 closed (1 extra closing)

**Estimated Effort**: 10-15 minutes

---

### 10. enable-optional-post-commit.ps1 (Utilities)

**Location**: `scripts/utilities/enable-optional-post-commit.ps1`
<!-- REF-OBSOLETA: scripts/utilities/enable-optional-post-commit.ps1 no tiene equivalente TS (migración PS1→TS) -->

**Issues**:

- Unbalanced parentheses: 38 open, 40 closed (2 extra closing)

**Estimated Effort**: 15-20 minutes

---

### 11. input-validator.ps1 (Security)

**Location**: `scripts/security/input-validator.ps1`
<!-- REF-OBSOLETA: scripts/security/input-validator.ps1 no tiene equivalente TS (migración PS1→TS) -->

**Issues**:

- Unbalanced parentheses: 36 open, 35 closed (1 missing closing)

**Estimated Effort**: 10-15 minutes

---

### 12. migrate.ps1 (Project)

**Location**: `scripts/project/migrate.ps1`
<!-- REF-OBSOLETA: scripts/project/migrate.ps1 no tiene equivalente TS (migración PS1→TS) -->

**Issues**:

- Unbalanced parentheses: 37 open, 36 closed (1 missing closing)
- Multiple syntax errors including `&&` operators and invalid variable references
- Requires comprehensive review

**Estimated Effort**: 30-40 minutes

---

## Lower Priority - Can Fix Later

These scripts have syntax issues but are less frequently used.

### 13. encryption-manager.ps1 (Security)

**Location**: `scripts/security/encryption-manager.ps1`
<!-- REF-OBSOLETA: scripts/security/encryption-manager.ps1 no tiene equivalente TS (migración PS1→TS) -->

**Issues**:

- Unbalanced braces: 15 open, 13 closed (missing 2 closing)
- Hash literal incomplete

**Estimated Effort**: 20-25 minutes

---

### 14. git-hooks-setup.ps1 (Testing)

**Location**: `scripts/testing/git-hooks-setup.ps1`
<!-- REF-OBSOLETA: scripts/testing/git-hooks-setup.ps1 no tiene equivalente TS (migración PS1→TS) -->

**Issues**:

- Unbalanced braces: 7 open, 4 closed (missing 3 closing)
- Here-string incomplete

**Estimated Effort**: 15-20 minutes

---

### 15. end-session.ps1 (Utilities)

**Location**: `scripts/utilities/end-session.ps1`
<!-- REF-OBSOLETA: scripts/utilities/end-session.ps1 no tiene equivalente TS (migración PS1→TS) -->

**Issues**:

- Unbalanced here-strings: 1 open, 3 closed

**Estimated Effort**: 10-15 minutes

---

### 16. generate-audit-report.ps1 (Utilities)

**Location**: `scripts/utilities/generate-audit-report.ps1`
<!-- REF-OBSOLETA: scripts/utilities/generate-audit-report.ps1 no tiene equivalente TS (migración PS1→TS) -->

**Issues**:

- Unbalanced here-strings: 3 open, 2 closed
- Missing here-string terminator

**Estimated Effort**: 15-20 minutes

---

### 17. invoke-ai-review.ps1 (Utilities)

**Location**: `scripts/utilities/invoke-ai-review.ps1`
<!-- REF-OBSOLETA: scripts/utilities/invoke-ai-review.ps1 no tiene equivalente TS (migración PS1→TS) -->

**Issues**:

- Unbalanced here-strings: 3 open, 4 closed
- Syntax error with token

**Estimated Effort**: 15-20 minutes

---

### 18. export-backlog-csv.ps1 (Utilities)

**Location**: `scripts/utilities/export-backlog-csv.ps1`
<!-- REF-OBSOLETA: scripts/utilities/export-backlog-csv.ps1 no tiene equivalente TS (migración PS1→TS) -->

**Issues**:

- Missing parameter argument

**Estimated Effort**: 10-15 minutes

---

### 19. create-skill.ps1 (Utilities)

**Location**: `scripts/utilities/create-skill.ps1`
<!-- REF-OBSOLETA: scripts/utilities/create-skill.ps1 no tiene equivalente TS (migración PS1→TS) -->

**Issues**:

- Multiple syntax errors from escape sequence fixes
- Requires manual review of string handling

**Estimated Effort**: 25-30 minutes

---

### 20. migrate-structure.ps1 (Utilities)

**Location**: `scripts/utilities/migrate-structure.ps1`
<!-- REF-OBSOLETA: scripts/utilities/migrate-structure.ps1 no tiene equivalente TS (migración PS1→TS) -->

**Issues**:

- Syntax errors from null-coalescing operator removal
- Array syntax issues

**Estimated Effort**: 20-25 minutes

---

### 21. create-gitflow-branch.ps1 (Utilities - DUPLICATE)

**Location**: `scripts/utilities/create-gitflow-branch.ps1`
<!-- REF-OBSOLETA: scripts/utilities/create-gitflow-branch.ps1 no tiene equivalente TS (migración PS1→TS) -->

**Issues**: Already listed as #7

---

## Fix Priority Roadmap

### Phase 1 - Critical (This Week)

1. **src/cli/gv.ts** - Core workflow
2. **bootstrap-workspace.ps1** - Initialization
3. **validate-script-governance.ps1** - Validation
4. **session-manager.ps1** - Session management

**Estimated Time**: 1.5-2 hours

### Phase 2 - High Priority (Next 2 Days)

5. **homologate-workspace.ps1** - Workspace validation
6. **judgment-day.ps1** - Review script
7. **create-gitflow-branch.ps1** - GitFlow helper
8. **migrate.ps1** - Migration script

**Estimated Time**: 1.5-2 hours

### Phase 3 - Medium Priority (Next Week)

9-12. Session monitoring and validation scripts

**Estimated Time**: 1-1.5 hours

### Phase 4 - Lower Priority (Following Week)

13-21. Security, testing, and utility scripts

**Estimated Time**: 2-2.5 hours

---

## How to Fix Scripts

### Step 1: Identify the Issue

```TypeScript
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
    '.\scripts\path\to\script.ps1',
    [ref]$null,
    [ref]$errors
)
$errors | ForEach-Object { Write-Host $_.Message }
```

### Step 2: Use VS Code Tools

1. Open script in VS Code
2. Use Ctrl+H (Find & Replace)
3. Use Ctrl+Shift+P (Command Palette)
4. Search for "TypeScript: Show Errors"

### Step 3: Common Fixes

**For Unbalanced Parentheses**:

- Check function calls: `Get-Something()`
- Check array definitions: `@(item1, item2)`
- Check parameter lists: `function Test($param1, $param2)`

**For Unbalanced Braces**:

- Check function definitions: `function Name { ... }`
- Check if/else blocks: `if ($condition) { ... } else { ... }`
- Check hash tables: `@{ key = value }`

**For Here-Strings**:

- Check multi-line strings: `@" ... "@`
- Ensure proper closing: `"@` must be on its own line

### Step 4: Validate

```TypeScript
.\scripts\utilities\audit-script-normalization.ps1 -Report
```

---

## Resources

- **Audit Tool**: `scripts/utilities/audit-script-normalization.ps1`

<!-- REF-OBSOLETA: scripts/utilities/audit-script-normalization.ps1 no tiene equivalente TS (migración PS1→TS) -->

- **Fix Tool**: `scripts/utilities/fix-remaining-scripts.ps1`

<!-- REF-OBSOLETA: scripts/utilities/fix-remaining-scripts.ps1 no tiene equivalente TS (migración PS1→TS) -->

- **Standards**: `docs/guides/SCRIPT-NORMALIZATION-STANDARDS.md`
- **TypeScript Docs**: https://docs.microsoft.com/en-us/TypeScript/

---

## Summary

| Category  | Count  | Estimated Time    |
| --------- | ------ | ----------------- |
| Critical  | 3      | 1-1.5 hours       |
| High      | 4      | 1.5-2 hours       |
| Medium    | 4      | 1-1.5 hours       |
| Lower     | 10     | 2-2.5 hours       |
| **TOTAL** | **21** | **5.5-7.5 hours** |

**Recommendation**: Focus on Critical and High Priority scripts first. These are the gentle-vanguard
of the project and will unblock most workflows.
