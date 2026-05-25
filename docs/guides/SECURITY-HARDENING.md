# Security Hardening Guide

## Visión General

Este documento describe las medidas de seguridad implementadas en gentle-vanguard.

**Versión**: 1.0.0 **Fecha**: 2026-04-21 **Estado**: IMPLEMENTADO

---

## Medidas de Seguridad Implementadas

### 1. Encriptación AES-256

**Archivo**: `scripts/security/encryption-manager.ps1`

**Características**:

- Encriptación AES-256 CBC
- Generación segura de claves con
  `[System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)`
- Generación idempotente: no sobrescribe claves existentes
- Almacenamiento seguro de claves
- Validación de integridad
- CLI dispatch vía `-Action` parameter

**Uso**:

```powershell
# Generar clave
.\scripts\security\encryption-manager.ps1 -Action generate-key

# Encriptar datos
.\scripts\security\encryption-manager.ps1 -Action encrypt -Data "sensitive"

# Desencriptar datos
.\scripts\security\encryption-manager.ps1 -Action decrypt -Data "encrypted"

# Validar Encriptación
.\scripts\security\encryption-manager.ps1 -Action validate
```

### 2. Validación de Entrada

**Archivo**: `scripts/security/input-validator.ps1`

**Tipos de Validación**:

- String: Longitud, caracteres especiales
- Integer: Rango, tipo
- Path: Traversal, rutas absolutas
- Command: Inyección de comandos
- Email: Formato vlido

**Uso**:

```powershell
# Validar string
.\scripts\security\input-validator.ps1 -Input "test" -Type string

# Validar entero
.\scripts\security\input-validator.ps1 -Input "250" -Type integer

# Validar ruta
.\scripts\security\input-validator.ps1 -Input ".\config\test.json" -Type path

# Validar comando
.\scripts\security\input-validator.ps1 -Input "test-command" -Type command

# Validar email
.\scripts\security\input-validator.ps1 -Input "user@example.com" -Type email
```

### 3. Gestin de Secretos

**Archivo**: `scripts/security/secrets-manager.ps1`

**Características**:

- Almacenamiento en variables de entorno
- Rotacin automtica de secretos
- Validación de configuración
- Auditoría de acceso

**Uso**:

```powershell
# Establecer secreto
.\scripts\security\secrets-manager.ps1 -Action set -SecretName "API_KEY" -SecretValue "secret123"

# Obtener secreto
.\scripts\security\secrets-manager.ps1 -Action get -SecretName "API_KEY"

# Listar secretos
.\scripts\security\secrets-manager.ps1 -Action list

# Rotar secretos
.\scripts\security\secrets-manager.ps1 -Action rotate

# Validar secretos
.\scripts\security\secrets-manager.ps1 -Action validate
```

### 4. Logging de Seguridad

**Archivo**: `scripts/security/security-logger.ps1`

**Tipos de Eventos**:

- access: Acceso a recursos
- modification: Cambios de datos
- deletion: Eliminación de datos
- error: Errores del sistema
- warning: Advertencias
- info: Información general

**Uso**:

```powershell
# Registrar evento de acceso
.\scripts\security\security-logger.ps1 -EventType access -Message "User accessed config" -Severity low

# Registrar evento de Modificación
.\scripts\security\security-logger.ps1 -EventType modification -Message "Config modified" -Severity medium

# Registrar evento de error
.\scripts\security\security-logger.ps1 -EventType error -Message "Authentication failed" -Severity high

# Generar reporte de seguridad
.\scripts\security\security-logger.ps1 -Action report

# Detectar Anomalías
.\scripts\security\security-logger.ps1 -Action anomalies
```

---

## Tests de Seguridad

**Archivo**: `tests/security/input-validation.security.tests.ps1`

**Cobertura**:

- Sanitizacin de entrada
- Validación de tipos
- Validación de rangos
- Validación de strings
- Validación de rutas
- Prevencin de Inyección
- Integridad de datos
- Manejo de errores
- Control de acceso
- Validación de Encriptación
- Logging de seguridad

**Ejecutar tests**:

```powershell
.\scripts\testing\run-tests.ps1 -TestType security
```

---

## Checklist de Seguridad

### Encriptación

- [x] AES-256 implementado
- [x] Generación segura de claves
- [x] Almacenamiento seguro
- [x] Validación de integridad

### Validación

- [x] Sanitizacin de entrada
- [x] Validación de tipos
- [x] Prevencin de Inyección
- [x] Validación de rutas

### Secretos

- [x] Almacenamiento seguro
- [x] Rotacin automtica
- [x] Auditoría de acceso
- [x] Validación de configuración

### Logging

- [x] Auditoría de eventos
- [x] Detección de Anomalías
- [x] Reportes de seguridad
- [x] Retención de logs

---

## Mejores Prácticas

### Hacer

- [x] Usar Encriptación para datos sensibles
- [x] Validar toda entrada
- [x] Almacenar secretos en variables de entorno
- [x] Registrar eventos de seguridad
- [x] Rotar secretos regularmente
- [x] Revisar logs de seguridad
- [x] Ejecutar tests de seguridad

### No Hacer

- [ ] Hardcodear secretos
- [ ] Confiar en entrada sin validar
- [ ] Almacenar contraseas en texto plano
- [ ] Ignorar eventos de seguridad
- [ ] Usar Encriptación dbil
- [ ] Saltarse Validación de entrada
- [ ] Ignorar Anomalías detectadas

---

## configuración de Seguridad

### Archivo: `config/security-policy.json`

```json
{
  "encryption": {
    "algorithm": "AES-256",
    "keyLength": 256,
    "mode": "CBC",
    "padding": "PKCS7"
  },
  "validation": {
    "maxStringLength": 10000,
    "maxIntegerValue": 10000,
    "allowedPathChars": "a-zA-Z0-9.-_/\\"
  },
  "secrets": {
    "rotationInterval": 90,
    "requiredSecrets": ["API_KEY", "ENCRYPTION_KEY"],
    "storageMethod": "environment"
  },
  "logging": {
    "enabled": true,
    "retentionDays": 90,
    "auditTrail": true,
    "anomalyDetection": true
  }
}
```

---

## Monitoreo de Seguridad

### Generar Reporte de Seguridad

```powershell
.\scripts\security\security-logger.ps1 -Action report
```

### Detectar Anomalías

```powershell
.\scripts\security\security-logger.ps1 -Action anomalies
```

### Limpiar Logs Antiguos

```powershell
.\scripts\security\security-logger.ps1 -Action cleanup -RetentionDays 90
```

---

## Troubleshooting

### Problema: Encriptación falla

**Solución**: Verificar que la clave exista y sea vlida

```powershell
.\scripts\security\encryption-manager.ps1 -Action validate
```

### Problema: Validación rechaza entrada vlida

**Solución**: Revisar reglas de Validación en input-validator.ps1

### Problema: Secretos no se encuentran

**Solución**: Verificar que estn configurados

```powershell
.\scripts\security\secrets-manager.ps1 -Action list
```

### Problema: Logs no se generan

**Solución**: Verificar permisos de directorio

```powershell
Test-Path .\logs\security
```

---

## 5. NPX Supply-Chain Hardening

**Archivos Afectados**:

- `config/mcp-servers.json` - MCP server configuration
- `.npmrc` - Global npm security policy

**Threat Model**:

NPX supply-chain attacks leverage two vectors:

1. **Live registry fetching** - `npx -y @package` downloads latest version from npm registry on
   every invocation
2. **Post-install scripts** - Malicious packages execute arbitrary code during installation

**Mitigations Implemented**:

| Flag                          | Purpose                                          | Protection Against            |
| ----------------------------- | ------------------------------------------------ | ----------------------------- |
| `--offline`                   | Block all registry network requests at runtime   | Live registry poisoning       |
| `--no`                        | Refuse to execute packages not already installed | Compromised version downloads |
| `--workspace <dir>`           | Use pre-vetted lockfile-based installation       | Version drift/tampering       |
| `--include-workspace-root`    | Enable workspace resolution mode                 | Path traversal attacks        |
| `.npmrc: ignore-scripts=true` | Disable post-install lifecycle scripts globally  | Post-install code execution   |
| `.npmrc: min-release-age=3`   | 3-day cooldown on new packages                   | Zero-day exploitation window  |

**Setup Instructions (New Machine)**:

```powershell
# 1. Create isolated MCP workspace
mkdir $HOME\mcp-workspace
cd $HOME\mcp-workspace

# 2. Initialize with package-lock.json
npm init -y

# 3. Install pinned MCP server version
npm install @modelcontextprotocol/server-filesystem@2026.1.14 --save-exact

# 4. Verify lockfile created
Test-Path package-lock.json  # Must be True
Test-Path node_modules/@modelcontextprotocol/server-filesystem
```

**Current Configuration (mcp-servers.json)**:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "--include-workspace-root",
        "--workspace",
        "%USERPROFILE%\\mcp-workspace",
        "--no",
        "--offline",
        "@modelcontextprotocol/server-filesystem",
        "."
      ],
      "description": "File system access — offline hardened (npx supply-chain protection)",
      "security": {
        "hardened": true,
        "mode": "offline",
        "workspace": "%USERPROFILE%\\mcp-workspace",
        "pinnedVersion": "2026.1.14",
        "updateProcedure": "cd %USERPROFILE%\\mcp-workspace && npm update @modelcontextprotocol/server-filesystem && review package-lock.json changes before next use"
      }
    }
  }
}
```

**Global NPM Security Policy (.npmrc)**:

```ini
# npm Security Configuration — gentle-vanguard
# Hardened against supply chain attacks

# Disable post-install lifecycle scripts
ignore-scripts=true

# Minimum release age: skip packages < 3 days old
min-release-age=3

# Block git-based dependencies (requires npm CLI 11.10.0+)
allow-git=none
```

**Conscious Update Procedure**:

When updating MCP server version:

```powershell
cd $HOME\mcp-workspace

# 1. Review current version
npm list @modelcontextprotocol/server-filesystem

# 2. Check for vulnerabilities
npm audit

# 3. Update (respects min-release-age)
npm update @modelcontextprotocol/server-filesystem --save-exact

# 4. Review changes
git diff package-lock.json  # OR manually inspect changes
git add package-lock.json

# 5. Commit with security review
git commit -m "security(mcp): update @modelcontextprotocol/server-filesystem to vX.X.X

Reviewed: [list changes reviewed]
Vulnerabilities: [audit result]
"
```

**Verification Commands**:

```powershell
# Verify offline mode works (should NOT make network requests)
npx --include-workspace-root --workspace $HOME\mcp-workspace --no --offline @modelcontextprotocol/server-filesystem --version

# Verify .npmrc is loaded
npm config get ignore-scripts
npm config get min-release-age

# Audit current lockfile
npm audit --workspace $HOME\mcp-workspace
```

**Reference**: Based on `lirantal/npm-security-best-practices` Section 8: Harden npx Execution

---

## Referencias

- `scripts/security/encryption-manager.ps1` - Encriptación
- `scripts/security/input-validator.ps1` - Validación
- `scripts/security/secrets-manager.ps1` - Secretos
- `scripts/security/security-logger.ps1` - Logging
- `tests/security/input-validation.security.tests.ps1` - Tests
- `config/security-policy.json` - Políticas
- `config/mcp-servers.json` - MCP server hardening
- `.npmrc` - npm security policy

---

## Conclusión

El proyecto tiene implementadas todas las medidas de seguridad crticas:

Encriptación AES-256 Validación robusta de entrada Gestin segura de secretos Logging y Auditoría
completos Tests de seguridad Detección de Anomalías **NPX supply-chain hardening (offline +
workspace mode)**

**Estado**: LISTO PARA PRODUCCIN
