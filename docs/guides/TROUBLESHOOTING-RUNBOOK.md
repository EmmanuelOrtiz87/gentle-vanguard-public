# Troubleshooting Runbook

**Purpose**: Diagnose and resolve common gentle-vanguard issues  
**Audience**: Developers, DevOps, Security team  
**Last Updated**: May 13, 2026

---

## Table of Contents

1. [Git Flow Issues](#git-flow-issues)
2. [Test & Hook Failures](#test--hook-failures)
3. [npm & Dependency Issues](#npm--dependency-issues)
4. [MCP Workspace Problems](#mcp-workspace-problems)
5. [Release Workflow Issues](#release-workflow-issues)
6. [Security Gate Blocks](#security-gate-blocks)
7. [Performance & Timeouts](#performance--timeouts)

---

## Git Flow Issues

### Problem: Stuck in wrong branch after `git checkout`

**Symptom**: You're on `main` but expected to be on `feature/something`

**Root Cause**: Incorrect branch creation or accidental checkout

**Solution**:

```TypeScript
# 1. Check current branch
git branch --show-current
# Expected: feature/something, bugfix/something, or develop/main

# 2. If on main/develop (wrong):
git checkout -b feature/your-feature-name
# OR switch to existing branch:
git checkout feature/your-feature-name

# 3. Verify
git branch --show-current
```

**Reference**: [GITFLOW-QUICK-REFERENCE.md](GITFLOW-QUICK-REFERENCE.md)

---

### Problem: Merge conflicts in `package-lock.json`

**Symptom**: `git merge` fails with conflicts in package-lock.json

**Root Cause**: Two branches modified npm dependencies independently

**Solution**:

```TypeScript
# 1. Check status
git status
# You should see "both modified: package-lock.json"

# 2. Abort the merge (safest option)
git merge --abort

# 3. Take the other branch's lockfile
git checkout --theirs package-lock.json
# OR take ours:
git checkout --ours package-lock.json

# 4. Verify and test
npm audit  # Must pass
npm test   # All tests must pass

# 5. Complete merge
git add package-lock.json
git commit -m "merge: resolve package-lock.json (took $BRANCH)"
```

**Alternative**: Regenerate lockfile from scratch:

```TypeScript
# If conflict is severe:
git checkout --ours package.json
rm package-lock.json
npm install  # Recreate
git add package-lock.json
git commit -m "merge: regenerate package-lock.json"
```

---

### Problem: "Your branch is behind" when trying to push

**Symptom**: `git push` fails with "Your branch is behind"

**Root Cause**: Remote has changes you haven't pulled

**Solution**:

```TypeScript
# 1. Fetch latest
git fetch origin

# 2. Rebase your changes on top
git rebase origin/your-branch-name
# OR merge (less preferred):
git merge origin/your-branch-name --no-edit

# 3. Resolve any conflicts (if present)
# - Edit files to resolve
# - git add .
# - git rebase --continue

# 4. Push
git push origin your-branch-name
```

**⚠️ NEVER force push unless discussed with team**:

```TypeScript
git push --force-with-lease origin your-branch-name  # Safer than --force
```

---

## Test & Hook Failures

### Problem: Pre-commit hook failing with "json-lint" error

**Symptom**: `git commit` blocked with `[FAILED] json-lint`

**Root Cause**: Invalid JSON in staged `.json` files

**Solution**:

```TypeScript
# 1. Find the problematic file
git diff --cached --name-only | Where-Object { $_ -match '\.json$' }

# 2. Validate the file
$file = "path/to/file.json"
Get-Content $file | ConvertFrom-Json -ErrorAction Stop
# This will show the JSON error location

# 3. Fix the JSON (common issues):
# - Missing commas between properties
# - Trailing commas (not allowed)
# - Unquoted keys
# - Invalid escape sequences

# 4. Stage the fix and retry
git add $file
git commit -m "fix: correct JSON formatting in $file"
```

**Quick JSON validator**:

```TypeScript
# Paste JSON directly
@"
{
  "key": "value",
  "incomplete"  # Missing comma above
}
"@ | ConvertFrom-Json
```

---

### Problem: Pre-push hook blocking with "Test failed"

**Symptom**: `git push` blocked, tests failing

**Root Cause**: Code changes broke existing tests

**Solution**:

```TypeScript
# 1. Run tests locally first (before push attempt)
npm test
# OR:
.\scripts\run-tests-simple.ps1

# 2. Identify failing test file
# Output should show: "FAILED: filename.tests.ps1"

# 3. Run specific test
.\tests\unit\filename.tests.ps1

# 4. Debug the failure
# - Check test output for expected vs actual
# - Review your recent changes
# - Common causes:
#   - Logic error in new code
#   - Missing mock/stub in test
#   - Hardcoded path assumptions

# 5. Fix the code or test
code "path/to/file.ps1"  # Edit in VS Code
# OR
code "tests/unit/filename.tests.ps1"  # Edit test

# 6. Run test again to verify
.\tests\unit\filename.tests.ps1

# 7. When all green, retry push
git push
```

**For unit test failures**:

```TypeScript
# Run with verbose output
Invoke-Pester -Path "tests/unit/filename.tests.ps1" -Verbose
```

---

### Problem: "orchestrator-auto-fix" pre-push hook hangs

**Symptom**: Push hangs for 30+ seconds at "orchestrator-auto-fix"

**Root Cause**: Orchestrator running full validation suite (takes time)

**Solution**:

```TypeScript
# 1. This is normal on first push after big changes
# - Orchestrator validates: security, config, skills, docs
# - Typical runtime: 10-30 seconds
# - Be patient!

# 2. If hanging > 60 seconds:

# Cancel with Ctrl+C
# Then check status:
git status  # See what orchestrator was trying

# 3. Run orchestrator manually to see details
.\scripts\hooks\orchestrate-auto-fix.ps1 -Verbose
# This shows exactly what's being validated

# 4. Common causes of hangs:
# - Large skill directories (128+ skills)
# - Slow disk I/O
# - Network latency (if any remote checks)

# 5. If still hanging, report:
# Get terminal output:
# $process = Get-Process -Name "TypeScript" | Stop-Process
# Then provide logs to security-team@example.com
```

---

## npm & Dependency Issues

### Problem: "npm audit" pre-push blocked with vulnerabilities

**Symptom**: `git push` blocked — "npm audit found vulnerabilities"

**Root Cause**: Your code or dependencies have security issues

**Solution**:

```TypeScript
# 1. See what vulnerabilities exist
npm audit

# 2. Understand the issue
# Output shows:
# - Package name
# - Vulnerability description
# - Severity (critical|high|moderate|low)
# - Fix available? (yes|no)

# 3. Auto-fix if possible
npm audit fix

# 4. Review what changed
git diff package-lock.json
# Look for version bumps

# 5. Test the fix
npm test

# 6. If tests pass, commit and retry push
git add package-lock.json
git commit -m "fix(security): resolve npm vulnerabilities"
git push
```

**If "npm audit fix" doesn't work**:

```TypeScript
# Try force fix (use with caution)
npm audit fix --force

# Check what it changed
npm audit  # Should show 0 vulnerabilities

# If still failing, may need manual intervention:
# 1. Identify the specific vulnerable package
npm audit --json | ConvertFrom-Json | Select-Object vulnerabilities

# 2. Check if there's a safe version
npm view @vulnerable-package versions

# 3. Update manually
npm install @vulnerable-package@safe-version --save-exact

# 4. Test and commit
npm test
git commit ...
```

---

### Problem: "lockfile-lint" pre-commit rejects package-lock.json

**Symptom**: `git commit` blocked — "Lockfile validation failed"

**Root Cause**: Corrupted or malformed package-lock.json

**Solution**:

```TypeScript
# 1. Check what the validator found
# Run manually for verbose output:
.\scripts\hooks\lockfile-lint-pre-commit.ps1 -Verbose

# 2. Common issues:
# - Invalid JSON syntax
# - Missing required fields (lockfileVersion, packages)
# - Missing integrity hashes
# - Invalid version format

# 3. If JSON is broken, regenerate:
rm package-lock.json
npm install

# 4. If only specific issues, try:
npm ci  # Clean install from lockfile

# 5. Validate
.\scripts\hooks\lockfile-lint-pre-commit.ps1 -Verbose

# 6. Stage and commit
git add package-lock.json
git commit -m "fix: restore valid package-lock.json"
```

**Emergency: Force skip (NOT RECOMMENDED)**:

```TypeScript
# Only if you absolutely know the lockfile is safe:
git commit --no-verify -m "emergency: skip lockfile validation"
# You must explain this in the commit message and PR
```

---

### Problem: "npm install" fails with "connection timeout"

**Symptom**: `npm install` hangs then fails — "ETIMEDOUT"

**Root Cause**: npm registry unreachable or network issue

**Solution**:

```TypeScript
# 1. Check internet connection
Test-Connection registry.npmjs.org -Count 1

# 2. Clear npm cache
npm cache clean --force

# 3. Configure longer timeout
npm config set fetch-timeout 120000
npm config set fetch-retry-mintimeout 20000
npm config set fetch-retry-maxtimeout 120000

# 4. Retry install
npm install

# 5. If still fails, check npm registry status:
# Visit https://status.npmjs.org/ to see if there's an outage

# 6. Workaround: Use offline mode (if dependencies cached)
npm ci --offline  # Only works if node_modules cached

# 7. Last resort: Use npm mirror
npm config set registry https://registry.npmmirror.com
npm install
# Don't forget to reset:
npm config set registry https://registry.npmjs.org/
```

---

## MCP Workspace Problems

### Problem: "npx: not found" or npm offline mode fails

**Symptom**: MCP command fails — "cannot find npx" or "--offline not working"

**Root Cause**: MCP workspace not initialized or npx cannot find package

**Solution**:

```TypeScript
# 1. Verify MCP workspace exists
Test-Path $HOME\mcp-workspace
# Expected: True

# 2. Check package is installed there
Test-Path "$HOME\mcp-workspace\node_modules\@modelcontextprotocol\server-filesystem"
# Expected: True

# 3. If missing, recreate MCP workspace:
mkdir $HOME\mcp-workspace -Force
cd $HOME\mcp-workspace
npm init -y
npm install @modelcontextprotocol/server-filesystem@2026.1.14 --save-exact

# 4. Test npx offline mode works
npx --include-workspace-root --workspace $HOME\mcp-workspace --no --offline @modelcontextprotocol/server-filesystem --version
# Should print version without errors
```

---

### Problem: MCP workspace has old version of package

**Symptom**: MCP runs but with outdated features

**Root Cause**: MCP package version is stale

**Solution**:

```TypeScript
# 1. Check current version
cd $HOME\mcp-workspace
npm list @modelcontextprotocol/server-filesystem

# 2. Review available updates
npm view @modelcontextprotocol/server-filesystem versions --json | ConvertFrom-Json | Select-Object -Last 5

# 3. Update to new version (respects min-release-age)
npm update @modelcontextprotocol/server-filesystem --save-exact

# 4. Review changes
git diff package-lock.json  # If you're tracking workspace in git

# 5. Verify no vulnerabilities
npm audit

# 6. Test
npx --include-workspace-root --workspace $HOME\mcp-workspace --no --offline @modelcontextprotocol/server-filesystem --version
```

---

## Release Workflow Issues

### Problem: "Homologation gate failed"

**Symptom**: `src/cli/gv.ts publish` blocked — "Multi-Repo Homologation Gate failed"

**Root Cause**: Repos are misaligned (VERSION, branches, or tags don't match)

**Solution**:

```TypeScript
# 1. Run gate manually to see details
.\scripts\utilities\src/cli/gv.ts release-homologation

# 2. Common issues:

# VERSION mismatch
cat VERSION
# gentle-vanguard VERSION should = gentle-vanguard-public VERSION

# 3. Branch alignment
git branch -v origin/main
git branch -v origin/develop
# Both gentle-vanguard and gentle-vanguard-public should have same commits

# 4. Working tree cleanliness
git status
# Must show "nothing to commit, working tree clean"

# 5. Fix the issues:

# If VERSION is wrong:
"1.0.0" | Out-File VERSION  # Update to match other repo
git add VERSION
git commit -m "chore: align VERSION for release"
git push origin main

# If branch is behind:
git fetch origin
git pull origin main
git pull origin develop

# 6. Retry gate
.\scripts\utilities\src/cli/gv.ts release-homologation
# Should now pass

# 7. Retry publish
.\scripts\utilities\src/cli/gv.ts publish
```

**Emergency: Skip gate (NOT RECOMMENDED)**:

```TypeScript
# Only for critical hotfixes:
.\scripts\utilities\src/cli/gv.ts publish -SkipHomologationGate
# You must justify this in the release notes
```

---

### Problem: Publish workflow timeout

**Symptom**: `src/cli/gv.ts publish` runs for 30+ minutes then times out

**Root Cause**: Tests or validation taking too long

**Solution**:

```TypeScript
# 1. This is unusual — publish typically takes 5-10 minutes
# Check what step is taking time:

# 2. Run stages individually:

# Stage 1: Homologation gate
.\scripts\utilities\src/cli/gv.ts release-homologation
# How long? Expected: < 1 min

# Stage 2: Tests
npm test
# How long? Expected: < 2 min (33 tests)

# Stage 3: Secrets scan
# (part of publish, hard to test separately)

# 3. If tests are slow:
# - Check CPU/disk usage
# - Close other apps
# - Retry

# 4. If still timing out:
# Contact security-team with:
$start = Get-Date
.\scripts\utilities\src/cli/gv.ts publish
$duration = (Get-Date) - $start
Write-Host "Duration: $($duration.TotalMinutes) minutes"
```

---

## Security Gate Blocks

### Problem: Pre-commit secret detection false positive

**Symptom**: `git commit` blocked — "AWS Access Key detected" (but it's example code)

**Root Cause**: Legitimate string matches security pattern

**Solution**:

```TypeScript
# 1. Check what was detected
git diff --cached --name-only
# Identifies which file has the "secret"

# 2. Options:

# A. Remove/redact the sensitive-looking string
# Edit the file, change "AKIA..." to "AKIA<REDACTED>"
code "path/to/file"

# B. Add file to exceptions
# Contact security-team, they can add to ExcludedPaths in check-security.ps1

# C. Force skip (NOT RECOMMENDED)
git commit --no-verify -m "..."
# Must explain in commit message

# 3. Recommended: Always use example/placeholder values in docs
# GOOD: "AKIA123456789EXAMPLE"
# BAD:  "AKIAIOSFODNN7EXAMPLE" (real-looking)
```

---

## Performance & Timeouts

### Problem: Pre-push hooks take 2+ minutes

**Symptom**: `git push` hangs at "audit-check" or "test-suite"

**Root Cause**: Running full test suite on every push

**Solution**:

```TypeScript
# This is EXPECTED behavior - pre-push validates everything
# Typical timeline:
# - audit-check: 1-2 min (128 skills validated)
# - test-suite: 50-60 sec (33 tests)
# - Total: ~2 minutes

# To optimize:
# 1. Don't run on every tiny push
# - Make logical commits
# - Group related changes

# 2. If you MUST bypass (not recommended):
git push --no-verify

# 3. Better: Run pre-push checks early
# Then when you push, it's already been validated

# 4. Monitor performance
# If suddenly slow, check:
Get-Process | Select-Object -Property Name, CPU, Memory | Sort-Object CPU -Descending

# 5. Report if consistently > 2 min:
# Timeline:
# git push --start-time=<timestamp>
```

---

## Escalation

**Still stuck?**

1. **Check**: [SECURITY-HARDENING.md](SECURITY-HARDENING.md) — general security policies
2. **Read**: [STACK-OPTIMIZATION-ROADMAP.md](STACK-OPTIMIZATION-ROADMAP.md) — future improvements
3. **Contact**: security-team@example.com with:
   - Error message (full output)
   - Steps to reproduce
   - Environment (Windows version, TypeScript version, Node version)
   - Timeline (when it started happening)

---

**Runbook Last Updated**: May 13, 2026  
**Maintainer**: Security Team  
**Review Cycle**: Monthly or as issues arise
