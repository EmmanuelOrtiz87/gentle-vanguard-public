# 🚀 Getting Started

<p align="center">
  <b>Gentle-Vanguard v3.8.2 — Quick Start Guide</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Version-3.8.2-00BFFF?style=flat-square&labelColor=0D1117" alt="Version">
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

| Step   | Action                                          | Command                    |
| ------ | ----------------------------------------------- | -------------------------- |
| **1️⃣** | Check [PREREQUISITES.md](PREREQUISITES.md)      | Review system requirements |
| **2️⃣** | Follow [DEVELOPER-SETUP.md](DEVELOPER-SETUP.md) | Complete setup steps       |
| **3️⃣** | Run complete setup                              | `npm run setup:complete`   |

> 💡 **TIP:** Start here for a smooth onboarding experience.

---

## 📋 Prerequisites

| Requirement                          | Version | Status      | Notes                      |
| ------------------------------------ | ------- | ----------- | -------------------------- |
| **🪟 Windows 10/11 / Linux / macOS** | Any     | ✅ Required | Cross-platform support     |
| **🟢 Node.js**                       | 20+     | ✅ Required | Runtime for all TS scripts |
| **📦 pnpm**                          | 11+     | ✅ Required | Package manager            |
| **🌿 Git**                           | 2.30+   | ✅ Required | Version control system     |
| **🐹 Go**                            | 1.19+   | ⚠️ Optional | For compiled components    |

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
npm run watchtower:health           # Health check (95 checks)

# Dashboard
npm run dashboard:start             # Start dashboard
npm run dashboard:stop              # Stop dashboard
```

### Dashboard authentication (local-first)

The dashboard API is fail-closed: every endpoint except `GET /api/health` and `/api/auth/*` requires
a session, and login is only possible when a shared token is configured. Two supported local
profiles:

```bash
# Option A — token login (recommended): set once in your User env, then log in
# via the dashboard login screen (POST /api/auth/login with the token value).
setx GV_DASHBOARD_TOKEN "choose-a-long-random-secret"

# Option B — loopback bypass (dev only): no login prompt on localhost.
setx GV_DASHBOARD_DEV_AUTH 1
```

Without either variable the dashboard server starts but the API returns `401` for everything except
the public health probe. See [Dashboard Admin Status](../security/DASHBOARD-ADMIN-STATUS.md) for
sessions, RBAC roles, and the `/admin` panel.

```TypeScript
# Knowledge Base
npx tsx src/knowledge-base-sync.ts --stats      # Show stats
npx tsx src/knowledge-base-sync.ts --mode full # Full sync

# Graphify (code navigation)
npm run graphify -- query "search term"

# Token budget
npx tsx src/tokens/token-budget-guard.ts -Mode status
```

---

## 🎯 Next Steps

1. **[Read the Architecture Overview](../architecture/README.md)** — Understand the 5-layer topology
2. **[Explore Available Skills](../reference/SKILL-ORGANIZATION.md)** — 263 specialized skills
3. **[Configure AI Agent](../guides/COMPATIBILITY-MATRIX.md)** — OpenCode, Claude, Cursor, etc.

---

<p align="center">
  <b>🚀 Ready to start?</b><br>
  <code>git clone https://github.com/EmmanuelOrtiz87/gentle-vanguard.git</code>
</p>
