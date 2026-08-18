# GitFlow - Quick Reference

**Last updated**: 2026-04-22

---

## Quick Start

### Create a new branch (Recommended - Interactive)

```TypeScript
.\scripts\utilities\create-gitflow-branch.ps1
```

The script will guide you through:

1. Selecting the type of change (feature, bugfix, chore, hotfix, release)
2. Describing the change
3. Creating the branch automatically with the correct name
4. Showing the next steps

---

## Standard Workflows

### For New Features

```bash
# Option 1: Interactive (Recommended)
.\scripts\utilities\create-gitflow-branch.ps1

# Option 2: Manual
git checkout -b feature/feature-name
# Make changes
git add .
git commit -m "description of change"
git push -u origin feature/feature-name
# Open PR to 'develop'
```

**When to use**: When adding a new feature or functionality

---

### For Bug Fixes

```bash
# Option 1: Interactive (Recommended)
.\scripts\utilities\create-gitflow-branch.ps1

# Option 2: Manual
git checkout -b bugfix/bug-description
# Make changes
git add .
git commit -m "description of fix"
git push -u origin bugfix/bug-description
# Open PR to 'develop'
```

**When to use**: When fixing a bug found in development

---

### For Maintenance and Updates

```bash
# Option 1: Interactive (Recommended)
.\scripts\utilities\create-gitflow-branch.ps1

# Option 2: Manual
git checkout -b chore/change-description
# Make changes (update deps, refactoring, etc)
git add .
git commit -m "description of change"
git push -u origin chore/change-description
# Open PR to 'develop'
```

**When to use**: For dependency updates, refactoring, code cleanup

---

### For Critical Production Fixes (Hotfix)

```bash
# Option 1: Interactive (Recommended)
.\scripts\utilities\create-gitflow-branch.ps1

# Option 2: Manual
git checkout -b hotfix/critical-description
# Make changes
git add .
git commit -m "description of critical fix"
git push -u origin hotfix/critical-description
# Open PR to 'main'
```

**When to use**: Only for critical fixes that affect production (main)

---

### For Release Preparation

```bash
# Option 1: Interactive (Recommended)
.\scripts\utilities\create-gitflow-branch.ps1

# Option 2: Manual
git checkout -b release/v1.2.0
# Make final changes (versióning, changelog, etc)
git add .
git commit -m "release v1.2.0"
git push -u origin release/v1.2.0
# Open PR to 'main'
```

**When to use**: For preparing a new versión of the project

---

## Common Errors and Solutions

### Error: "Direct push from protected branch 'main' is blocked"

**Cause**: You tried to push directly to main or develop

**Solution**:

```bash
# Create a working branch
.\scripts\utilities\create-gitflow-branch.ps1

# Or manually:
git checkout -b feature/your-change
git push -u origin feature/your-change
```

---

### Error: "Branch does not match allowed GitFlow naming"

**Cause**: Your branch does not have the correct prefix

**Solution**: Your branch must start with:

- `feature/` - for new functionality
- `bugfix/` - for bug fixes
- `chore/` - for maintenance
- `hotfix/` - for critical fixes
- `release/` - for releases

```bash
# Correct examples:
git checkout -b feature/add-user-auth
git checkout -b bugfix/fix-login-timeout
git checkout -b chore/update-dependencies
```

---

### Error: "PR base 'main' violates GitFlow"

**Cause**: Your PR has the incorrect base

**Solution**: Depends on branch type:

- `feature/*`, `bugfix/*`, `chore/*` - Base must be: **develop**
- `hotfix/*`, `release/*` - Base must be: **main**

**How to fix**:

1. Close the current PR
2. Create a new PR with the correct base
3. Or edit the PR and change the base

---

## Branch Information

### Branch `main` (Production)

- **Purpose**: Production code
- **Protected**: Yes
- **Who can merge**: Only through PR
- **Allowed PR types**: hotfix/_, release/_
- **Requires review**: Yes

### Branch `develop` (Development)

- **Purpose**: Development code
- **Protected**: Yes
- **Who can merge**: Only through PR
- **Allowed PR types**: feature/_, bugfix/_, chore/\*
- **Requires review**: Yes

### Work Branches

- **Naming**: `type/description`
- **Duration**: Temporary (deleted after merge)
- **Base**: Depends on type
- **Example**: `feature/add-authentication`

---

## Complete Workflow Step by Step

### Step 1: Create branch

```bash
.\scripts\utilities\create-gitflow-branch.ps1
# Select type and description
```

### Step 2: Make changes

```bash
# Edit the necessary files
code .
```

### Step 3: Stage changes

```bash
git add .
git status  # Verify everything is correct
```

### Step 4: Create commit

```bash
git commit -m "clear description of change"
# Pre-commit hook will validate automatically
```

### Step 5: Push branch

```bash
git push -u origin feature/your-branch
# Pre-push hook will validate automatically
```

### Step 6: Open Pull Request

1. Go to GitHub
2. Click "Compare & pull request"
3. Verify:
   - Correct base (develop or main)
   - Descriptive title
   - Clear description
4. Click "Create pull request"

### Step 7: Wait for review

- Reviewers will validate your code
- Respond to comments if needed
- Make changes if requested

### Step 8: Merge

- Once approved, merge the PR
- Branch will be deleted automatically

---

## Best Practices

### Good Branch Names

```
feature/add-user-authentication
bugfix/fix-login-timeout
chore/update-dependencies
hotfix/critical-security-patch
release/v1.2.0
```

### Bad Branch Names

```
feature/my-changes
fix/stuff
update
wip
temp-branch
```

### Good Commit Messages

```
"Add user authentication with JWT"
"Fix login timeout issue"
"Update dependencies to latest versións"
"Critical security patch for SQL injection"
```

### Bad Commit Messages

```
"changes"
"fix"
"update"
"wip"
"asdf"
```

---

## Automation

### Pre-Commit Hook

Runs automatically when you run `git commit`

- Validates code with native
- Verifies review policies

### Pre-Push Hook

Runs automatically when you run `git push`

- Validates GitFlow
- Validates governance
- Validates homologation

If any validation fails, the push will be blocked. Read the error message to know what to fix.

---

## Need Help?

### Interactive Command

```bash
.\scripts\utilities\create-gitflow-branch.ps1
```

### Check Project Status

```bash
.\src/cli/gv.ts health
```

### Validate GitFlow Manually

```bash
.\scripts\diagnostics\validate-gitflow.ps1
```

---

## Complete Documentation

For more information, see:

- `docs/guides/GITFLOW-ENFORCEMENT-ANALYSIS.md` - Detailed analysis
- `docs/guides/DEVELOPER-COMMUNICATION-POLICY.md` - Development policies
- `src/validate-gitflow.ts` - GitFlow validator
