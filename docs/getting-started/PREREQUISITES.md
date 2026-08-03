# Prerequisites - Gentle-Vanguard

**Date**: 2026-05-03  
**Description**: Complete list of required and optional tools for Gentle-Vanguard.

---

## Automatic Installation

```TypeScript
# Option 1: Install everything automatically
.\scripts\utilities\install-prerequisites.ps1

# Option 2: Check status only
.\scripts\utilities\install-prerequisites.ps1 -CheckOnly
```

---

## Required (Mandatory)

| Tool        | Min Version | Purpose            | Installation                       |
| ----------- | ----------- | ------------------ | ---------------------------------- |
| **Node.js** | 18+         | JavaScript runtime | [nodejs.org](https://nodejs.org)   |
| **npm**     | 9+          | Package manager    | Included with Node.js              |
| **Git**     | 2.30+       | Version control    | [git-scm.com](https://git-scm.com) |

---

## Recommended (Automatic Installation)

```TypeScript
# These install automatically with the command above
npm install -g lefthook
npm install -g prettier
npm install -g @commitlint/cli @commitlint/config-conventional
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

## Verification

```TypeScript
# Verify all tools
.\scripts\utilities\install-prerequisites.ps1 -CheckOnly

# Verify individually
node --version
npm --version
git --version
lefthook --version
prettier --version
trufflehog --version
```

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
