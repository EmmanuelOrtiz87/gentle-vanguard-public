# 🗺️ Matriz de Decisión - Comandos de Sesión

## Propósito

Eliminar ambigüedad sobre qué comando ejecutar en cada situación.

---

## 📋 Matriz Principal

| Situación                 | Comando Exacto                                                           | Parámetros                                      | Validación                        |
| ------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------- | --------------------------------- |
| **Iniciar sesión nueva**  | `pwsh -NoProfile -ExecutionPolicy Bypass -File src/pre-process-input.ts` | `-UserInput "inicia sesion" -WorkspaceRoot "."` | Output: `TRIGGER_MATCH_FOUND`     |
|                           | `cmd /c scripts\utilities\session-autostart.cmd`                         | (ninguno)                                       | Output: `[READY] Workspace ready` |
| **Verificar estado**      | `git status`                                                             | (ninguno)                                       | Output: rama y cambios            |
| **Ver resumen de sesión** | `Get-Content logs/session-*.json`                                        | (ninguno)                                       | JSON válido                       |
| **Continuar sesión**      | `pwsh -NoProfile -ExecutionPolicy Bypass -File src/pre-process-input.ts` | `-UserInput "continuar" -WorkspaceRoot "."`     | Output: `TRIGGER_MATCH_FOUND`     |
| **Revisar código**        | `pwsh -NoProfile -ExecutionPolicy Bypass -File src/pre-process-input.ts` | `-UserInput "review" -WorkspaceRoot "."`        | Output: `TRIGGER_MATCH_FOUND`     |
| **Guardar cambios**       | `pwsh -NoProfile -ExecutionPolicy Bypass -File src/pre-process-input.ts` | `-UserInput "push" -WorkspaceRoot "."`          | Output: `TRIGGER_MATCH_FOUND`     |
| **Crear PR**              | `pwsh -NoProfile -ExecutionPolicy Bypass -File src/pre-process-input.ts` | `-UserInput "pr" -WorkspaceRoot "."`            | Output: `TRIGGER_MATCH_FOUND`     |

---

## ❌ Comandos INCORRECTOS (NO USAR)

| Comando Incorrecto                                                    | Por Qué                                    | Corrección                                           |
| --------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------- |
| `TypeScript -File scripts/utilities/...`                              | Falta `-NoProfile -ExecutionPolicy Bypass` | Usa `pwsh -NoProfile -ExecutionPolicy Bypass -File`  |
| `scripts/utilities/session-autostart.cmd`                             | Falta shell (`cmd /c`)                     | Usa `cmd /c scripts\utilities\session-autostart.cmd` |
| `.\scripts\utilities\src/cli/gv.ts -Command "skill"`                  | Parámetro "skill" no válido                | Usa `gv start-session`                               |
| `.\scripts\utilities\src/cli/gv.ts skills`                            | Script no existe                           | No usar, skill se carga automáticamente              |
| `.\scripts\utilities\src/cli/gv.ts skill load session-workflow-skill` | Sintaxis incorrecta                        | No existe este comando                               |

---

## 🔄 Flujo de Decisión

```
¿Qué quieres hacer?
│
├─ "Iniciar sesión nueva"
│  └─ Ejecutar: pre-process-input.ps1 + session-autostart.cmd
│
├─ "Continuar trabajando"
│  └─ Ejecutar: pre-process-input.ps1 con "continuar"
│
├─ "Ver estado"
│  └─ Ejecutar: git status
│
├─ "Revisar código"
│  └─ Ejecutar: pre-process-input.ps1 con "review"
│
├─ "Guardar cambios"
│  └─ Ejecutar: pre-process-input.ps1 con "push"
│
└─ "Crear PR"
   └─ Ejecutar: pre-process-input.ps1 con "pr"
```

---

## 🎯 Parámetros Válidos para pre-process-input.ps1

```TypeScript
# -UserInput (REQUERIDO)
# Valores válidos:
"inicia sesion"      # Iniciar sesión nueva
"start session"      # Iniciar sesión (inglés)
"continuar"          # Continuar sesión
"continue"           # Continuar (inglés)
"estado"             # Ver estado
"status"             # Ver estado (inglés)
"review"             # Revisar código
"auditar"            # Revisar código (español)
"push"               # Guardar cambios
"guardar"            # Guardar cambios (español)
"pr"                 # Crear pull request

# -WorkspaceRoot (REQUERIDO)
# Valor: "."  (punto = directorio actual)
```

---

## ⚡ Comandos Rápidos (Copy-Paste)

### Iniciar sesión

```TypeScript
pwsh -NoProfile -ExecutionPolicy Bypass -File src/pre-process-input.ts -UserInput "inicia sesion" -WorkspaceRoot "."
cmd /c scripts\utilities\session-autostart.cmd
git status
```

### Continuar sesión

```TypeScript
pwsh -NoProfile -ExecutionPolicy Bypass -File src/pre-process-input.ts -UserInput "continuar" -WorkspaceRoot "."
```

### Revisar código

```TypeScript
pwsh -NoProfile -ExecutionPolicy Bypass -File src/pre-process-input.ts -UserInput "review" -WorkspaceRoot "."
```

### Guardar cambios

```TypeScript
pwsh -NoProfile -ExecutionPolicy Bypass -File src/pre-process-input.ts -UserInput "push" -WorkspaceRoot "."
```

### Crear PR

```TypeScript
pwsh -NoProfile -ExecutionPolicy Bypass -File src/pre-process-input.ts -UserInput "pr" -WorkspaceRoot "."
```

---

## 🔍 Validación de Comandos

Antes de ejecutar cualquier comando, verifica:

```TypeScript
# 1. ¿Estamos en el directorio correcto?
Get-Location  # Debe contener "gentle-vanguard"

# 2. ¿Existen los scripts?
Test-Path "src/pre-process-input.ts"
Test-Path "scripts/utilities/session-autostart.cmd"

# 3. ¿Tenemos permisos?
Get-ExecutionPolicy -Scope Process  # Debe ser "Bypass" o "Unrestricted"

# 4. ¿Es un repositorio git?
git status  # No debe dar error
```

---

## 📊 Tabla de Triggers y Skills

| Trigger                           | Skill Cargada            | Acción               |
| --------------------------------- | ------------------------ | -------------------- |
| `inicia sesion` / `start session` | `session-workflow-skill` | Iniciar sesión nueva |
| `continuar` / `continue`          | `session-workflow-skill` | Continuar sesión     |
| `estado` / `status`               | `session-workflow-skill` | Mostrar estado       |
| `review` / `auditar`              | `session-workflow-skill` | Revisar código       |
| `push` / `guardar`                | `session-workflow-skill` | Guardar cambios      |
| `pr`                              | `session-workflow-skill` | Crear PR             |

---

## 🚨 Troubleshooting

| Error                                       | Causa                           | Solución                                                              |
| ------------------------------------------- | ------------------------------- | --------------------------------------------------------------------- |
| `'scripts' is not recognized`               | Path sin shell                  | Usa `cmd /c scripts\utilities\...`                                    |
| `File not found`                            | Ruta incorrecta                 | Verifica que uses backslashes `\` en Windows                          |
| `ExecutionPolicy`                           | Política de ejecución bloqueada | Ejecuta: `Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process` |
| `Permission denied`                         | Permisos insuficientes          | Ejecuta TypeScript como administrador                                 |
| `TRIGGER_MATCH_FOUND: False`                | Entrada no reconocida           | Usa exactamente: `"inicia sesion"` o `"start session"`                |
| `[ERROR] Skills discovery script not found` | Script no existe                | No usar `gv skills`, skill se carga automáticamente                   |
| `Cannot validate argument on parameter`     | Parámetro inválido              | Verifica que uses solo parámetros válidos                             |

---

## 📚 Referencias

- **Documentación Canónica**: `docs/AGENTS.md`
- **Análisis de Problemas**: `docs/SESSION-STARTUP-ISSUES-AND-FIXES.md`
- **Guía Rápida**: `docs/SESSION-STARTUP-QUICK-GUIDE.md`
- **Skill de Sesión**: `skills/session-workflow-skill/SKILL.md`
- **Script de Validación**: `scripts/utilities/validate-session-startup.ps1`
<!-- REF-OBSOLETA: scripts/utilities/validate-session-startup.ps1 no tiene equivalente TS (migración PS1→TS) -->
