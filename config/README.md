# Configuration Directory

Índice del canon de configuración del stack (218 archivos, 175 en la raíz; 10 schemas
`*.schema.json`).

> Regla de oro: un archivo de `config/` solo es canon si algún consumidor lo lee o un gate lo
> valida. Si nadie lo lee, es deuda declarada — no una fuente de verdad. Hoy **no** existe un
> escáner automático de huérfanos de `config/` (solo de módulos TS: `npm run orphans:check`); los
> candidatos de abajo están medidos a mano. Schemas:
> `node --import tsx src/core/config-loader.ts --validate-all` (corre en el composite pre-push).

## Configuraciones enforced (tienen consumidor y gate)

| Archivo                                                                    | Consumidor / gate                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `session-autostart.config.json`                                            | `src/session/session-autostart.ts` (143 steps)                      |
| `quality-gates.json` + `declarations.json`                                 | `gates:verify`, `gates:stats:check`, `declaration-audit` (pre-push) |
| `apps.registry.json` + `apps.registry-exclusions.json`                     | `app-registry-coverage`, `stack-audit-apps`                         |
| `app-validation-contracts.json` + `app-design-baseline.json`               | `src/git/prepush-app-scope.ts`, design canon gate                   |
| `mcp-registry.json` + `mcp-lifecycle-policy.json` + `mcp-demand-map.json`  | `mcp:probe`, `mcp:doctor`, puente `mcp:call`                        |
| `guardrails.json` + `policies/gv-core-tool-safety.yaml`                    | PolicyEngine de `src/security/agent-delegator.ts`                   |
| `runtime-retention.json` + `artifacts-retention.json`                      | `src/ops/runtime-retention.ts` (barrido diario)                     |
| `model-router.json` + `model-health-registry.json` + `model-fallback.json` | router de agentes, `npm run models:check`                           |
| `token-budget-guard.json`                                                  | `npm run token:safety`, guard de presupuesto                        |
| `brand.json` + `design-tokens.json`                                        | brand canon / gate de conformidad                                   |
| `codegraph.config.json`                                                    | decisión y medición de CodeGraph (re-medición 2026-12-18)           |
| `process-launcher-baseline.json`                                           | `audit:process-launchers --ratchet` (pre-push)                      |
| `baselines/`                                                               | docs-facts-drift, duplicate-mechanism, dependabot                   |
| `content-operations/`, `tool-profiles/`, `agent-prompts/`                  | posting, perfiles de herramientas, prompts                          |

## Subdirectorios

- `baselines/` — líneas base de gates (drift, duplicados, dependabot).
- `policies/` — reglas del PolicyEngine (`gv-core-tool-safety.yaml`).
- `tool-profiles/` — perfiles por herramienta desktop.
- `k8s/`, `azure/`, `opentelemetry/` — material de despliegue (hoy sin pipeline activo).
- `prometheus/` — sobrante: `docker-compose.yml` monta `config/prometheus.yml`.

## Deuda conocida (declarada, no silenciosa)

- ~30 archivos sin ningún consumidor (ej. `evaluation/eval-gates.json`, `federation-config.json`,
  `mq-config.json`). No se borran sin medición: candidatos a archivo en `.archive/` cuando exista un
  escáner de huérfanos de `config/` (hoy solo hay uno de módulos TS, `npm run orphans:check`).
- `token-budget-limits.json` es un tombstone (`deprecated: true`) que apunta a
  `token-budget-guard.json`; se conserva solo como registro de la migración de 2026-07-24.
- Duplicados de política de modelos: `model-router.json`, `model-fallback.json`, `model-health.json`
  y `model-health-registry.json` declaran cadenas de fallback que no se validan entre sí. Fuente
  propuesta: `model-router.json`; el resto derivado.
- `adaptive-config.json` → `preCompactHook` apunta a `src/pre-compact-hook.ts`, que no existe (clave
  muerta).
- `mcp-config.sd.json` es un subconjunto histórico del registry; no es fuente de verdad.
- Los schemas se validan solo por `validate-all` (pre-push). `$schema` con ruta mal escrita en
  `token-budget-guard.json` y `timeout-config.json` es inerte hoy.
- `.session/` (~5 GB, con snapshots ~3.7 GB) queda **fuera** de `runtime-retention.json`: podarlo es
  decisión del owner, no del barrido automático.

Última revisión de este índice: 2026-11-25 (barrido integral L0–L10).
