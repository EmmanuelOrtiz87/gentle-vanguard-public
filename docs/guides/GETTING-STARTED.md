# Getting Started

**Last Updated**: 2026-04-26

---

## Prerequisites

- TypeScript 7.x or Windows TypeScript 5.1+
- Git installed and configured
- Access to workspace projects

---

## Quick Setup

### 1. Clone Repository

```TypeScript
git clone <repository-url>
cd gentle-vanguard
```

### 2. Initialize Session

```TypeScript
.\tools\session-autostart.cmd
```

### 3. Verify Tools

```TypeScript
.\scripts\gentle-vanguard\gv.ps1 doctor
```

---

## Daily Workflow

### Start Session

```TypeScript
.\tools\session-autostart.cmd
```

### Work on Tasks

1. Make changes in feature branch
2. Commit with clear messages
3. Push for validation

### End Session

```TypeScript
.\tools\session-autostart.cmd
```

---

## GitFlow Basics

### Branch Types

| Type       | Purpose          | Base    |
| ---------- | ---------------- | ------- |
| feature/\* | New features     | develop |
| bugfix/\*  | Bug fixes        | develop |
| hotfix/\*  | Production fixes | main    |
| release/\* | Release prep     | main    |

### Creating Branch

```TypeScript
.\scripts\utilities\create-gitflow-branch.ps1
```

---

## Common Commands

| Command       | Purpose         |
| ------------- | --------------- |
| gv.ps1 doctor | Diagnose issues |
| gv.ps1 audit  | Run audit       |
| gv.ps1 tools  | Manage tools    |

---

## Next Steps

- Review [SESSION-GUIDE.md](SESSION-GUIDE.md)
- Review [GITFLOW-QUICK-REFERENCE.md](GITFLOW-QUICK-REFERENCE.md)
