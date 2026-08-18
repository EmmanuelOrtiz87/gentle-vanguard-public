# Guía de Operación Gentle-Vanguard

**Versión:** 3.5.0  
**Última actualización:** 2026-08-02

---

## Índice

1. [Inicio Rápido](#inicio-rápido)
2. [Herramientas Disponibles](#herramientas-disponibles)
3. [Operaciones Diarias](#operaciones-diarias)
4. [Monitoreo y Health Checks](#monitoreo-y-health-checks)
5. [Solución de Problemas](#solución-de-problemas)
6. [Actualizaciones](#actualizaciones)
7. [Referencia Rápida](#referencia-rápida)

---

## Inicio Rápido

### Requisitos Previos

- Node.js 22+
- pnpm 11.15.1+
- Git

### Instalación Inicial

```bash
# Clonar repositorio
git clone https://github.com/EmmanuelOrtiz87/gentle-vanguard.git
cd gentle-vanguard

# Instalar dependencias
pnpm install --frozen-lockfile

# Verificar instalación
pnpm run health:check
```

### Iniciar Sesión de Desarrollo

```bash
# Iniciar sesión (automatizado)
npx tsx src/session-autostart.ts

# O manualmente
pnpm run session:start
```

---

## Herramientas Disponibles

### Core

| Herramienta       | Comando                            | Descripción                       |
| ----------------- | ---------------------------------- | --------------------------------- |
| **Health Check**  | `npm run health:check`             | Verifica estado de 81 componentes |
| **Watchtower**    | `npm run watchtower:health`        | Monitoreo continuo del stack      |
| **Session Start** | `npx tsx src/session-autostart.ts` | Inicializa pipeline de sesión     |
| **Type Check**    | `npm run typecheck`                | Valida TypeScript                 |
| **Lint**          | `npm run lint`                     | ESLint en todo el código          |

### Dashboard

| Herramienta         | Comando                                 | Descripción                    |
| ------------------- | --------------------------------------- | ------------------------------ |
| **Dashboard Start** | `pnpm run dashboard:start`              | Inicia WebSocket server + Vite |
| **Dashboard WS**    | `npx tsx src/dashboard-ws-autostart.ts` | Solo WebSocket server          |
| **Dashboard Stop**  | `npx tsx src/dashboard-stop.ts`         | Detiene dashboard              |

### Cloud Connectors

| Herramienta         | Comando                                       | Descripción                       |
| ------------------- | --------------------------------------------- | --------------------------------- |
| **AWS Delegator**   | `npx tsx src/aws-delegator.ts`                | Ejecuta skills en AWS Lambda      |
| **Azure Delegator** | `npx tsx src/azure-delegator.ts`              | Ejecuta skills en Azure Functions |
| **Hybrid Executor** | `npx tsx src/hybrid-executor.ts`              | Routing entre local/cloud         |
| **Cloud Metrics**   | `npx tsx src/cloud-metrics-collector.ts show` | Muestra métricas                  |
<!-- REF-OBSOLETA: src/cloud-metrics-collector.ts no existe (ruta migrada o eliminada) -->

### Testing

| Herramienta             | Comando                                              | Descripción            |
| ----------------------- | ---------------------------------------------------- | ---------------------- |
| **Tests**               | `pnpm test`                                          | Ejecuta suite de tests |
| **Deterministic Tests** | `npx tsx src/deterministic-test-framework.ts --list` | Tests sin costo de API |
| **Coverage**            | `pnpm test:coverage`                                 | Reporte de cobertura   |

### Auto-Update

| Herramienta       | Comando                                           | Descripción                     |
| ----------------- | ------------------------------------------------- | ------------------------------- |
| **Check Updates** | `npx tsx src/auto-update-checker.ts --check-only` | Verifica nuevas versiones       |
| **Show Updates**  | `npx tsx src/auto-update-checker.ts`              | Muestra instrucciones de update |

---

## Operaciones Diarias

### Flujo de Trabajo Típico

```bash
# 1. Iniciar sesión
npx tsx src/session-autostart.ts

# 2. Verificar estado
npm run watchtower:health

# 3. Trabajar...
# (desarrollo normal)

# 4. Antes de commit
pnpm run typecheck
pnpm run lint

# 5. Commit (hooks automáticos)
git add .
git commit -m "feat: ..."

# 6. Push (hooks automáticos)
git push origin develop
```

### Pre-Commit Hooks (Automáticos)

- ✅ JSON lint
- ✅ Workflow lint
- ✅ Lockfile lint
- ✅ Trufflehog secrets scan
- ✅ Skill scan
- ✅ Secretlint

### Pre-Push Hooks (Automáticos)

- ✅ TypeScript check
- ✅ ESLint
- ✅ Audit check
- ✅ Orchestrator auto-fix
- ✅ npm audit

---

## Monitoreo y Health Checks

### Health Check Completo

```bash
npm run watchtower:health
```

**Resultado esperado:**

```
PASS: 77 | WARN: 4 | FAIL: 0 | Total: 81
```

### Componentes Monitoreados

| Componente         | Estado Esperado |
| ------------------ | --------------- |
| dashboard-ws       | OK              |
| codegraph          | OK              |
| ml-embeddings      | OK              |
| engram             | OK              |
| mcp                | OK              |
| session            | OK              |
| cloud-connectors   | OK              |
| tracing            | OK              |
| state-persistence  | OK              |
| audit              | OK              |
| governance         | OK              |
| gentle-vanguard-db | OK              |

### Warnings Aceptables

Los siguientes warnings son **transitorios** y no indican problemas:

- `engram reindex freshness` — Se refresca automáticamente
- `cloud-connectors metrics` — Se generan en uso real
- `gentle-vanguard-db integrity check` — DB locked temporalmente

---

## Solución de Problemas

### Dashboard WS No Responde

```bash
# Verificar si está corriendo
Get-Content .runtime/dashboard-ws.log -Tail 20

# Reiniciar
npx tsx src/dashboard-stop.ts
npx tsx src/dashboard-ws-autostart.ts
```

### TypeScript Errors

```bash
# Correr typecheck
npm run typecheck

# Auto-fix donde sea posible
pnpm run lint --fix
```

### Tests Fallan

```bash
# Correr tests con verbose
pnpm test -- --verbose

# Correr un test específico
pnpm test -- --grep "nombre-del-test"
```

### Engram No Responde

```bash
# Verificar estado
tools/engram.exe doctor

# Reindexar si es necesario
npx tsx src/skills/skill-embedder.ts
```

### Problemas de Git Hooks

```bash
# Reinstalar hooks
npx lefthook install

# Verificar configuración
npx lefthook run pre-commit --dry-run
```

---

## Actualizaciones

### Verificar Actualizaciones

```bash
npx tsx src/auto-update-checker.ts --check-only
```

### Aplicar Actualización

```bash
# 1. Fetch cambios
git fetch origin

# 2. Pull última versión
git pull origin develop

# 3. Reinstalar dependencias
pnpm install --frozen-lockfile

# 4. Verificar salud
npm run watchtower:health
```

### Actualizar Skills

```bash
# Reindexar skills
npx tsx src/skills/skill-embedder.ts

# Verificar embeddings
Get-Content .atl/skill-embeddings.json | Select-Object -First 10
```

---

## Referencia Rápida

### Comandos Esenciales

```bash
# Salud del stack
npm run watchtower:health

# TypeScript
npm run typecheck

# Lint
npm run lint

# Tests
pnpm test

# Dashboard
pnpm run dashboard:start

# Session
npx tsx src/session-autostart.ts

# Cloud metrics
npx tsx src/cloud-metrics-collector.ts show
<!-- REF-OBSOLETA: src/cloud-metrics-collector.ts no existe (ruta migrada o eliminada) -->

# Auto-update
npx tsx src/auto-update-checker.ts

# Deterministic tests
npx tsx src/deterministic-test-framework.ts --list
```

### Estructura de Directorios

```
gentle-vanguard/
├── apps/web-dashboard/     # Dashboard React/TypeScript
├── src/                    # Scripts TypeScript
│   ├── core/              # Core functionality
│   ├── skills/            # Skill embedder
│   └── infrastructure/    # Infrastructure scripts
├── config/                # Configuraciones
├── docs/                  # Documentación
├── rules/                 # Normativas
├── .github/workflows/     # CI/CD
├── .session/              # Session data
├── .runtime/              # Runtime data
└── .atl/                  # ML embeddings
```

### Variables de Entorno Importantes

| Variable             | Descripción                 |
| -------------------- | --------------------------- |
| `NODE_ENV`           | development/production      |
| `SESSION_ID`         | ID de sesión actual         |
| `WS_PORT`            | Puerto del WebSocket server |
| `AZURE_FUNCTION_URL` | URL de Azure Functions      |
| `AWS_REGION`         | Región de AWS               |

---

## Soporte

- **Documentación:** `docs/guides/`
- **Issues:** GitHub Issues
- **Roadmap:** `docs/product/ROADMAP.md`
- **Status:** `docs/status/STACK-STATUS-REPORT.md`

---

**Gentle-Vanguard v3.5.0** — _Local-first, seguro, extensible, zero-drama._
