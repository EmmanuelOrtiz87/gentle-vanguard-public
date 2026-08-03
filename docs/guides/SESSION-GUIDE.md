# Session Guide

> **Quick reference for daily development sessions with Gentle-Vanguard**

## 🚀 Quick Commands

Use these commands to control your development session:

| Command               | Description                                                   | When to Use     |
| --------------------- | ------------------------------------------------------------- | --------------- |
| `Continuar`           | Resume work, check context                                    | Start of day    |
| `Estado`              | Show project status                                           | Check progress  |
| `Guardar`             | Commit & push changes                                         | Before breaks   |
| `Review`              | Run code review                                               | Before PR       |
| `PR`                  | Create pull request                                           | Ready to merge  |
| `Health`              | Check system health & activate tools                          | Troubleshooting |
| `Start Session`       | Create session brief and optional task brief                  | Beginning work  |
| `End Session`         | Run closure checks and generate delivery closure artifact     | End of day      |
| `Agent <NAME> <TASK>` | Delegate to specialized sub-agent (BA/SAD/DEV/QA/OPS/GOV/DOC) | Parallel work   |

## 🔧 Automatic Tool Activation

The Gentle-Vanguard automatically ensures all development tools are active and ready.

### Auto-Activation Triggers

| Trigger                | Action                                 | Notes                 |
| ---------------------- | -------------------------------------- | --------------------- |
| **Pre-commit**         | Tools validated before each commit     | Runs automatically    |
| **Session start**      | Session brief artifacts are generated  | Daily workflow        |
| **RED context health** | Orchestrator auto-runs `compact-start` | Recovers lost context |
| **Manual**             | Use `gv.ps1 health` anytime            | On-demand check       |

### Tools Activated

| Tool                            | Purpose                                 | Status Check    |
| ------------------------------- | --------------------------------------- | --------------- |
| **Engram**                      | Memory system for context persistence   | `mem_context`   |
| **Native Review Engine**        | Gentle-Vanguard code quality validation | Runs on commit  |
| **Native Runtime Orchestrator** | Policy-driven execution and guidance    | `gv.ps1 status` |
| **Orchestrator Skills**         | Project coordination system             | Auto-loaded     |

### Manual Activation Commands

```TypeScript
# Check and activate all tools
.\scripts\utilities\gv.ps1 health

# Create the session brief for today
.\scripts\utilities\gv.ps1 start-session

# Create session brief with specific task
.\scripts\utilities\gv.ps1 start-session api-hardening

# Close session with validation + closure artifact
.\scripts\utilities\gv.ps1 end-session
.\scripts\utilities\gv.ps1 end-session api-hardening

# Force auto-start missing tools
.\scripts\utilities\gv.ps1 health -Force

# Auto-init environment (any directory)
.\scripts\utilities\auto-init-dev-environment.ps1
```

## 📋 Workflow

### 0. Workspace Hygiene Checklist

Before starting work, ensure your workspace is clean:

### 1. Session Start

**Step 1: Bootstrap**

```TypeScript
# Run the standard bootstrap
.\scripts\utilities\gv.ps1 health
.\scripts\utilities\gv.ps1 start-session [task-name]
```

**Step 2: Auto-Detection**

The orchestrator automatically detects:

| Detection             | Action                                    |
| --------------------- | ----------------------------------------- |
| **Project type**      | Identifies stack (Node, Go, Python, etc.) |
| **Tech stack**        | Detects frameworks and libraries          |
| **Available skills**  | Loads relevant skills for the project     |
| **Git branch status** | Shows current branch and status           |

**Step 2.1: Context Efficiency Assist**

When health is degraded, the system helps you recover:

| Health Status       | Action                                                      |
| ------------------- | ----------------------------------------------------------- |
| **WARN/YELLOW**     | CLI shows live guidance                                     |
| **RED**             | Orchestrator auto-runs `compact-start` before session brief |
| **Manual fallback** | `.\scripts\utilities\gv.ps1 compact-start "<objective>"`    |

**Step 3: Memory Check**

```TypeScript
# Check previous context
mem_context

# Shows recent work and decisións
```

**Step 4: Review Generated Artifacts**

Check these files were created:

**Step 5: Status Presentation**

The system will show:

### 2. During Work

Follow these steps for each task:

```markdown
1. ✅ Execute with loaded skills (follow skill instructions)
2. ✅ Update todo list (mark completed items)
3. ✅ Verify each step (test as you go)
4. ✅ Run tests locally (before committing)
```

**Tips:**

### 3. Before Push/PR

**Pre-Push Checklist:**

```markdown
1. ✅ Run: gv.ps1 review # Code review
2. ✅ Generate: Audit document # gv.ps1 audit
3. ✅ Check: Specification complete?
4. ✅ Optional: gv.ps1 push # Guided commit/push
5. ❓ Ask: Create PR?
```

### 4. Code Review (7 Dimensions)

The Native Review Engine checks these dimensions:

| #   | Dimension         | Severity      | Auto-Check |
| --- | ----------------- | ------------- | ---------- |
| 1   | **Security**      | CRITICAL/HIGH | ✅ Yes     |
| 2   | **Quality**       | HIGH/MEDIUM   | ✅ Yes     |
| 3   | **Architecture**  | MEDIUM        | ❌ No      |
| 4   | **Testing**       | MEDIUM        | ❌ No      |
| 5   | **Documentation** | LOW           | ❌ No      |
| 6   | **API Design**    | MEDIUM        | ❌ No      |
| 7   | **Git Workflow**  | LOW           | ❌ No      |

### 5. Review Findings decisión

How to handle findings based on severity:

| Severity     | Icon  | Action                     | Blocking |
| ------------ | ----- | -------------------------- | -------- |
| **CRITICAL** | `[X]` | Block immediately, fix now | ✅ Yes   |
| **HIGH**     | `[!]` | Must fix before PR         | ✅ Yes   |
| **MEDIUM**   | `[-]` | Your choice (fix/review)   | ❌ No    |
| **LOW**      | `[*]` | Optional fixes             | ❌ No    |

**decisión Flow:**

```
CRITICAL/HIGH found:
  → Must fix before proceeding
  → PR will be blocked

MEDIUM found:
  → Option A: Fix now (recommended)
  → Option B: Fix after PR
  → Option C: Document as tech debt

LOW found:
  → Optional fixes
  → Can proceed with PR
```

## 📚 Commands Reference

### Orchestrator Commands (Natural Language)

Use these in conversation with the AI agent:

| Command     | Description                | Example                          |
| ----------- | -------------------------- | -------------------------------- |
| `Continuar` | Resume work, check context | "Continuar with the auth module" |
| `Estado`    | Show project status        | "Estado of the API project"      |
| `Guardar`   | Commit & push changes      | "Guardar these changes"          |
| `Review`    | Run code review            | "Review my last commit"          |
| `PR`        | Create pull request        | "PR for the feature branch"      |

### CLI Commands (TypeScript)

**Session Management:**

```TypeScript
# Start a new session
.\scripts\utilities\gv.ps1 start-session
.\scripts\utilities\gv.ps1 start-session api-hardening

# End session with closure artifact
.\scripts\utilities\gv.ps1 end-session
.\scripts\utilities\gv.ps1 end-session api-hardening

# Create or refresh task brief
.\scripts\utilities\gv.ps1 task-brief <task-name>
```

**Review & Publishing:**

```TypeScript
# Code review
.\scripts\utilities\gv.ps1 review

# Generate audit document
.\scripts\utilities\gv.ps1 audit

# Create PR template
.\scripts\utilities\gv.ps1 pr

# Show current status
.\scripts\utilities\gv.ps1 status

# Prepare to push (guided)
.\scripts\utilities\gv.ps1 push
```

**Maintenance:**

```TypeScript
# Full update workflow
.\scripts\utilities\gv.ps1 update-all

# Preview cleanup/homologation actions
.\scripts\utilities\gv.ps1 homologate

# Apply cleanup/homologation actions
.\scripts\utilities\gv.ps1 homologate apply

# Health check + cleanup drift gate
.\scripts\utilities\gv.ps1 health -StrictCleanup
```

### Git Commands

**Basic Workflow:**

```bash
# Check what's changed
git status

# Stage changes
git add .
git add path/to/specific/file.ts

# Commit with conventional message
git commit -m "feat(auth): add JWT validation"

# Push to remote
git push
git push -u origin feature/my-feature
```

**Pull Requests:**

```bash
# Create PR using GitHub CLI
gh pr create --title "feat: add auth" --body "Implements JWT auth"

# List PRs
gh pr list

# Check PR status
gh pr status
```

## 🤖 Workflow Automation

### Automated gv.ps1 Workflow

Standard flow for validation and publishing:

```TypeScript
# Step 1: Check current status
.\scripts\utilities\gv.ps1 status

# Step 2: Run code review (auto-fix if available)
.\scripts\utilities\gv.ps1 review

# Step 3: Generate audit document
.\scripts\utilities\gv.ps1 audit

# Step 4: Create PR with template
.\scripts\utilities\gv.ps1 pr
```

**Pro Tip:** Use `gv.ps1 publish` to run all steps with governance gates automatically.

### Git Hooks (Automatic)

Git hooks run automatically during Git operations:

| Hook           | Trigger      | Actions                                                               | Can Override? |
| -------------- | ------------ | --------------------------------------------------------------------- | ------------- |
| **pre-commit** | `git commit` | Secrets scan, format check, project validation                        | ❌ No         |
| **pre-push**   | `git push`   | Native review + GitFlow policy + governance + homologation drift gate | ⚠️ With `-n`  |
| **commit-msg** | `git commit` | Commit message validation (conventional commits)                      | ❌ No         |

**Note:** Hook installation depends on local Git hook wiring. Canonical script paths are under
`scripts/git-hooks/`.

**Manual hook setup (if needed):**

```bash
# Copy hooks to .git/hooks
cp scripts/git-hooks/* .git/hooks/

# Make executable (Linux/macOS)
chmod +x .git/hooks/*
```

## ✅ Best Practices

### Before Any Commit

Run through this checklist:

**Quick Command:**

```TypeScript
# Run pre-commit checks
gv.ps1 review
git add .
git commit -m "feat(scope): description"
```

### Before Any PR

Ensure these are complete:

**Quick Command:**

```TypeScript
# Prepare for PR
gv.ps1 audit
gv.ps1 pr
gh pr create
```

### Before Push

Final checks:

**Quick Command:**

```TypeScript
# Safe push with checks
gv.ps1 push  # Shows guided commands
git push -u origin feature/my-feature
```

## Questions to Ask

### During Session

```
Did we meet the specification?
Did we forget anything?
Are the changes ready?
Does the task brief still match the real scope?
```

### Before PR

```
Code review findings?
  - CRITICAL/HIGH: Must fix
  - MEDIUM: Your choice
  - LOW: Optional

Create a PR or keep working?
```

## Resources
