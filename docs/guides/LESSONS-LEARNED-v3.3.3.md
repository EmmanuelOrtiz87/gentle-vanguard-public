# Lecciones Aprendidas — Release v3.3.3

## Resumen

Release 3.3.3 (patch) enfocado en eliminar falsos warnings del Maintenance Watchtower,
actualizar el stack completo (v4.0 pipeline, dashboard, cloud connectors) y sincronizar
el repo público con el nuevo installer.

## Lo que salió bien

### 1. Watchtower check inteligente

**Problema**: El watchdog del dashboard WS no siempre corre (es opcional cuando el WS está
vivo), pero el watchtower reportaba WARN si el PID file no existía.

**Solución**: El check ahora evalúa el estado real del WS. Si responde OK en el puerto,
reporta PASS aunque no haya watchdog. Solo WARN si el WS está caído Y no hay watchdog.

**Archivo**: `src/core/maintenance-watchtower.ts` — función `Check-DashboardWs`,
línea 142: `} elseif ($httpOk -or $running) {`

### 2. Autoheal seguro

**Problema**: El autoheal intentaba reiniciar `dashboard-ws-autostart.ps1` aunque el WS
ya estuviera corriendo, causando conflictos de puerto y procesos duplicados.

**Solución**: El autoheal ahora verifica si el WS está vivo en el puerto antes de actuar.
Si está vivo, registra PASS y no hace nada. Solo reinicia si el WS está realmente caído.

### 3. Build pipeline reproducible

**Proceso completo verificado**:
- `protect-gentle-vanguard.ps1` → 411 scripts encriptados (AES-256), 110 skill stubs
- `create-installer.ps1` → ps2exe + NSIS → `dist/Gentle-Vanguard.exe` (29.93 MB)
- Integridad: 747 hashes SHA256 en el manifest

### 4. Sync a público sin fricción

`sync-to-public.ps1` sincronizó exitosamente a 9 ramas del repo público (develop, main,
7 dependabot). El VERSION 3.3.3 y el CHANGELOG se reflejan correctamente.

## Áreas de mejora

### 1. npm-audit en pre-push hook

El hook `npm-audit` falla con error de parsing JSON. No bloquea el push pero genera
ruido. Posible causa: el `package.json` raíz no tiene dependencias reales (solo
devDependencies), y npm audit espera un lockfile.

**Acción pendiente**: Evaluar si deshabilitar el hook o configurarlo para ignorar
el error. Prioridad: baja (no bloqueante).

### 2. package.json raíz desincronizado

El `package.json` raíz estaba en 3.3.0 cuando el VERSION file marcaba 3.3.2. Esto
sugiere que el bump manual previo omitió actualizar este archivo.

**Lección**: Incluir `package.json` raíz y de dashboard en el checklist de release
para verificar consistencia de versiones.

### 3. releases/ en .gitignore

Los `.exe` están en `.gitignore` (`.gitignore:*.exe`), por lo que `releases/` no se
commitea. El installer oficial es `dist/Gentle-Vanguard.exe` que se copia al público
vía `sync-to-public.ps1`. Releases locales son solo archive.

**Lección**: Documentar explícitamente que `releases/` es local y `dist/Gentle-Vanguard.exe`
es el artifact canónico.

## Métricas del release

| Métrica | Valor |
|---|---|
| Versión | 3.3.3 |
| Tipo | Patch |
| Archivos commiteados | 48 |
| Scripts encriptados | 411 |
| Skill stubs públicos | 110 |
| Hashes integridad | 747 |
| Installer size | 29.93 MB |
| Watchtower PASS | 74/74 (0 WARN, 0 FAIL) |
| Ramas público sincronizadas | 9 |

## Próximos pasos

1. Monitorear que el watchtower se mantenga en 74/74 PASS
2. Evaluar fix del hook npm-audit (baja prioridad)
3. Para v3.4.0: planificar features mayores (si aplica)
