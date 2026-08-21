# Guía de Uso Multi-Herramienta

Esta guía explica cómo usar Gentle-Vanguard con diferentes herramientas (OpenCode, Cursor, VS Code,
Antigravity, Codex, Windsurf, Cline).

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
openCode
# Gentle-Vanguard carga: tool-opencode.json + skills
```

**Variables de entorno**:

- `OPENCODE_CHAT_MODE` (detectada)
- `OPENCODE_CLIENT`, `OPENCODE_SERVER_*`

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

### 3. VS Code / Cline ✅

**Configuración**: `config/tool-vscode.json`, `config/tool-cline.json`  
**Adaptador**: MCP Bridge  
**Capacidades**: MCP, File Ops, Terminal, Git

**Uso**:

```bash
# VS Code con extensiones
code .
# O Cline (VS Code extension)
# Gentle-Vanguard carga: tool-vscode.json o tool-cline.json
```

**Variables de entorno**: `VSCODE_GIT_IPC_HANDLE`

---

### 4. Antigravity ✅

**Configuración**: `config/tool-antigravity.json`  
**Adaptador**: Format Adapter (`adapters/format-adapters/antigravity-adapter/`)  
**Capacidades**: Mission Control, Multi-Agent, AgentKit 2.0

**Uso**:

```bash
# Antigravity detecta automáticamente
antigravity agent --mission-control
# Gentle-Vanguard carga: tool-antigravity.json
# Convierte skills a formato Mission Control
```

**Variables de entorno**: `ANTIGRAVITY_SESSION`

**Comandos del adaptador**:

```bash
cd adapters/format-adapters/antigravity-adapter
node adapter.js convert-skill skills/react-19-skill/SKILL.md output.json
node adapter.js generate-agents-md skills/ AGENTS.md
node adapter.js generate-mission '[{"name":"dev"}]' mission.yaml
```

---

### 5. Codex ✅

**Configuración**: `config/tool-codex.json`  
**Adaptador**: Format Adapter (`adapters/format-adapters/codex-adapter/`)  
**Capacidades**: Function Calling, OpenAI API

**Uso**:

```bash
# Codex detecta automáticamente
codex
# Gentle-Vanguard carga: tool-codex.json
# Convierte skills a OpenAI function format
```

**Variables de entorno**: `CODEX_SESSION`

**Comandos del adaptador**:

```bash
cd adapters/format-adapters/codex-adapter
node adapter.js convert-skill skills/react-19-skill/SKILL.md react-19.json
node adapter.js generate-tools skills/ tools.json
node adapter.js generate-proxy proxy.js  # Inicia proxy en puerto 3000
```

---

### 6. Windsurf ✅

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

- Misma detección (`enhanced-detect.ps1`)
- Mismo pre-procesamiento (`pre-process-input.ps1`)
- Misma carga de configuración (`tool-{herramienta}.json`)

**Capacidades**: ⚠️ VARÍAN | Herramienta | MCP | Skills | Multi-Agent | Format Adapter |
|-------------|-----|--------|------------|----------------| | OpenCode | ✅ | ✅ | ✅ | - | |
Cursor | ✅ | ✅ | ⚠️ Limitado | - | | VS Code | ✅ | ✅ | ⚠️ Limitado | - | | Cline | ✅ | ✅ | ⚠️
Limitado | - | | Antigravity | - | ⚠️ Via converter | ✅ Completo | ✅ | | Codex | - | ⚠️ Via
converter | ⚠️ | ✅ | | Windsurf | - | ⚠️ Via converter | ⚠️ | ✅ |

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
│   └── tool-windsurf.json           # ✅ Config Windsurf
├── scripts/utilities/
│   ├── pre-process-input.ps1        # ✅ Pre-procesamiento (integrado)
│   └── session-autostart.cmd        # ✅ Inicio de sesión
└── orchestrator.json                # ✅ Config orquestador (8 herramientas)
```

---

## Pendientes

1. ⏳ **MCP Bridge server**: Implementar servidor MCP completo
2. ⏳ **Pruebas end-to-end**: Con cada herramienta real
3. ⏳ **Documentación detallada**: Guías por herramienta
4. ⏳ **Optimización**: Mejorar rendimiento en detección

---

**Versión**: 1.0.0  
**Estado**: Adaptadores completos, integración lista para pruebas  
**Compatibilidad**: 8 herramientas soportadas
