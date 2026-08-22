# Prerequisites - Gentle-Vanguard

**Date**: 2026-08-20  
**Description**: Required tools and deterministic post-install verification for Gentle-Vanguard.

---

## Important distinction

The current `.exe` is a launcher/bootstrap artifact, not yet a fully self-contained offline
installer. It does not silently install external runtimes or embed credentials. Use the installer
doctor after setup and review every external download.

## Verification

```bash
npm run install:doctor -- --strict
npm run db:init
npm run watchtower:health
```

---

## Required (Mandatory)

| Tool        | Min Version | Purpose             | Installation                        |
| ----------- | ----------- | ------------------- | ----------------------------------- |
| **Node.js** | 20+         | JavaScript runtime  | [nodejs.org](https://nodejs.org)    |
| **npm**     | Included    | Package manager     | Included with Node.js               |
| **pnpm**    | 11+         | Locked dependencies | `corepack enable` / `npm i -g pnpm` |
| **Git**     | 2.30+       | Version control     | [git-scm.com](https://git-scm.com)  |

---

## Recommended (project-local tooling)

```TypeScript
# These are installed from package.json by pnpm install
pnpm install --frozen-lockfile
```

| Tool           | Purpose              | Installation                     |
| -------------- | -------------------- | -------------------------------- |
| **lefthook**   | Git hooks management | `npm install -g lefthook`        |
| **prettier**   | Code formatting      | `npm install -g prettier`        |
| **commitlint** | Commit validation    | `npm install -g @commitlint/cli` |

---

## Optional

### Security

| Tool           | Purpose           | Installation                                                                                                              |
| -------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **trufflehog** | Secrets detection | `choco install trufflehog` (Win) / `go install github.com/trufflesecurity/trufflehog/cmd/trufflehog@latest` (Linux/macOS) |

### Python (for Python scripts)

```TypeScript
# Install Python
choco install python

# Install pip tools
pip install safety bandit
```

| Tool       | Purpose                           |
| ---------- | --------------------------------- |
| **safety** | Dependency vulnerability scanning |
| **bandit** | Python security analysis          |

---

## Installation Checklist

### 1. Required

- [ ] Node.js (18+)
- [ ] npm (9+)
- [ ] Git (2.30+)

### 2. Recommended

- [ ] lefthook
- [ ] prettier
- [ ] commitlint

### 3. Optional

- [ ] trufflehog
- [ ] Python (for Python scripts)
- [ ] TypeScript Core (pwsh)

---

## Important Notes

1. **trufflehog** is not available via npm - install via Chocolatey or Go
2. Some tools require administrator permissions
3. On Windows, run TypeScript as administrator if you encounter issues

---

## Troubleshooting

### Error: "command not found"

Add to PATH:

```TypeScript
# For npm global
$env:PATH += ";$env:APPDATA\npm"
```

### Error: "choco not found"

Install Chocolatey:

```TypeScript
# Run as administrator
Set-ExecutionPolicy Bypass -Scope Process -Force
iex ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))
```

---

_Document updated: 2026-05-03_
