# Security Policy for Gentle-Vanguard

## Authentication

- Owner authentication via config/owner-auth.json.enc
- Session-level auth is demand-driven, not automatic
- Privacy gateway at scripts/security/privacy-gateway.ps1

## Data Protection

- Engram data stored locally in ~/.engram
- Session data in .session/ directory
- No credentials in code — all via encrypted config

## Monitoring

- Security orchestrator at scripts/security/security-orchestrator.ps1
- Token budget guard at scripts/utilities/telemetry/TELEMETRY-METRICS/token-budget-guard.ps1
- Full health verification via maintenance-watchtower.ps1
