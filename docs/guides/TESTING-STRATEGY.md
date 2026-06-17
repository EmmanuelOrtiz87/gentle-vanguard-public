# Automated Testing and CI/CD Enforcement

## Current Status

The project has **28 automated tests** organized in 4 categories:

- **22 Unit tests** — Individual component validation
- **3 Integration tests** — Cross-component interaction
- **2 Security tests** — Input validation, secret detection
- **1 Performance test** — Engram memory benchmarks

All tests use **Pester 5.x** and run via `scripts/run-tests-simple.ps1`.

## Test Categories

| Category    | Count | Location             | Purpose                                             |
| ----------- | ----- | -------------------- | --------------------------------------------------- |
| Unit        | 22    | `tests/unit/`        | Validate individual scripts, configs, and modules   |
| Integration | 3     | `tests/integration/` | Cross-component flows (routing, delegation, engram) |
| Security    | 2     | `tests/security/`    | Input sanitization, credential handling             |
| Performance | 1     | `tests/performance/` | Engram memory operation benchmarks                  |

## CI/CD Integration

Tests run automatically in CI via `test-suite.yml` (GitHub Actions):

- On every push to `main` and `develop`
- On every PR targeting `main`
- All 4 categories execute sequentially
- Failure blocks merge

## Code Coverage

Coverage is generated via Pester's built-in `CodeCoverage` configuration:

```powershell
$config = New-PesterConfiguration
$config.CodeCoverage.Enabled = $true
$config.CodeCoverage.OutputFormat = 'JaCoCo'
$config.CodeCoverage.OutputPath = 'coverage.xml'
Invoke-Pester -Configuration $config
```

Coverage reports are uploaded as artifacts in CI.

## Adding Tests

1. Create `*.tests.ps1` in the appropriate `tests/<category>/` directory
2. Use Pester `Describe` / `It` / `Should` syntax
3. Update `tests/README.md` if category counts change
4. Run locally: `.\scripts\run-tests-simple.ps1`

## References

- Test runner: `scripts/run-tests-simple.ps1`
- CI workflow: `.github/workflows/test-suite.yml`
- See [skills/testing-skill/SKILL.md](../../skills/testing-skill/SKILL.md) for strategy details
- See [docs/guides/SECURITY-AUTH-SECRETS.md](SECURITY-AUTH-SECRETS.md) for secret management during
  tests
