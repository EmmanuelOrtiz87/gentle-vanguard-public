# Homologación: Gentle-Vanguard → Gentle-Vanguard-Public

## Propósito

Este documento describe el proceso completo para homologar (sincronizar) el repositorio privado
`gentle-vanguard` con el repositorio público `gentle-vanguard-public`.

## Arquitectura

| Repositorio                        | Propósito           | Contenido                                                                                   |
| ---------------------------------- | ------------------- | ------------------------------------------------------------------------------------------- |
| `gentle-vanguard` (privado)        | Desarrollo activo   | Stack completo: scripts, configs, skills, tests, docs en texto plano                        |
| `gentle-vanguard-public` (público) | Hub de distribución | Solo: `.exe` instalador, scripts encriptados, skill stubs, bootstrap scripts, docs públicos |

## Proceso de Homologación (4 pasos)

### Paso 1: Encriptar el stack

```TypeScript
cd C:\Workspace_local\gentle-vanguard
pwsh -NoProfile -File "build\protect-gentle-vanguard.ps1" -CompileEXE
```

Esto genera:

- `build/protected/` — 400+ archivos encriptados (.enc) con AES-256
- `build/public/` — 130+ skill stubs (solo SKILL.md)
- `build/compiled/Gentle-Vanguard-Launcher.exe` — Launcher compilado
- `build/compiled/gv.exe` — CLI compilado

### Paso 2: Construir el instalador

```TypeScript
& "C:\Program Files (x86)\NSIS\makensis.exe" "build\gentle-vanguard-installer.nsi"
```

Genera: `dist/Gentle-Vanguard.exe` (instalador unificado)

### Paso 3: Sincronizar al repo público

```TypeScript
pwsh -NoProfile -File "scripts\utilities\DEPLOYMENT\sync-to-public.ps1"
```

El script `sync-to-public.ps1` hace:

1. Copia bootstrap scripts (texto plano — necesarios para onboarding)
2. Copia documentación pública (solo subdirectorios seguros)
3. Copia configs de ejemplo (sin secretos)
4. Copia `build/protected/` → `protected/` (encriptados)
5. Copia `build/public/` → `public/` (skill stubs)
6. Copia demos
7. Copia ejecutables (.exe)
8. **Limpia** cualquier artifact en texto plano que no deba estar

### Paso 4: Commit y push

```TypeScript
Push-Location C:\Workspace_local\gentle-vanguard-public
git add -A
git commit -m "refactor: homologación completa - protect + sync"
git push origin develop
git checkout main
git merge develop --no-edit
git push origin main
git tag -a vX.Y.Z -m "vX.Y.Z: descripcion del release"
git push origin vX.Y.Z
git checkout develop
Pop-Location
```

## Estructura final de gentle-vanguard-public

```
gentle-vanguard-public/
├── Gentle-Vanguard.exe             # Instalador NSIS unificado
├── protected/                 # Scripts encriptados (.enc)
│   ├── scripts/               #   200+ scripts .ps1.enc
│   ├── config/                #   50+ configs .json.enc
│   └── skills/                #   130+ skills .enc
├── public/                    # Skill stubs públicos
│   └── skills/                #   130+ SKILL.md (solo teoría)
├── scripts/gentle-vanguard/        # Bootstrap (código abierto)
│   ├── bootstrap.ps1
│   ├── bootstrap-machine.ps1
│   └── setup-multi-machine.ps1
├── config/                    # Solo archivos .example
├── docs/                      # Solo docs públicos
├── demos/                     # Material de demo
├── .github/workflows/         # CI propio
├── keys/                      # HOW_TO_GET_KEY.txt
├── README.md
├── INSTALLATION.md
├── CHANGELOG.md
└── LICENSE
```

## Lo que NO se sincroniza

| Categoría              | Ejemplo                          | Razón                 |
| ---------------------- | -------------------------------- | --------------------- |
| Scripts en texto plano | `src/cli/gv.ts`                  | IP — solo encriptados |
| Configs reales         | `config/auto-delegation.json`    | IP — solo encriptados |
| Skills completos       | `skills/*/SKILL.md`              | IP — solo encriptados |
| Docs internos          | `docs/sessions/`, `docs/audits/` | Información interna   |
| Tests                  | `tests/`                         | Solo para desarrollo  |
| Templates              | `templates/`                     | Solo para desarrollo  |
| Rules                  | `rules/`                         | Solo para desarrollo  |
| Adapters               | `adapters/`                      | Solo para desarrollo  |
| Build artifacts        | `build/`, `dist/`                | Internos              |
| Apps                   | `apps/*`                         | Local-first (ADR-0017) |
| Scripts .ps1           | `scripts/*.ps1`, `hooks/*.ps1`   | Migrados a TS (NORM-TS-001) |
| Reports/Research       | `reports/`, `research/`          | Internos              |

## Verificación post-homologación

```TypeScript
# En gentle-vanguard-public:
# 1. NO debe haber scripts .ps1 en NINGUNA ruta (el stack migró a TS — NORM-TS-001;
#    el bootstrap se distribuye como TS en scripts/gentle-vanguard/)
Get-ChildItem -Recurse -Include "*.ps1"   # 0 resultados

# 2. NO debe haber apps (ADR-0017: apps local-first, nunca cruzan la frontera)
Test-Path apps/   # False

# 3. No debe haber configs planos (solo .example + allowlist explícito)
Get-ChildItem config/ | Where-Object { $_.Name -notlike "*.example.*" }
#   Permitidos: README.md, PSScriptAnalyzerSettings.psd1, installer-manifest.json,
#   model-router.json, session-autostart.config.json

# 4. protected/ debe tener archivos .enc
(Get-ChildItem protected/ -Recurse -Include "*.enc").Count  # > 400

# 5. .exe deben existir
Test-Path Gentle-Vanguard.exe   # True

# 6. Solo directorios del allowlist (docs, protected, public, demos, src, adapters,
#    tests/unit, tests/smoke, scripts/gentle-vanguard, config, .github)
Get-ChildItem -Directory | Select-Object Name
#   NO debe haber: reports, templates, docs-archive, rules, rules-archive, research,
#   tools, legacy-foundation, openspec, plugins, releases, client, gentle-vanguard,
#   .ft, .cursor, .continue, .engram, .codex, .antigravity, .devcontainer, .cline,
#   .engram-data, .workspace, .windsurf, .event-bus
```

> **Nota**: `sync-to-public.ts` aplica estas reglas automáticamente en cada sync — elimina
> cualquier `.ps1`, `apps/`, directorio stale y archivo root fuera del allowlist. La verificación
> manual es un control de regresión, no un paso manual obligatorio.

## Notas importantes

- **Master key**: Nunca se incluye en gentle-vanguard-public. Los usuarios la obtienen del repo
  privado o la pegan al primer launch.
- **Versionado**: gentle-vanguard-public debe mantener el mismo baseline de release que
  gentle-vanguard (ejemplo: v1.0.0 en adelante).
- **CI**: gentle-vanguard-public tiene su propio workflow (`public-quality-gate.yml`) que valida
  integridad del repo.
- **Frecuencia**: Homologar después de cada release significativo o cuando se agreguen nuevos
  scripts/skills.
- **Complementariedad**: esta homologacion no reemplaza el proceso de release; extiende la etapa de
  distribucion para el repo publico.
