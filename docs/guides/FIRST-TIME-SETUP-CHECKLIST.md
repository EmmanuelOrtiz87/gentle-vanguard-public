# First-Time Setup Checklist

**Estimated Time**: 15-20 minutes  
**Level**: Beginner (follow steps sequentially)  
**Goal**: Get gentle-vanguard running locally with all security gates active

---

## Prerequisites Check

Before starting, verify you have:

```TypeScript
# TypeScript 7.x
pwsh --version
# Expected: TypeScript 7.4+

# Git
git --version
# Expected: 2.40+

# Node.js + npm
node --version
npm --version
# Expected: Node 20+, npm 10+
```

❌ Missing something? Install from:

- [TypeScript](https://github.com/TypeScript/TypeScript/releases)
- [Git](https://git-scm.com/download/win)
- [Node.js](https://nodejs.org/) (includes npm)

---

## Step 1: Clone Repository (2 min)

```TypeScript
# Clone gentle-vanguard (private repo — requires access)
git clone https://github.com/EmmanuelOrtiz87/gentle-vanguard.git
cd gentle-vanguard

# Verify structure
dir | Select-Object Name | head -10
```

**Expected**: See `src/`, `config/`, `scripts/`, `docs/`, `.lefthook.yml`, etc.

---

## Step 2: Initialize Git Hooks (2 min)

**lefthook** intercepts commits and pushes to validate security:

```TypeScript
# Install lefthook
npm install lefthook --save-dev

# Initialize hooks
npx lefthook install

# Verify hooks installed
ls .git/hooks
```

**Expected**: Should see files like `pre-commit`, `pre-push`, `commit-msg`

---

## Step 3: Create MCP Workspace (5 min)

This isolated workspace is required for secure MCP server execution:

```TypeScript
# Create directory
mkdir $HOME\mcp-workspace
cd $HOME\mcp-workspace

# Initialize npm
npm init -y

# Install MCP server (exact version)
npm install @modelcontextprotocol/server-filesystem@2026.1.14 --save-exact

# Verify
npm list @modelcontextprotocol/server-filesystem
# Expected: @modelcontextprotocol/server-filesystem@2026.1.14

# Check lockfile exists
Test-Path package-lock.json
# Expected: True
```

**⚠️ Important**: This workspace is **local only** (not in git). Repeat this on any new machine.

---

## Step 4: Setup npm Security Policy (1 min)

Global npm hardening prevents post-install script attacks:

```TypeScript
# Configure npm globally
npm config set ignore-scripts true
npm config set min-release-age 3

# Verify
npm config get ignore-scripts
npm config get min-release-age
```

**Expected**:

```
true
3
```

---

## Step 5: Install Gentle-Vanguard Dependencies (3 min)

```TypeScript
# Go back to gentle-vanguard root
cd C:\Workspace_local\gentle-vanguard

# Clean install (respects exact versions in lockfile)
npm ci --ignore-scripts

# Run full test suite to verify
npm test
# OR: pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/run-tests-simple.ps1
```

**Expected**: All tests pass (33/33)

---

## Step 6: Verify Security Gates (2 min)

Test that the new security gates are working:

```TypeScript
# 1. Check lockfile-lint exists
Test-Path "scripts/hooks/lockfile-lint-pre-commit.ps1"
# Expected: True

# 2. Check npm-audit exists
Test-Path "scripts/hooks/npm-audit-pre-push.ps1"
# Expected: True

# 3. Verify lefthook sees them
npx lefthook run pre-commit --no-verify
# Expected: Should run lockfile-lint check (will skip if no staged files)

# 4. Try a test commit (will be rejected if git errors)
# - Skip this on first setup, will test on real changes
```

---

## Step 7: Verify Project Structure (1 min)

Ensure critical directories exist:

```TypeScript
# Core directories
Test-Path "scripts/utilities/WORKFLOW-ORCHESTRATION" -PathType Container
Test-Path "docs/guides" -PathType Container
Test-Path "tests" -PathType Container

# Should all be True
```

---

## Step 8: Run Doctor Command (2 min)

The built-in diagnostic validates everything is working:

```TypeScript
# From gentle-vanguard root
.\scripts\utilities\gv.ps1 doctor

# Or if not available:
.\scripts\gentle-vanguard\gv.ps1 doctor
```

**Expected output**: Green checkmarks ✓ for all checks (TypeScript version, git, npm, etc.)

---

## Step 9: Create First Feature Branch (1 min)

Follow gitflow convention:

```TypeScript
# Create feature branch (automatic from develop)
git checkout develop
git pull origin develop

# Create feature branch
git checkout -b feature/my-feature-name

# Verify you're on the right branch
git branch --show-current
# Expected: feature/my-feature-name
```

---

## Step 10: Test Security Gates (1 min)

Make a dummy change to verify hooks work:

```TypeScript
# Create a test file
"# test" | Out-File test.md

# Stage it
git add test.md

# Commit (will trigger pre-commit hooks)
git commit -m "test: verify hooks are working"

# Pre-commit hooks should run:
# ✓ json-lint
# ✓ opencode-validation
# ✓ workflow-lint
# ✓ lockfile-lint (will skip, no package-lock changes)
```

**Expected**: Commit succeeds with green checkmarks

---

## ✅ You're Ready!

If all steps completed successfully:

| Check                                  | Status |
| -------------------------------------- | ------ |
| TypeScript 7+                          | ✅     |
| Git hooks installed                    | ✅     |
| MCP workspace at `$HOME\mcp-workspace` | ✅     |
| npm security policy active             | ✅     |
| Tests passing (33/33)                  | ✅     |
| Security gates verified                | ✅     |
| On feature branch                      | ✅     |

---

## Common Issues

### "npm install" fails with permission denied

**Solution**:

```TypeScript
# Run as Administrator
# OR change npm cache:
npm config set cache $HOME\.npm-cache
npm ci
```

### "lefthook: command not found"

**Solution**:

```TypeScript
# Reinstall
npm install lefthook --save-dev
npx lefthook install
```

### "lockfile-lint validation failed"

**Solution**: This is expected if you modified `package-lock.json`. Run:

```TypeScript
npm ci  # Restore clean lockfile
```

### Tests fail on first run

**Solution**: Check if you're on a feature branch:

```TypeScript
git branch --show-current
# Should NOT be 'main'
```

If tests still fail, reach out to security team with:

```TypeScript
npm test 2>&1 | Tee-Object test-output.txt
# Share test-output.txt
```

---

## Next Steps After Setup

1. **Read** [GETTING-STARTED.md](GETTING-STARTED.md) — Daily workflow
2. **Review** [GITFLOW-QUICK-REFERENCE.md](GITFLOW-QUICK-REFERENCE.md) — Branch strategy
3. **Check** [SECURITY-HARDENING.md](SECURITY-HARDENING.md) — Security policies
4. **Review** [Step 3](#step-3-create-mcp-workspace-5-min) above — MCP workspace setup details
5. **Reference** [STACK-OPTIMIZATION-ROADMAP.md](STACK-OPTIMIZATION-ROADMAP.md) — Future
   improvements

---

## Support

**Questions?**

- Check [TROUBLESHOOTING-RUNBOOK.md](TROUBLESHOOTING-RUNBOOK.md) for common problems
- Ask in #dev-gentle-vanguard Slack channel
- Email: security-team@example.com

**Setup taking too long?**

- Each step should take < 5 minutes
- If longer, something is wrong — get help early

---

**Setup Completed**: **\*\***\_\_\_\_**\*\*** (date/time)  
**Completed By**: **\*\***\_\_\_\_**\*\*** (your name)

✅ Ready to start coding!
