# Cloud Agent Security Guide

## Overview

Gentle-Vanguard's Cloud Agent Connector supports secure connections to external AI providers (AWS
Bedrock, Difi, Azure, OpenAI, Anthropic, Gemini, Ollama).

**For complete setup and usage guide, see:** [CLOUD-AGENT-CONNECTOR.md](CLOUD-AGENT-CONNECTOR.md)

## Quick Security Rules

1. **Never commit secrets** - credentials must stay in environment variables
2. **Use environment variables** for production credentials
3. **Least privilege** - Minimum required IAM permissions
4. **Rotate keys** - Every 90 days
5. **Audit logs** - Runtime requests logged to `.runtime/telemetry/cloud-agent-telemetry.csv`

## Configuration and Secret Hierarchy

| Level | Method                                    | Security                   |
| ----- | ----------------------------------------- | -------------------------- |
| 1     | Environment variables / `.env.local`      | Highest                    |
| 2     | `cloud-agents.local.json` (metadata only) | High (gitignored)          |
| 3     | `config/cloud-agents.json`                | Template only (no secrets) |

`.env.local` is supported for development via auto-load in `invoke-cloud-agent.ps1`, but it does not
override pre-existing environment variables.

## Quick Setup

```TypeScript
# 1. Create local configuration
.\scripts\utilities\invoke-cloud-agent.ps1 -Config
# Select option 2

# 2. Add your API keys as environment variables
$env:OPENAI_API_KEY = "sk-..."

# 3. Enable provider metadata in cloud-agents.local.json
# Set "enabled": true for your provider

# 4. Test connection
.\scripts\utilities\invoke-cloud-agent.ps1 -Provider openai -TestConnection
```

## Common Issues

| Error                | Cause                          | Solution                         |
| -------------------- | ------------------------------ | -------------------------------- |
| "Auth Failed"        | Missing API key                | Check `$env:YOUR_API_KEY` is set |
| "Narration error"    | Model talked instead of acting | Use `-StrictJson` flag           |
| "Connection timeout" | Network issue                  | Check firewall/proxy             |

## Provider-Specific Notes

### AWS Bedrock

- Current script path supports Bedrock via signed proxy only (direct SigV4 request signing is not
  implemented yet)
- Use IAM credentials with `bedrock:InvokeModel` only on the proxy side
- Consider VPC endpoints for production
- Configure provider with `auth_type: proxy_signed`

### OpenAI/Azure

- Set API key in environment: `$env:OPENAI_API_KEY`
- Rate limits apply per API key

### Ollama (Local)

- No API key needed
- Ensure service running: `ollama serve`

## Files

| File                                           | Git    | Purpose                              |
| ---------------------------------------------- | ------ | ------------------------------------ |
| `invoke-cloud-agent.ps1`                       | Yes    | Main script                          |
| `config/cloud-agents.json`                     | Yes    | Template (no secrets)                |
| `config/cloud-agents.local.json`               | **NO** | Local provider metadata (no secrets) |
| `.runtime/telemetry/cloud-agent-telemetry.csv` | **NO** | Runtime audit log                    |
