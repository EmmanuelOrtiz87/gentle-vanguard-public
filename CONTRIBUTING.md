# 🤝 Contributing to Gentle-Vanguard

<p align="center">
  <b>Thank you for your interest in contributing!</b>
</p>

---

## 📏 Code of Conduct

By participating, you agree to maintain a **respectful and inclusive environment** for everyone.

---

## 🚀 How to Contribute

### 1️⃣ Fork and Clone

```bash
# Fork the repository on GitHub

# Clone your fork
git clone https://github.com/YOUR_USERNAME/gentle-vanguard-public.git
cd gentle-vanguard-public

# Add upstream remote
git remote add upstream https://github.com/EmmanuelOrtiz87/gentle-vanguard-public.git
```

### 2️⃣ Create a Branch

```bash
# Sync with upstream
git fetch upstream
git checkout main
git pull upstream main

# Create your branch
git checkout -b feat/your-feature-name
# Or: git checkout -b fix/issue-number
```

### 3️⃣ Development

```bash
# Install dependencies
npm install

# Validate your changes
npm test

# Check workflow health
.\scripts\utilities\WORKFLOW-ORCHESTRATION\gentle-vanguard.ps1 health
```

### 4️⃣ Make Changes

#### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

Types:
- feat: New feature
- fix: Bug fix
- docs: Documentation changes
- style: Code style/formatting
- refactor: Code refactoring
- test: Adding or updating tests
- chore: Maintenance tasks
```

#### Code Quality

```bash
# Lint checks
npm run lint:json       # JSON validation
npm run lint:workflows  # Workflow YAML validation
npm run format:check    # Prettier formatting check
```

#### Documentation Standards

All official documentation MUST follow the project's documentation standards.

**Requirements:**

- ✅ Use shields.io badges (version, status, license, runtime)
- ✅ Use strategic emojis in headers, list items, callouts
- ✅ Use tables for structured data with emojis
- ✅ Use blockquote callouts: 🚨 WARNING, 💡 TIP, ✅ SUCCESS, ℹ️ INFO
- ✅ Write in friendly, conversational tone with Spanish accents

### 5️⃣ Test Your Changes

```bash
# Run all tests
npm test

# Or directly
.\scripts\run-tests-simple.ps1

# Full validation
.\scripts\utilities\WORKFLOW-ORCHESTRATION\gentle-vanguard.ps1 verify
```

### 6️⃣ Submit PR

```bash
# Push to your fork
git push origin feat/your-feature-name

# Create Pull Request on GitHub
# - Use conventional commit title
# - Reference any related issues
# - Include screenshots/demos if UI changes
# - Ensure CI checks pass
```

---

## 📋 Development Setup

### Prerequisites

| Requirement                          | Version | Status                   |
| ------------------------------------ | ------- | ------------------------ |
| **🪟 Windows 10/11 / Linux / macOS** | Any     | ✅ Required              |
| **🟢 Node.js**                       | 20+     | ✅ Required              |
| **📦 pnpm**                          | 11+     | ✅ Required              |
| **🌿 Git**                           | 2.30+   | ✅ Required              |
| **🐹 Go**                            | 1.19+   | ⚠️ Optional (for Engram) |

### Quick Start

```TypeScript
# Bootstrap your machine
.\scripts\utilities\install-prerequisites.ps1

# Start working
.\scripts\utilities\WORKFLOW-ORCHESTRATION\gentle-vanguard.ps1 start-session
```

---

## 🚧 Testing

### Test Structure

| Type                  | Location             | Count                    |
| --------------------- | -------------------- | ------------------------ |
| **Unit Tests**        | `tests/unit/`        | 22 tests                 |
| **Integration Tests** | `tests/integration/` | 3 tests                  |
| **Security Tests**    | `tests/security/`    | 2 tests                  |
| **Performance Tests** | `tests/perf/`        | 1 test                   |
| **Total**             |                      | **28 tests — 100% PASS** |

### Running Tests

```bash
# All tests
npm test

# Specific test file
.\tests\unit\config-validaton.tests.ps1

# With timing
Measure-Command { .\scripts\run-tests-simple.ps1 }
```

---

## 📚 Related Documentation

| Document                                             | Purpose                     |
| ---------------------------------------------------- | --------------------------- |
| [Session Guide](docs/guides/SESSION-GUIDE.md)        | Daily workflow and commands |
| [Architecture Overview](docs/architecture/README.md) | System design rationale     |
| [Release Process](docs/guides/RELEASE-PROCESS.md)    | How releases work           |
| [Branch Strategy](docs/guides/BRANCH-STRATEGY.md)    | Git flow conventions        |
| [Testing Strategy](docs/guides/TESTING-STRATEGY.md)  | Test pyramid and patterns   |

---

## 🚨 Critical Rules

> **🚨 WARNING:** Hooks run automatically before every commit.

| Mechanism               | Description                 | Status    |
| ----------------------- | --------------------------- | --------- |
| **Automated Hooks**     | pre-commit, pre-push        | ✅ Active |
| **CI/CD**               | 14 GitHub Actions workflows | ✅ Active |
| **Secret Detection**    | TruffleHog on pre-push      | ✅ Active |
| **Dependency Scanning** | Trivy + Dependabot          | ✅ Active |
| **Testing**             | 28 tests, 100% PASS         | ✅ Active |

---

## 🎯 Project Goals

- ✅ **AI-First Workspace**: Specialized AI agent skills for common development tasks
- ✅ **Local-First**: All processing happens locally, no external dependencies
- ✅ **Zero Token Overhead**: Audit and validation with zero AI token usage
- ✅ **Enterprise Security**: Lefthook + Trufflehog + Trivy integration
- ✅ **Plugin Architecture**: Extensible system for custom workflows

---

<p align="center">
  <b>🤝 Ready to contribute?</b><br>
  <code>git clone https://github.com/EmmanuelOrtiz87/gentle-vanguard-public.git</code>
</p>
