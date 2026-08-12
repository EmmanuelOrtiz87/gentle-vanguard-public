# Dify.io Integration Example

This guide shows how to connect Gentle-Vanguard to Dify.io using the standard architecture.

---

## 1. Configure Provider in cloud-agents.local.json

Copy the example block from `config/cloud-agents.local.example` and edit it:

```json
{
  "providers": {
    "dify": {
      "enabled": true,
      "description": "Dify AI - Custom AI platform",
      "endpoint": "https://api.dify.ai/v1/chat/completions",
      "model": "dify-model",
      "api_key_env": "DIFY_API_KEY"
    }
  }
}
```

---

## 2. Load Your API Key

Create a `.env.local` file (or use `.env.local.example`) in the repo root:

```
DIFY_API_KEY=your_api_key_here
```

Alternatively, export the variable in your terminal:

```TypeScript
$env:DIFY_API_KEY = "your_api_key_here"
```

---

## 3. Test the Connection

```TypeScript
cd gentle-vanguard
.\scripts\utilities\AI-AGENT-MANAGEMENT\invoke-cloud-agent.ps1 -Provider dify -TestConnection
```

---

## 4. Manual Usage

- Run a command:

  ```TypeScript
  .\scripts\utilities\AI-AGENT-MANAGEMENT\invoke-cloud-agent.ps1 -Provider dify -Command "What is the capital of France?"
  ```

- Strict mode (automation):

  ```TypeScript
  .\scripts\utilities\AI-AGENT-MANAGEMENT\invoke-cloud-agent.ps1 -Provider dify -StrictJson -Command "return JSON"
  ```

- Interactive mode:

  ```TypeScript
  .\scripts\utilities\AI-AGENT-MANAGEMENT\invoke-cloud-agent.ps1 -Provider dify -Interactive
  ```

---

## Notes

- Never commit API keys in versióned files.
- Multiple providers can be configured and alternated using the `-Provider` flag.
- If the endpoint requires additional parameters, consult the Dify.io documentation.

---

**Last updated:** 2026-04-20
