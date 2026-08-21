# Cloud Agent Connector - Complete Security & Setup Guide

> **Summary**: This guide covers secure setup, configuration, and usage of Gentle-Vanguard's Cloud
> Agent Connector for connecting to external AI providers (AWS Bedrock, Difi, Azure, OpenAI,
> Anthropic, Gemini, Ollama).

---

## Architecture Overview

```

                     CLOUD AGENT CONNECTOR



    Local Config          Template Config        Environment Vars
    (GITIGNORED)          (COMMITTED)            (Most Secure)

   cloud-agents.         config/cloud-           AWS_ACCESS_KEY_ID
   local.json            agents.json             OPENAI_API_KEY





                 invoke-cloud-agent
                      .ps1





     AWS          OpenAI         Difi
    Bedrock       Azure          Custom API



```

---

## Security Model

### Three-Layer Configuration Management

| Layer                | Source                         | Git Status     | Security Level | Use Case                         |
| -------------------- | ------------------------------ | -------------- | -------------- | -------------------------------- |
| **1 - Environment**  | System env vars / `.env.local` | Never in repo  | **HIGHEST**    | Credentials                      |
| **2 - Local Config** | `cloud-agents.local.json`      | **GITIGNORED** | **HIGH**       | Provider metadata and enablement |
| **3 - Template**     | `config/cloud-agents.json`     | Committed      | Template only  | Shared defaults                  |

### Security Principles

1. **Never commit secrets** - keep credentials in environment variables only
2. **Least privilege** - Use minimum required permissions
3. **Key rotation** - Rotate API keys every 90 days
4. **Audit logging** - Runtime requests logged to `.runtime/telemetry/cloud-agent-telemetry.csv`
5. **JSON-only mode** - Reduces narration errors from AI models

---

## Quick Setup (5 minutes)

### Step 1: Create Local Configuration

```TypeScript
# Navigate to Gentle-Vanguard scripts
cd .\gentle-vanguard

# Run the interactive config generator
.\scripts\utilities\invoke-cloud-agent.ps1 -Config
# Select option 2 to create your cloud-agents.local.json metadata template
```

### Step 2: Add Your API Keys

**Option A: Environment Variables (Recommended for production)**

```TypeScript
# Windows (TypeScript)
$env:OPENAI_API_KEY = "sk-..."
$env:ANTHROPIC_API_KEY = "sk-ant-..."
$env:DIFI_API_KEY = "your-difi-key"

# Add to TypeScript profile for persistence
Add-Content $PROFILE '$env:OPENAI_API_KEY = "sk-..."'
```

**Option B: .env.local (Recommended for development)**

```TypeScript
# Create .env.local in project root
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
DIFI_API_KEY=your-difi-key
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
```

`invoke-cloud-agent.ps1` automatically loads `.env.local` from repository root before resolving
provider credentials, but keeps existing process environment variables as higher priority.

For deterministic correlation, set `GENTLE_VANGUARD_SESSION_ID` in session workflows before cloud
requests.

### Step 3: Configure Your Provider Metadata

Edit `config/cloud-agents.local.json` (no secrets):

```json
{
  "providers": {
    "openai": {
      "enabled": true,
      "endpoint": "https://api.openai.com/v1/chat/completions",
      "model": "gpt-4o"
    }
  }
}
```

### Step 4: Test Connection

```TypeScript
# Test your configuration
.\scripts\utilities\invoke-cloud-agent.ps1 -ListProviders

# Test specific provider
.\scripts\utilities\invoke-cloud-agent.ps1 -Provider openai -TestConnection
```

---

## Usage Modes

### Mode 1: Command Mode (Single task)

```TypeScript
# Execute a single command
.\scripts\utilities\invoke-cloud-agent.ps1 -Provider openai -Command "Explain REST API pagination"
```

### Mode 2: Script Mode (Execute file)

```TypeScript
# Execute a script file
.\scripts\utilities\invoke-cloud-agent.ps1 -Provider bedrock -Script ".\tasks\analyze-code.ps1"
```

### Mode 3: Interactive Mode (Manual execution)

```TypeScript
# Start interactive session
.\scripts\utilities\invoke-cloud-agent.ps1 -Interactive

# Or with specific provider
.\scripts\utilities\invoke-cloud-agent.ps1 -Interactive -Provider difi
```

### Mode 4: Agent Mode (Delegated task)

```TypeScript
# Delegate a complex task
.\scripts\utilities\invoke-cloud-agent.ps1 -Provider anthropic -Agent "Refactor the authentication module to use JWT tokens"
```

### Mode 5: Strict JSON Mode (Automation)

```TypeScript
# Force JSON-only responses (reduces narration errors)
.\scripts\utilities\invoke-cloud-agent.ps1 -Provider openai -StrictJson -Command "Return user stats as JSON"
```

---

## Provider-Specific Setup

### AWS Bedrock

> Current status: direct `aws_sigv4` signing is not implemented in `invoke-cloud-agent.ps1` yet. Use
> a signed proxy endpoint (`auth_type: proxy_signed`) or another provider mode until SigV4 support
> is added.

**Requirements:**

- AWS account with Bedrock access
- IAM credentials with `bedrock:InvokeModel` permission
- AWS CLI configured or environment variables

**Setup:**

```TypeScript
# Option 1: AWS CLI profile
aws configure

# Option 2: Environment variables
$env:AWS_ACCESS_KEY_ID = "AKIA..."
$env:AWS_SECRET_ACCESS_KEY = "..."
$env:AWS_DEFAULT_REGION = "us-east-1"
```

**Configuration (config/cloud-agents.local.json):**

```json
{
  "providers": {
    "bedrock": {
      "enabled": true,
      "endpoint": "https://YOUR_SIGNED_PROXY/bedrock/invoke",
      "model": "anthropic.claude-3-5-sonnet-20241022",
      "auth_type": "proxy_signed"
    }
  }
}
```

### OpenAI

**Requirements:**

- OpenAI API key from https://platform.openai.com

**Setup:**

```TypeScript
$env:OPENAI_API_KEY = "sk-proj-..."
```

**Configuration:**

```json
{
  "providers": {
    "openai": {
      "enabled": true,
      "endpoint": "https://api.openai.com/v1/chat/completions",
      "model": "gpt-4o"
    }
  }
}
```

### Anthropic (Direct)

**Requirements:**

- Anthropic API key from https://console.anthropic.com

**Setup:**

```TypeScript
$env:ANTHROPIC_API_KEY = "sk-ant-..."
```

**Configuration:**

```json
{
  "providers": {
    "anthropic": {
      "enabled": true,
      "endpoint": "https://api.anthropic.com/v1/messages",
      "model": "claude-3-5-sonnet-20241022"
    }
  }
}
```

### Azure OpenAI

**Requirements:**

- Azure subscription
- OpenAI resource deployed

**Setup:**

```TypeScript
$env:AZURE_OPENAI_KEY = "..."
$env:AZURE_OPENAI_ENDPOINT = "https://your-resource.openai.azure.com/"
```

**Configuration:**

```json
{
  "providers": {
    "azure": {
      "enabled": true,
      "endpoint": "https://your-resource.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-versión=2024-02-01",
      "model": "gpt-4o",
      "api_versión": "2024-02-01"
    }
  }
}
```

### Difi

**Requirements:**

- Difi API credentials from provider

**Setup:**

```TypeScript
$env:DIFI_API_KEY = "your-difi-api-key"
```

**Configuration:**

```json
{
  "providers": {
    "difi": {
      "enabled": true,
      "endpoint": "https://api.difi.ai/v1/chat/completions",
      "model": "difi-model"
    }
  }
}
```

### Ollama (Local)

**Requirements:**

- Ollama installed locally
- Model pulled

**Setup:**

```TypeScript
# Install Ollama
winget install Ollama.Ollama

# Pull a model
ollama pull llama3.2

# Start Ollama service
ollama serve
```

**Configuration:**

```json
{
  "providers": {
    "ollama": {
      "enabled": true,
      "endpoint": "http://localhost:11434/api/chat",
      "model": "llama3.2",
      "local": true
    }
  }
}
```

---

## Security Best Practices

### 1. Environment Variables (Production)

**Do:**

```TypeScript
# Set at system/environment level, not in scripts
[Environment]::SetEnvironmentVariable("OPENAI_API_KEY", "sk-...", "User")
```

**Don't:**

```TypeScript
# NEVER do this - commits to git!
$config = @{
    api_key = "sk-..."  # BAD!
}
```

### 2. AWS IAM (Bedrock)

**Create dedicated IAM user:**

```json
{
  "versión": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      "Resource": "arn:aws:bedrock:us-east-1:*:gentle-vanguard-model/anthropic.claude-*"
    }
  ]
}
```

### 3. Key Rotation

```TypeScript
# Rotate keys every 90 days
# 1. Generate new key in provider dashboard
# 2. Update environment variable or local provider metadata (model/endpoint)
# 3. Test connection
# 4. Revoke old key
```

### 4. Audit & Monitoring

All runtime requests are logged to `.runtime/telemetry/cloud-agent-telemetry.csv` (local runtime
artifact). If you need management consolidation, run `scripts/utilities/consolidate-telemetry.ps1`.
<!-- REF-OBSOLETA: scripts/utilities/consolidate-telemetry.ps1 no tiene equivalente TS (migración PS1→TS) -->

Consolidation requires `Session_ID` correlation from runtime telemetry; rows without matching
session correlation are skipped by design.

```csv
Timestamp,User_ID,Session_ID,Request_ID,Provider,Model,InputTokens,OutputTokens,LatencyMs,Status,ErrorMessage
2026-04-17 10:30:00,ZW1tYW4=,2026-04-17-203645,0db96100-8444-4088-85aa-5f06d2dc4d05,openai,gpt-4o,120,245,1200,SUCCESS,
```

### 5. Network Security

**Use VPN for sensitive connections:**

- Corporate VPN for production API calls
- Consider VPC/private endpoints for AWS

**Firewall rules:**

```TypeScript
# Allow only necessary endpoints
$allowedEndpoints = @(
    "api.openai.com",
    "api.anthropic.com",
    "bedrock-runtime.*.amazonaws.com"
)
```

---

## Troubleshooting

### "Upstream returned workflow narration..."

**Cause:** Model returned conversational text instead of JSON tool call.

**Solution:** Use `-StrictJson` flag:

```TypeScript
.\scripts\utilities\invoke-cloud-agent.ps1 -Provider openai -StrictJson -Command "Return JSON"
```

### "Auth Failed"

**Cause:** Missing or incorrect API key.

**Solution:**

1. Verify environment variable is set: `$env:OPENAI_API_KEY`
2. Check key is valid in provider dashboard
3. Ensure config matches env var name

### "Connection timeout"

**Cause:** Network issue or endpoint unreachable.

**Solution:**

```TypeScript
# Test connectivity
Test-NetConnection api.openai.com -Port 443

# Check endpoint in config
.\scripts\utilities\invoke-cloud-agent.ps1 -Provider openai -TestConnection
```

### "Model not found"

**Cause:** Wrong model ID in configuration.

**Solution:** Update provider metadata in `config/cloud-agents.local.json` with correct model ID
from provider.

---

## File Reference

| File                                           | Purpose                              | Git Status     |
| ---------------------------------------------- | ------------------------------------ | -------------- |
| `scripts/utilities/invoke-cloud-agent.ps1`     | Main connector script                | Committed      |
<!-- REF-OBSOLETA: scripts/utilities/invoke-cloud-agent.ps1 no tiene equivalente TS (migración PS1→TS) -->
| `config/cloud-agents.json`                     | Shared template config               | Committed      |
| `config/cloud-agents.local.example`            | Local config template                | Committed      |
| `config/cloud-agents.local.json`               | Local provider metadata (no secrets) | **GITIGNORED** |
| `.runtime/telemetry/cloud-agent-telemetry.csv` | Request audit log                    | **GITIGNORED** |

---

## Quick Reference Card

```TypeScript
# List all providers
.\scripts\utilities\invoke-cloud-agent.ps1 -ListProviders

# Interactive mode
.\scripts\utilities\invoke-cloud-agent.ps1 -Interactive

# Single command
.\scripts\utilities\invoke-cloud-agent.ps1 -Provider openai -Command "your task"

# Script execution
.\scripts\utilities\invoke-cloud-agent.ps1 -Provider bedrock -Script ".\task.ps1"

# Strict JSON (automation)
.\scripts\utilities\invoke-cloud-agent.ps1 -Provider openai -StrictJson -Command "return JSON"

# Test connection
.\scripts\utilities\invoke-cloud-agent.ps1 -Provider openai -TestConnection

# Configure (create local config)
.\scripts\utilities\invoke-cloud-agent.ps1 -Config
```

---

**Last Updated:** 2026-04-17  
**versión:** 1.0
