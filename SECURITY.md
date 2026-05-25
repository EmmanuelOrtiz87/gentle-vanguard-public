# Security Policy

## Supported Versions

| Version | Supported             |
| ------- | --------------------- |
| 2.6.x   | ✓ Active              |
| < 2.6   | ✗ No longer supported |

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security vulnerabilities.**

Report vulnerabilities privately to the platform team:

1. **Email**: Use the contact listed in the repository's CODEOWNERS file.
2. **GitHub Security Advisories**: Use the "Report a vulnerability" button in the Security tab.

### What to include

- Description of the vulnerability and potential impact
- Steps to reproduce
- Affected component(s): scripts, config, workflows, hooks
- Any suggested fix

### Response timeline

| Phase                   | Target                                                     |
| ----------------------- | ---------------------------------------------------------- |
| Initial acknowledgement | 48 hours                                                   |
| Severity assessment     | 5 business days                                            |
| Fix or mitigation       | Depends on severity (CRITICAL: 7d, HIGH: 14d, MEDIUM: 30d) |
| Disclosure              | Coordinated after fix is released                          |

## Security Controls

This project implements the following security controls:

| Control                 | Implementation                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| Secret scanning         | Pre-commit hook (`check-secrets` patterns) + gitleaks + trufflehog + GitHub secret scanning        |
| Dependency scanning     | Trivy (weekly, `.github/workflows/security-scan.yml`)                                              |
| SAST (PowerShell)       | PSScriptAnalyzer (`.github/workflows/ps-lint.yml`)                                                 |
| SAST (CodeQL)           | CodeQL analysis (`.github/workflows/security-scan.yml#CodeQL`)                                    |
| SBOM Generation         | CycloneDX via Trivy (`.github/workflows/security-scan.yml#SBOM`)                                   |
| Workflow hardening      | All workflows: `permissions: contents: read`, `timeout-minutes`, `concurrency`                     |
| Action pinning          | Dependabot weekly updates (`.github/dependabot.yml`)                                               |
| Access control          | `config/access-control.json` + `config/security-policy.json`                                       |
| Hook output safety      | `scripts/hooks/hook-output-safety.ps1` (redacts secrets from hook logs)                            |
| RBAC                    | `config/owner-auth.json` (owner-only operations)                                                   |
| Secret Vault            | `scripts/security/secret-vault.ps1` — DPAPI-encrypted local vault, rotation, breach response       |
| Secrets Manager         | `scripts/security/secrets-manager.ps1` (v2.0) — delegates to vault, no plain-text storage         |
| Security Orchestrator   | `scripts/security/security-orchestrator.ps1` — PII sanitization, critical pattern blocking, audit |
| Privacy Gateway         | `scripts/security/privacy-gateway.ps1` — auto-sanitization of prompts/outputs                     |
| SIEM Bridge             | `scripts/security/siem-audit-bridge.ps1` — Splunk/ELK/Datadog integration                         |
| Encryption Manager      | `scripts/security/encryption-manager.ps1` — AES-256 key management                                |
| Secure Auth             | `scripts/security/secure-auth.ps1` — DPAPI encryption, lockout after 3 attempts                   |
| Input Validator         | `scripts/security/input-validator.ps1` — type validation, injection prevention                    |
| Pre-commit hooks        | `.lefthook.yml` — gitleaks, trufflehog, JSON lint, workflow lint, lockfile lint                   |

### Changelog (Security Fixes)

| Date       | Component              | Change                                                               |
| ---------- | ---------------------- | -------------------------------------------------------------------- |
| 2026-05-23 | `secrets-manager.ps1`  | v2.0 — Replaced env-var storage with DPAPI vault delegation          |
| 2026-05-23 | `security-logger.ps1`  | v1.1 — Added PII sanitization (Invoke-SanitizePII)                   |
| 2026-05-23 | `input-validator.ps1`  | Fixed Validate-Integer syntax error (missing outer closing brace)    |
| 2026-05-23 | `keys/master.key`      | Removed from git tracking; added to `.gitignore`                     |
| 2026-05-23 | `tests/security/`      | Added 5 new test suites (logger, vault, orchestrator, sanitizer, input) |
| 2026-05-24 | `encryption-manager.ps1` | Added `switch ($Action)` dispatch block for CLI execution            |
| 2026-05-24 | `encryption-manager.ps1` | Fixed `Generate-EncryptionKey` .NET overload: `GetBytes($key)` → `GetBytes(32)` |
| 2026-05-24 | `encryption-manager.ps1` | Added idempotency guard: `generate-key` no longer overwrites existing key |
| 2026-05-24 | `privacy-sanitizer.ps1` | Fixed `$BLOCKED_PATTERNS.envVars` quoting: double→single quotes to prevent PS variable expansion |
| 2026-05-24 | `secret-vault.ps1` | Fixed `Save-SecretMeta` `[hashtable]` type constraint causing rotate/breach-response to crash on `PSCustomObject` input |

## Compliance Frameworks

| Standard      | Reference                                  | Status    |
| ------------- | ------------------------------------------ | --------- |
| OWASP LLM Top 10 2025 | `config/security-hardening.json`      | ENFORCED  |
| OWASP Agentic Top 10 2026 | `docs/NORMATIVAS-SEGURIDAD.md`     | ENFORCED  |
| SOC2          | `rules/NORMATIVAS-SOC2.md`                 | MANDATORY |
| ISO 27001:2022 | `docs/NORMATIVAS-ISO27001.md`             | MAPPED    |
| ISO 25010     | `docs/NORMATIVAS-ISO25010.md`              | MAPPED    |
| GDPR          | `config/secrets-governance.json`           | MANDATORY |

## Hardening Checklist (for contributors)

- [ ] No secrets, tokens, or credentials in committed files
- [ ] No `Write-Host` of environment variables in hooks (use `Write-SafeHook`)
- [ ] New CI workflows must include `permissions: contents: read`, `timeout-minutes`, and `concurrency`
- [ ] PowerShell scripts must pass PSScriptAnalyzer with zero errors
- [ ] External URLs only from the allow-list in `config/security-privacy.json`
- [ ] Run `tests/security/*.tests.ps1` before submitting PRs with security changes
- [ ] Use `scripts/security/secret-vault.ps1` for secrets — never env vars or plain files
- [ ] All PII must be sanitized via `scripts/security/privacy-sanitizer.ps1` before logging
