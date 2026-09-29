# Guía de Uso Multi-Herramienta

Esta guía explica cómo usar Gentle-Vanguard con OpenCode, Codex, ZCode, MiniMax Code, Cursor, VS
Code, Antigravity, Windsurf y Cline.

Codex es el cliente operativo primario. OpenCode, ZCode, MiniMax Code, GitHub Copilot y Antigravity
mantienen contratos independientes: no son dependencias de Codex, no tienen que permanecer abiertos
y no requieren control cruzado de sus interfaces. La matriz automatizada valida las seis rutas sin
simular launchers ni resultados.

---

## Visión General

Gentle-Vanguard detecta automáticamente qué herramienta estás usando y carga la configuración
correspondiente.

**Flujo de detección**:

1. **Variables de entorno** (prioridad alta): `OPENCODE_CHAT_MODE`, `CURSOR_TRACE_ID`, etc.
2. **Proceso padre** (fallback): Detecta el proceso que ejecuta el script
3. **Carga de configuración**: `config/tool-{herramienta}.json`
4. **Pre-procesamiento**: `src/pre-process-input.ts`

---

## Herramientas Soportadas

### 1. OpenCode ✅

**Configuración**: `config/tool-opencode.json`  
**Capacidades**: MCP, Subagents, Skills, Token Management

**Uso**:

```bash
# OpenCode ya detecta automáticamente
opencode
# Gentle-Vanguard carga: tool-opencode.json + skills
```

**Variables de entorno**:

- `OPENCODE_CHAT_MODE` (detectada)
- `OPENCODE_CLIENT`, `OPENCODE_SERVER_*`

Engram v2 se instala con `engram setup opencode`. La verificación real es `opencode mcp list`, que
debe mostrar `engram connected`; wrappers demo o simulados son rechazados por `tools:audit`. El
auditor consulta además `opencode --version`: V1 estable usa el contrato vigente; V2, prereleases o
versiones ambiguas quedan bloqueadas hasta disponer de un perfil nativo validado para esa variante.

---

### 2. Cursor ✅

**Configuración**: `config/tool-cursor.json`  
**Adaptador**: MCP Bridge  
**Capacidades**: MCP, Parallel Execution, Skills

**Uso**:

```bash
# Cursor detecta automáticamente
cursor .
# Gentle-Vanguard carga: tool-cursor.json + .cursorrules
```

**Variables de entorno**: `CURSOR_TRACE_ID`

---

### 3. VS Code / GitHub Copilot / Cline ✅

**Configuración**: `config/tool-vscode.json`, `config/tool-cline.json`  
**Adaptador**: MCP Bridge  
**Capacidades**: MCP, File Ops, Terminal, Git, 25 skills críticas y memoria Engram v2

**Uso**:

```bash
# VS Code con extensiones
code .
# O Cline (VS Code extension)
# Gentle-Vanguard carga: tool-vscode.json o tool-cline.json
```

`engram setup vscode-copilot` registra el MCP y el Memory Protocol en el perfil de usuario. El
workspace aporta `.vscode/mcp.json`, `.github/copilot-instructions.md` y `.github/skills/`.

**Variables de entorno**: `VSCODE_GIT_IPC_HANDLE`

---

### 4. Antigravity ✅

**Configuración**: `config/tool-antigravity.json`  
**Adaptador**: Format Adapter (`adapters/format-adapters/antigravity-adapter/`)  
**Capacidades**: Mission Control, MCP, skills de workspace y memoria Engram v2

**Uso**:

```bash
# Antigravity detecta automáticamente
antigravity agent --mission-control
# Gentle-Vanguard carga: tool-antigravity.json
# Carga .antigravity/skills/ y AGENTS.md
```

**Variables de entorno**: `ANTIGRAVITY_SESSION`

`engram setup antigravity-cli` registra el MCP compartido en `~/.gemini/config/mcp_config.json` y el
Memory Protocol en `~/.gemini/GEMINI.md`. El adaptador legado se conserva para formatos antiguos,
pero no es la ruta principal.

---

### 5. Codex ✅

**Configuración**: `config/tool-codex.json` **Adaptador**: Format Adapter
(`adapters/format-adapters/codex-adapter/`) **Capacidades**: MCP, skills nativas, subagentes,
multi-agent, function calling, terminal y plugins

**Uso**:

```bash
# Codex detecta automáticamente
codex
# Codex carga AGENTS.md y las skills desde ~/.codex/skills/
# Gentle-Vanguard aporta: tool-codex.json + autostart + Engram/Nexus
```

**Variables de entorno detectadas**: `CODEX_SESSION_ID`, `CODEX_THREAD_ID`, `CODEX_VERSION`

El adaptador se conserva para integraciones antiguas, pero no es la ruta principal de skills:

```bash
cd adapters/format-adapters/codex-adapter
node adapter.js convert-skill skills/react-19-skill/SKILL.md react-19.json
node adapter.js generate-tools skills/ tools.json
node adapter.js generate-proxy proxy.js  # Inicia proxy en puerto 3000
```

---

### 6. ZCode ✅

**Configuración**: `config/tool-zcode.json`, `.zcode/config.json`, `~/.zcode/cli/config.json`
**Capacidades**: MCP, 21 agentes, 25 skills críticas, hooks, plugins y token tracking

```bash
npx tsx src/integrations/zcode-sync.ts --sync --tools zcode
```

ZCode es un runtime desktop: una CLI global en `PATH` es opcional. Los hooks instalados ejecutan
`node --import tsx` directamente y no crean procesos nietos visibles en Windows. Los cambios
requieren una nueva sesión.

### 7. MiniMax Code ✅

**Configuración**: `config/tool-minimax.json`, `~/.minimax/config.yaml` **Capacidades**: pi-agent,
subagentes, razonamiento, tool calling, 25 skills y token tracking

```bash
npx tsx src/integrations/zcode-sync.ts --sync --tools minimax
```

El orquestador `mavis` carga las skills desde `~/.minimax/agents/mavis/skills/`.
`~/.minimax/bin/gv-stack.cmd` es un helper para ejecutar la CLI de Gentle-Vanguard desde el entorno
MiniMax; no debe interpretarse como launcher del runtime MiniMax Code.

MiniMax expone MCP desde `/mcp` dentro de su TUI, pero esa UI no tiene un contrato externo estable
para mutarla desde Codex. Mientras no se confirme allí, `engram-memory` usa el CLI real como
fallback (`engram search/save/doctor --project gentle-vanguard`). Esto mantiene memoria operativa
sin afirmar una integración MCP que no fue observada.

### 8. Windsurf ✅

**Configuración**: `config/tool-windsurf.json`  
**Adaptador**: Format Adapter (`adapters/format-adapters/windsurf-adapter/`)  
**Capacidades**: Plugin System, AI Chat

**Uso**:

```bash
# Windsurf detecta automáticamente
windsurf .
# Gentle-Vanguard carga: tool-windsurf.json
# Convierte skills a formato plugin
```

**Variables de entorno**: `WINDSURF_CHAT_MODE`

**Comandos del adaptador**:

```bash
cd adapters/format-adapters/windsurf-adapter
node adapter.js convert-skill skills/react-19-skill/SKILL.md .windsurf/plugins
node adapter.js generate-config skills/ .windsurf/windsurf.json
```

---

## ¿El comportamiento es igual en todas las herramientas?

**Estructura base**: ✅ SÍ

- Misma detección (`src/core/detect-tool.ts`)
- Mismo pre-procesamiento (`src/tools/pre-process-input.ts`)
- Misma carga de configuración (`tool-{herramienta}.json`)

**Capacidades**: varían por runtime.

| Herramienta           | Engram                | Skills           | Multi-agent | Integración principal             |
| --------------------- | --------------------- | ---------------- | ----------: | --------------------------------- |
| OpenCode              | MCP + plugin          | Nativas          |          Sí | CLI real + config global          |
| Codex                 | MCP + plugin          | Sincronizadas    |          Sí | `AGENTS.md` + plugin              |
| ZCode                 | MCP genérico          | Sincronizadas    |          Sí | Runtime desktop + hooks           |
| MiniMax Code          | CLI fallback / MCP UI | pi-agent         |          Sí | `mavis` + `engram-memory`         |
| GitHub Copilot        | MCP                   | `.github/skills` |    Limitado | VS Code Agent Mode                |
| Antigravity           | MCP compartido        | Workspace        |          Sí | `.gemini` + `.antigravity/skills` |
| Cursor/Cline/Windsurf | MCP bridge            | Según cliente    |    Limitado | Perfil compatible                 |

---

## Archivos Clave

```
gentle-vanguard/
├── adapters/
│   ├── detection/
│   │   └── enhanced-detect.ps1      # Detección de herramientas
│   ├── format-adapters/
│   │   ├── antigravity-adapter/      # ✅ Implementado
│   │   ├── codex-adapter/            # ✅ Implementado
│   │   └── windsurf-adapter/          # ✅ Implementado
├── config/
│   ├── tool-opencode.json            # ✅ Config OpenCode
│   ├── tool-cursor.json              # ✅ Config Cursor
│   ├── tool-vscode.json              # ✅ Config VS Code
│   ├── tool-cline.json               # ✅ Config Cline
│   ├── tool-antigravity.json         # ✅ Config Antigravity
│   ├── tool-codex.json              # ✅ Config Codex
│   ├── tool-zcode.json              # ✅ Config ZCode
│   ├── tool-minimax.json            # ✅ Config MiniMax Code
│   └── tool-windsurf.json           # ✅ Config Windsurf
├── scripts/utilities/
│   ├── pre-process-input.ps1        # ✅ Pre-procesamiento (integrado)
│   └── session-autostart.cmd        # ✅ Inicio de sesión
└── config/orchestrator.json         # ✅ Perfiles del orquestador
```

---

## Verificación

```bash
npm run tools:audit
npm run tools:audit:write
npm run engram:mcp:smoke
npx tsx src/integrations/zcode-sync.ts --status
```

`tools:audit` distingue CLI real, variante de runtime, perfiles, skills, agentes, hooks,
instrucciones y Engram. Para las cinco superficies sincronizadas también compara el árbol recursivo
y SHA-256 de cada skill crítica; un asset modificado, ausente o inesperado bloquea el gate.
`engram:mcp:smoke` realiza handshake stdio, exige las herramientas críticas y ejecuta
`mem_list_projects` en modo lectura. Una UI desktop puede no tener CLI global; esa ausencia no falla
si su contrato nativo está completo. Los cambios requieren una nueva sesión del cliente.

---

**Versión**: 2.0.0 **Estado**: interoperabilidad auditable y perfiles sincronizados
**Compatibilidad**: 10 perfiles soportados
