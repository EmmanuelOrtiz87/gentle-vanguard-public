# AI Configuration Guide

Complete guide to configure AI tools for Gentle-Vanguard - both cloud and local.

## Overview

```

                     AI CONFIGURATION OPTIONS


OPTION A: CLOUD (Recommended)              OPTION B: LOCAL


[OK] Quick setup                            [OK] 100% offline
[OK] No GPU required                        [OK] No API costs
[OK] Best models (Claude Opus)              [OK] Privacy focused
[OK] Just need API key                      [OK] Ollama or LM Studio

Both can run simultaneously for failover!
```

## Response Profile Compression (Token Efficiency)

The stack supports configurable communication controls to reduce output/context tokens while keeping
consistent style.

Three independent axes are used:

1. Language: `es | pt-BR | en`
2. Detail level: `simple | executive | expanded`
3. Compression profile: `lite | lleno | ultra`

Profiles available in `config/orchestrator.json`:

- `lite`
- `lleno`
- `ultra`

Operational commands:

```TypeScript
# Show active communication settings
.\scripts\utilities\src/cli/gv.ts response-mode

# List all options
.\scripts\utilities\src/cli/gv.ts response-mode list

# Set compression profile
.\scripts\utilities\src/cli/gv.ts response-mode profile:ultra

# Set language
.\scripts\utilities\src/cli/gv.ts response-mode language:pt-BR

# Set detail level
.\scripts\utilities\src/cli/gv.ts response-mode detail:expanded
```

Recommendation:

1. Use `es + executive + lite` as baseline for this workspace.
2. Use `ultra` for short implementation loops and rapid triage.
3. Use `expanded` when explicit deep detail is requested.

### Presets by Task Type

The orchestrator can apply consistent settings using communication presets:

1. `bugfix` -> `es + executive + ultra`
2. `refactor` -> `es + executive + lleno`
3. `docs` -> `es + expanded + lite`
4. `audit-review` -> `es + expanded + lleno`
5. `executive-demo` -> `es + executive + lite`

Commands:

```TypeScript
# Apply preset directly
.\scripts\utilities\src/cli/gv.ts response-mode preset:bugfix

# Ask for recommendation from preset + risk
.\scripts\utilities\src/cli/gv.ts response-mode recommend:docs:high
```

Orchestrator integration:

1. Run `./scripts/utilities/orchestrator-next-steps.ps1`.
2. Review recommended preset and risk.
3. Apply suggested mode before implementation.

### Auto-Apply on Session Start

`start-session` can auto-apply communication mode using preset + risk heuristics.

Config keys in `config/orchestrator.json`:

1. `communication_presets.auto_apply_on_session_start` (`true|false`)
2. `communication_presets.auto_apply_default_risk` (`low|medium|high`)
3. `communication_presets.default` (fallback preset)

Default behavior:

1. Branch `hotfix/*` or `release/*` -> risk escalates to `high`.
2. Task name keywords infer preset (`docs`, `audit-review`, `refactor`, `executive-demo`, fallback
   `bugfix`).
3. Recommended mode is applied automatically before session brief generation.

Disable auto-apply:

```json
"communication_presets": {
     "auto_apply_on_session_start": false
}
```

## Option A: Cloud Configuration (Recommended)

### Providers Supported

| Provider      | Models                  | Cost            | Best For           |
| ------------- | ----------------------- | --------------- | ------------------ |
| **Anthropic** | Claude 3.5 Sonnet, Opus | $15-20/mes      | General coding     |
| **OpenAI**    | GPT-4o, GPT-4 Turbo     | $15-20/mes      | Fast responses     |
| **Google**    | Gemini 1.5, 2.0         | Free tier + pay | Budget-conscious   |
| **GitHub**    | Copilot models          | $10/mes         | GitHub integration |

### Step 1: Get API Keys

#### Anthropic (Claude) - Recommended

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign up / Log in
3. Navigate to API Keys
4. Create new API key
5. Copy and save securely

```
API Key format: sk-ant-xxxxx-xxxxx
```

#### OpenAI (GPT-4)

1. Go to [platform.openai.com](https://platform.openai.com)
2. Sign up / Log in
3. Go to API Keys
4. Create new secret key
5. Add credits to account

```
API Key format: sk-xxxxx-xxxxx
```

#### Google (Gemini) - Free Tier Available

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Sign in with Google account
3. Get API key from AI Studio
4. Free tier: 1M tokens/month

```
API Key format: AIzaSyxxxxx
```

### Step 2: Configure Environment

Create `.env` file in your project root:

```TypeScript
# Required for Anthropic (Claude)
ANTHROPIC_API_KEY=sk-ant-xxxxx-xxxxx

# Required for OpenAI (GPT-4)
OPENAI_API_KEY=sk-xxxxx-xxxxx

# Required for Google (Gemini)
GOOGLE_API_KEY=AIzaSyxxxxx

# Optional: Set default provider
DEFAULT_AI_PROVIDER=anthropic
```

### Step 3: Verify Configuration

```TypeScript
# Test Anthropic (Claude)
claude "Hello, respond with 'Working!'"

# Test OpenAI (GPT-4)
opencode --model gpt-4o "Hello"

# Test Google (Gemini)
opencode --model gemini-1.5-pro "Hello"
```

### Recommended Cloud Configuration

```TypeScript
# .env file - Recommended setup

# Primary provider
ANTHROPIC_API_KEY=sk-ant-xxxxx

# Fallback provider
OPENAI_API_KEY=sk-xxxxx

# Default model selection
DEFAULT_AI_PROVIDER=anthropic
DEFAULT_MODEL=claude-sonnet-4-20250514

# For complex tasks
COMPLEX_TASK_MODEL=claude-opus-4-20250514

# Cost management
MAX_DAILY_SPEND_USD=10
```

---

## Option B: Local Configuration (Ollama)

### Why Local?

```
ADVANTAGES                          DISADVANTAGES

[OK] 100% offline                       Need decent GPU (8GB+ VRAM)
[OK] No API costs                       Slower than cloud models
[OK] Complete privacy                   Weaker reasoning
[OK] No internet required               Setup time
```

### Ollama Installation

#### Windows

```TypeScript
# Download from ollama.ai
# Or use winget:
winget install Ollama.Ollama

# Verify installation
ollama --versión
```

#### Linux/macOS

```bash
curl -fsSL https://ollama.ai/install.sh | sh

# Verify installation
ollama --versión
```

### Download Models

```TypeScript
# Recommended models for coding:

# CodeLlama (good general coding)
ollama pull codellama:7b
ollama pull codellama:13b  # Better quality, needs more RAM

# Llama 3 (latest, good performance)
ollama pull llama3
ollama pull llama3:70b  # Best quality

# Mistral (fast, good for simple tasks)
ollama pull mistral

# Phi-3 (Microsoft, lightweight)
ollama pull phi3

# For best results: CodeLlama 13B or Llama 3 70B
ollama pull codellama:13b
```

### Verify Ollama is Running

```TypeScript
# Start Ollama service (usually auto-starts)
ollama serve

# Test in another terminal
ollama list  # Shows installed models
```

### Configure Gentle-Vanguard for Ollama

```TypeScript
# Set Ollama as provider
ollama config set provider ollama

# Or configure via environment
OLLAMA_BASE_URL=http://localhost:11434
DEFAULT_MODEL=codellama:13b
```

---

## Option C: Hybrid Configuration (Recommended for Power Users)

Use cloud as primary, local as fallback:

```TypeScript
# .env file - Hybrid setup

# Cloud providers
ANTHROPIC_API_KEY=sk-ant-xxxxx
OPENAI_API_KEY=sk-xxxxx

# Local provider
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=codellama:13b

# Priority order (Gentle-Vanguard uses first available)
AI_PROVIDER_PRIORITY=anthropic,openai,ollama

# Fallback settings
USE_LOCAL_WHEN_CLOUD_UNAVAILABLE=true
```

### Automatic Failover

Gentle-Vanguard automatically detects availability:

```

                    CONNECTION CHECK


1. Try Cloud (Anthropic)     Available?  Use Claude


                               Not Available


2. Try Fallback (OpenAI)       Available?  Use GPT-4


                               Not Available


3. Try Local (Ollama)         Available?  Use Local


                               Not Available


                           Show Error / Queue Request
```

---

## Advanced Configuration

### Model Selection by Task

```TypeScript
# .env - Task-based routing

# Simple tasks (fast, cheap)
SIMPLE_TASK_MODEL=claude-haiku-3

# Standard tasks
DEFAULT_MODEL=claude-sonnet-4

# Complex tasks (slow, expensive)
COMPLEX_TASK_MODEL=claude-opus-4

# Code review
REVIEW_MODEL=claude-sonnet-4

# Test generation
TEST_MODEL=gpt-4o

# Refactoring
REFACTOR_MODEL=claude-opus-4
```

### Cost Management

```TypeScript
# Set spending limits
MAX_DAILY_SPEND_USD=10
MAX_MONTHLY_SPEND_USD=100
BUDGET_ALERT_THRESHOLD=0.8  # Alert at 80% of budget

# Monitoring
SHOW_TOKEN_USAGE=true
LOG_API_CALLS=true
```

### Performance Tuning

```TypeScript
# Response speed vs quality
PREFER_FAST_RESPONSES=true  # Use smaller models for speed
CACHE_PROMPTS=true         # Cache similar prompts
STREAM_RESPONSES=true      # Show response as it generates

# Context optimization
MAX_CONTEXT_TOKENS=150000   # Stay under limit
TRUNCATE_OLD_CONTEXT=true  # Remove old messages when full
```

### Security Settings

```TypeScript
# Don't send to AI
BLOCKED_PATTERNS=password,api_key,secret,token,credential
SECRET_SCAN_BEFORE_PROMPT=true

# Data retention
NO_STORAGE_ON_SERVERS=true
CONVERSATION_RETENTION_DAYS=0  # Don't save on provider servers
```

---

## Troubleshooting

### "API key not valid"

```TypeScript
# Verify key is correct
echo $ANTHROPIC_API_KEY

# Check for extra spaces
# Should be: sk-ant-xxxxx
# Not: sk-ant- xxxxx
```

### "Rate limit exceeded"

```TypeScript
# Wait and retry, or:
REDUCE_REQUESTS=true
BATCH_PROMPTS=true
```

### "Model not found"

```TypeScript
# For Ollama, list available models
ollama list

# Pull missing model
ollama pull codellama:13b
```

### "Connection timeout"

```TypeScript
# Check internet connection
ping console.anthropic.com

# Or switch to local
USE_LOCAL_FALLBACK=true
```

---

## Quick Reference: .env Template

```TypeScript
#
# GENTLE_VANGUARD - AI CONFIGURATION
#

#
# CLOUD PROVIDERS (Get keys from their websites)
#

# Anthropic (Claude) - Recommended
# Get: https://console.anthropic.com/
ANTHROPIC_API_KEY=sk-ant-xxxxx

# OpenAI (GPT-4)
# Get: https://platform.openai.com/
OPENAI_API_KEY=sk-xxxxx

# Google (Gemini)
# Get: https://aistudio.google.com/
GOOGLE_API_KEY=AIzaSyxxxxx

#
# LOCAL PROVIDER (Ollama)
#

# Base URL (default: localhost)
OLLAMA_BASE_URL=http://localhost:11434

# Default model
OLLAMA_MODEL=codellama:13b

#
# PROVIDER PRIORITY (First available is used)
#

# Options: anthropic, openai, google, ollama
DEFAULT_AI_PROVIDER=anthropic

# Fallback order
AI_PROVIDER_PRIORITY=anthropic,openai,ollama

#
# MODEL SELECTION
#

# Standard model
DEFAULT_MODEL=claude-sonnet-4-20250514

# For complex tasks
COMPLEX_TASK_MODEL=claude-opus-4-20250514

#
# COST MANAGEMENT
#

MAX_DAILY_SPEND_USD=10
SHOW_TOKEN_USAGE=true

#
# PERFORMANCE
#

CACHE_PROMPTS=true
STREAM_RESPONSES=true

#
```

---

## Verification Checklist

```TypeScript
# Run these to verify setup:

# 1. Check environment variables
echo $ANTHROPIC_API_KEY

# 2. Test Anthropic
claude "Say 'Claude connected!'"

# 3. Test OpenAI
opencode --model gpt-4o "Say 'OpenAI connected!'"

# 4. Test Ollama (if installed)
ollama list

# 5. Run Gentle-Vanguard validation
.\scripts\validate-workspace.ps1
```

Expected output:

```
[OK] Anthropic API configured
[OK] OpenAI API configured
[OK] Ollama running (if installed)
[OK] AI tools ready
```

---

## Getting Help

| Issue          | Solution                    |
| -------------- | --------------------------- |
| No API key     | Sign up at provider website |
| Invalid key    | Check for typos, regenerate |
| Rate limits    | Wait, or reduce usage       |
| Slow responses | Use faster model, or local  |
| Offline        | Use Ollama local models     |
