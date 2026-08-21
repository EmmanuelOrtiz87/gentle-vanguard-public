# 🚀 Getting Started

<p align="center">
  <b>Gentle-Vanguard v3.5.0 — Quick Start Guide</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-3.5.0-00BFFF?style=flat-square&labelColor=0D1117" alt="Version">
  <img src="https://img.shields.io/badge/Health-100%25-22C55E?style=flat-square&labelColor=0D1117" alt="Health">
  <img src="https://img.shields.io/badge/Status-Optimized-22C55E?style=flat-square&labelColor=0D1117" alt="Status">
</p>

---

## 📚 Documents

| Document                                     | Description                                     |
| -------------------------------------------- | ----------------------------------------------- |
| **[PREREQUISITES.md](PREREQUISITES.md)**     | System requirements (git, TypeScript, AI agent) |
| **[DEVELOPER-SETUP.md](DEVELOPER-SETUP.md)** | Step-by-step developer setup                    |
| **[installation.md](installation.md)**       | Detailed installation guide                     |

---

## 🚀 Quick Start

| Step   | Action                                          | Command                                           |
| ------ | ----------------------------------------------- | ------------------------------------------------- |
| **1️⃣** | Check [PREREQUISITES.md](PREREQUISITES.md)      | Review system requirements                        |
| **2️⃣** | Follow [DEVELOPER-SETUP.md](DEVELOPER-SETUP.md) | Complete setup steps                              |
| **3️⃣** | Run bootstrap                                   | `.\scripts\gentle-vanguard\bootstrap-machine.ps1` |

> 💡 **TIP:** Start here for a smooth onboarding experience.

---

## 📋 Prerequisites

| Requirement                          | Version | Status      | Notes                                 |
| ------------------------------------ | ------- | ----------- | ------------------------------------- |
| **🪟 Windows 10/11 / Linux / macOS** | Any     | ✅ Required | Cross-platform support                |
| **⚡ TypeScript 7+**                 | 7.0+    | ✅ Required | `winget install Microsoft.TypeScript` |
| **🌿 Git**                           | 2.30+   | ✅ Required | Version control system                |
| **🟢 Node.js**                       | 18+     | ⚠️ Optional | For some tools                        |
| **🐹 Go**                            | 1.19+   | ⚠️ Optional | For compiled components               |

---

## 🛠️ Setup — 3 Steps

### Step 1: Clone the Repository

```TypeScript
git clone https://github.com/EmmanuelOrtiz87/gentle-vanguard.git
cd gentle-vanguard
```

### Step 2: Start Session

```TypeScript
npx tsx src/session-autostart.ts
```

This will:

- ✅ Initialize session tracking
- ✅ Start dashboard WebSocket server
- ✅ Run health checks
- ✅ Sync Knowledge Base

### Step 3: Start Working

```TypeScript
# Health check
npm run watchtower:health

# Dashboard
npm run dashboard:start
```

---

## 📖 Daily Usage Commands

```TypeScript
# Session management
npx tsx src/session-autostart.ts    # Start session
npm run watchtower:health           # Health check (82 checks)

# Dashboard
npm run dashboard:start             # Start dashboard
npm run dashboard:stop              # Stop dashboard

# Knowledge Base
npx tsx src/knowledge-base-sync.ts --stats      # Show stats
npx tsx src/knowledge-base-sync.ts --mode full # Full sync

# Graphify (code navigation)
npm run graphify -- query "search term"

# Token budget
npx tsx src/token-budget-guard.ts -Mode status
```

---

## 🎯 Next Steps

1. **[Read the Architecture Overview](../architecture/README.md)** — Understand the 5-layer topology
2. **[Explore Available Skills](../reference/SKILL-ORGANIZATION.md)** — 127 specialized skills
3. **[Set Up Your First Project](../guides/GETTING-STARTED.md)** — Use scaffolding tools
4. **[Configure AI Agent](../guides/COMPATIBILITY-MATRIX.md)** — OpenCode, Claude, Cursor, etc.

---

<p align="center">
  <b>🚀 Ready to start?</b><br>
  <code>git clone https://github.com/EmmanuelOrtiz87/gentle-vanguard.git</code>
</p>
