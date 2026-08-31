# Gentle-Vanguard Installation

Complete guide to set up Gentle-Vanguard on a new machine.

## Prerequisites

### Required

- **Git** - https://git-scm.com/
- **Node.js 20+** - https://nodejs.org/
- **pnpm 11+** - `corepack enable` or `npm install --global pnpm`

### Recommended

- **Go 1.21+** - For Engram and Go-based tools
- **PowerShell 7+** - For Windows automation
- **Docker** - For containerized development

## Quick Install

### Windows (TypeScript)

```TypeScript
# Clone or download gentle-vanguard
git clone https://github.com/EmmanuelOrtiz87/gentle-vanguard.git
cd gentle-vanguard

# Install locked dependencies
corepack enable
pnpm install --frozen-lockfile

# Verify the machine and workspace
npm run install:doctor -- --strict
npm run db:init
npm run watchtower:health

# Start a session
npx tsx src/session/session-autostart.ts
```

### Linux/macOS

```bash
# Clone or download gentle-vanguard
git clone https://github.com/EmmanuelOrtiz87/gentle-vanguard.git
cd gentle-vanguard

# Install locked dependencies
corepack enable
pnpm install --frozen-lockfile

# Verify the machine and workspace
npm run install:doctor -- --strict

# Start a session
npx tsx src/session/session-autostart.ts
```

## Detailed Setup

### 1. Git Configuration

```bash
git config --global user.name "Your Name"
git config --global user.email "your@email.com"
git config --global init.defaultBranch main
git config --global pull.rebase true
```

### 2. Install Tools

```TypeScript
# Validate required and optional tools without downloading anything
npm run install:doctor -- --json
```

### 3. Install AI Tools (Optional but Recommended)

The gentle-vanguard includes integration with:

| Tool                     | Purpose                  | Install                                                          |
| ------------------------ | ------------------------ | ---------------------------------------------------------------- |
| **OpenCode**             | AI coding agent          | https://opencode.ai                                              |
| **Claude Code**          | AI coding agent          | https://claude.ai/code                                           |
| **Native Review Engine** | Built-in workflow review | `./src/cli/gv.ts review`                                         |
| **engram**               | Persistent memory        | `go install github.com/gentle-vanguard/engram/cmd/engram@latest` |

Windows one-shot update (no brew required): `./src/cli/gv.ts update-tools`

### 4. Install Skills

Skills are automatically installed for detected AI agents. To manually install:

```TypeScript
# For Claude Code
cp -r scripts/utilities/Workspace-Skills/curated/* ~/.claude/skills/

# For OpenCode
cp -r scripts/utilities/Workspace-Skills/curated/* ~/.config/opencode/skills/
```

## Project Creation

### Interactive Mode (Recommended for beginners)

```TypeScript
.\scripts\gentle-vanguard\src/cli/gv.ts new --interactive
```

The wizard will ask:

- Project name
- Project type (service, cli, library, frontend, fullstack, microservices)
- Architecture pattern
- AI model configuration
- Source (new or clone)

### Command Line Mode

```TypeScript
# Basic service
.\scripts\gentle-vanguard\src/cli/gv.ts new --name my-api --kind service

# With options
.\scripts\gentle-vanguard\src/cli/gv.ts new `
    --name my-project `
    --kind frontend `
    --framework react `
    --architecture clean `
    --ai-mode cloud `
    --ai-provider openai `
    --ai-model gpt-4
```

## Available Options

| Option           | Description          | Values                                                    |
| ---------------- | -------------------- | --------------------------------------------------------- |
| `--name`         | Project name         | String                                                    |
| `--kind`         | Project type         | service, cli, library, frontend, fullstack, microservices |
| `--framework`    | Frontend framework   | react, vue, angular, nextjs                               |
| `--architecture` | Architecture pattern | layered, clean, modular, microservices                    |
| `--preset`       | Project preset       | default                                                   |
| `--ai-mode`      | AI assistance mode   | none, local, cloud                                        |
| `--ai-provider`  | AI provider          | openai, anthropic, gemini, ollama                         |
| `--ai-model`     | Model name           | gpt-4, claude-3-opus, etc.                                |
| `--clone`        | Clone from URL       | Git repository URL                                        |
| `--output`       | Output path          | Directory path                                            |

## Post-Installation

### Validate Your Setup

```TypeScript
.\scripts\gentle-vanguard\src/cli/gv.ts validate
```

### Create a Project

```TypeScript
# Interactive
.\scripts\gentle-vanguard\src/cli/gv.ts new --interactive

# Or specify all options
.\scripts\gentle-vanguard\src/cli/gv.ts new --name my-service --kind service
```

### Run Tests

```TypeScript
# In your project directory
npm test  # Node.js
go test ./...  # Go
```

## Troubleshooting

### "pwsh not found"

Install PowerShell 7+ from https://learn.microsoft.com/powershell/

### "Git not found"

Install Git from https://git-scm.com/

### Permission errors (Linux/macOS)

```bash
chmod +x ./scripts/*.ps1
chmod +x ./scripts/*.sh
```

### Module not found

```TypeScript
# Windows
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Linux/macOS
pwsh -Command "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser"
```
