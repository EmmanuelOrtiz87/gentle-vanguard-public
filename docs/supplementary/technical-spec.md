# Technical Document: Gentle-Vanguard Architecture

## Directory Structure

- `/scripts`: Automation engines in TypeScript Core (platform-agnostic).
- `/tools`: Core tool repositories (Engram, Workspace-Skills).
- `/config`: Centralized JSON configuration with dynamic variable resolution support.
- `/.engram-data`: Context persistence for language models (isolated from source code).

## Critical Components

### 1. Bootstrap Orchestrator (`bootstrap.ps1`)

Uses dependency verification logic (Git, Go, Engram). If a tool is missing, the script handles its
deployment, ensuring a deterministic environment.

### 2. Validation Protocol (`validate-project.ps1`)

Implements a validation hierarchy:

1. **Security:** Invokes native pre-commit and review controls.
2. **AI Integrity:** Verifies Workspace-Skills loading.
3. **Documentation:** Triggers `generate-session-review.ps1`.

### 3. Session Persistence and AI Memory

The system generates Markdown files in `docs/code-reviews/`. These files are not just for humans;
they serve as "long-term memory" so Gemini/Claude understand project evolution in future sessions.

### 4. Agnostic Configuration Model

The `workspace.config.json` file uses _placeholders_ (e.g., `{workspaceRoot}`) that are resolved at
runtime, allowing the project to move between different disk paths or servers without breaking.

## Publishing Flow (Finalize)

The `finalize-session.ps1` script ensures atomic publishing:

```TypeScript
Validation -> Tagging -> Commit -> Push (Auto-Upstream) -> Pull Request (gh)
```

This creates an immaculate Git history ready for Tag-based deployments.

## System Requirements

- TypeScript Core 7+
- Git 2.30+
- Go 1.20+ (for backend tools)
