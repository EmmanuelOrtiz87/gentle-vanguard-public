# Project Cleanup Guide

## Visin General

Este documento describe cmo limpiar el proyecto de archivos temporales, logs, cachs y otros archivos
innecesarios.

**Versin**: 1.0.0 **Fecha**: 2026-04-21

---

## Tipos de Archivos a Limpiar

### 1. Archivos Temporales

**Extensiones**: `.tmp`, `.temp`, `.bak`, `.backup`

**Ubicacin**: Cualquier lugar en el proyecto

**Accin**: ELIMINAR

### 2. Archivos de Log

**Extensiones**: `.log`

**Ubicacin**: Cualquier lugar EXCEPTO `docs/judgment/`

**Accin**: ELIMINAR (solo en modo full)

### 3. Directorios de Cach

**Nombres**: `*cache*`, `__pycache__`, `.cache`

**Ubicacin**: Cualquier lugar en el proyecto

**Accin**: ELIMINAR

### 4. Archivos de Backup

**Patrones**: `*backup*`, `*.bak`

**Ubicacin**: Cualquier lugar en el proyecto

**Accin**: ELIMINAR

---

## Scripts de Limpieza

> **Nota**: El script legacy `cleanup-project.ps1` / `cleanup-project.sh` fue reemplazado por los
> comandos TypeScript del stack. La limpieza ahora se realiza con los comandos de pruning
> operacionales:

### Prune de Datos (Nexus DB)

```TypeScript
# Elimina datos antiguos: eventos >30d, cache >7d, token_usage >90d
npm run db:prune

# Mantener solo los 10 backups más recientes
npm run db:prune:backup
```

### Cleanup de Snapshots

```TypeScript
# Elimina snapshots antiguos (retención 7 días)
npx tsx src/snapshot-manager.ts --action cleanup
```

### Modos de Seguridad

#### Dry-Run (Verificación)

```TypeScript
# Mostrar qué se limpiaría sin eliminar nada
npm run db:health
```

#### Safe (Recomendado)

```TypeScript
# Limpieza de datos temporales/caché sin tocar logs
npm run db:prune
```

#### Full (Completo)

```TypeScript
# Limpieza completa + checkpoint WAL + VACUUM
npm run db:optimize
```

- Elimina datos vencidos según retention policy
- Verifica integridad de la base de datos
- No toca documentación, configs, ni scripts

---

## Archivos Protegidos

Los siguientes archivos/directorios NUNCA se eliminan:

### Directorios Protegidos

- `config/` - configuraciónes
- `scripts/utilities/` - Scripts
- `docs/` - Documentacin
- `skills/` - Skills
- `demos/` - Demos

### Archivos Protegidos

- `AGENTS.md` - Reglas del proyecto
- `README.md` - Documentacin principal
- Todos los archivos en `docs/judgment/` - Reportes de juicio

### Logs Protegidos

- `docs/judgment/*.md` - Reportes de juicio
- `docs/judgment/*.json` - Packs de juicio

---

## Procedimiento de Limpieza Recomendado

### Paso 1: Verificar con Dry-Run

```TypeScript
# Mostrar qué se limpiaría sin eliminar nada
npm run db:health
```

**Resultado**: Ver qu se limpiara sin eliminar nada

### Paso 2: Ejecutar Limpieza Safe

```TypeScript
# Prune datos vencidos (eventos, cache, token_usage)
npm run db:prune
```

**Resultado**: Datos vencidos eliminados sin perder logs importantes

### Paso 3: Verificar Integridad

```TypeScript
# Verificar integridad de la base de datos
npm run db:health
```

El comando verifica:

- Integridad SQLite
- Estado WAL
- Conteo de tablas y rows
- Estructura del proyecto intacta

---

## Qu Se Limpia en Cada Modo

### Dry-Run

- No elimina nada
- Muestra qu se limpiara
- Verifica integridad

### Safe (Recomendado)

- Archivos temporales (_.tmp,_.temp, _.bak,_.backup)
- Directorios de cach (_cache_)
- NO elimina logs
- Verifica integridad

### Full

- Archivos temporales
- Logs (excepto docs/judgment/)
- Directorios de cach
- Archivos de backup
- Verifica integridad

---

## Archivos Que NO Se Tocan

### Documentacin

- `docs/` - Todos los archivos
- `docs/judgment/` - Especialmente protegido
- `AGENTS.md`
- `README.md`

### configuración

- `config/` - Todos los archivos
- `config/*.json`

### Scripts

- `src/` - Todos los scripts TypeScript
- `scripts/` - Scripts de soporte (TS)
- `src/cli/` - CLI del stack

### Datos

- `skills/` - Todos los skills
- `demos/` - Todos los demos

---

## Verificacin de Integridad

Despus de limpiar, el script verifica:

### Directorios Requeridos

- [x] `config/` - Presente
- [x] `scripts/utilities/` - Presente
- [x] `docs/` - Presente
- [x] `skills/` - Presente
- [x] `demos/` - Presente

### Archivos Requeridos

- [x] `AGENTS.md` - Presente
- [x] `README.md` - Presente

### Resultado

- Si todo est bien: "Project is clean and ready"
- Si hay problemas: "Project integrity issues detected"

---

## Casos de Uso

### Caso 1: Limpiar Antes de Despliegue

```TypeScript
# Verificar qué se limpiará
npm run db:health

# Limpiar de forma segura
npm run db:prune

# Verificar resultado
npm run db:health
```

### Caso 2: Limpiar Completamente

```TypeScript
# Verificar qué se limpiará
npm run db:health

# Limpiar todo + optimizar
npm run db:prune
npm run db:optimize

# Verificar resultado
npm run db:health
```

### Caso 3: Limpiar Regularmente

```TypeScript
# Ejecutar limpieza segura regularmente (pipeline lazy step: db-prune)
npm run db:prune
```

---

## Troubleshooting

### Problema: "Project integrity issues detected"

**Causa**: Archivos requeridos fueron eliminados

**Solucin**:

1. Restaurar desde control de versiónes
2. Verificar que no se ejecut modo full innecesariamente

### Problema: Archivos no se eliminan

**Causa**: Permisos insuficientes

**Solucin**:

1. Ejecutar como administrador
2. Verificar permisos de archivo

### Problema: Dry-run muestra archivos pero safe no los elimina

**Causa**: Archivos protegidos o permisos

**Solucin**:

1. Verificar que no son archivos protegidos
2. Ejecutar con permisos elevados

---

## Mejores Prcticas

### Hacer

- [x] Ejecutar dry-run primero
- [x] Usar modo safe regularmente
- [x] Verificar integridad despus
- [x] Hacer backup antes de full
- [x] Documentar cambios

### No Hacer

- [ ] Ejecutar full sin verificar
- [ ] Eliminar docs/judgment/
- [ ] Eliminar archivos de configuración
- [ ] Ejecutar sin permisos
- [ ] Ignorar errores de integridad

---

## automatización

### Limpiar Regularmente

La limpieza ya está automatizada en la pipeline de sesión (step lazy `db-prune`):

**Windows (Task Scheduler)**:

```
Programa: cmd.exe
Argumentos: /c cd /d C:\path\to\project && npm run db:prune
Frecuencia: Diaria (después de horas de trabajo)
```

**Linux/macOS (Cron)**:

```bash
# Ejecutar limpieza diaria a las 22:00
0 22 * * * cd /path/to/project && npm run db:prune
```

---

## Conclusin

El script de limpieza proporciona:

Mltiples modos de seguridad Proteccin de archivos importantes Verificacin de integridad Logging
detallado automatización posible

**Recomendacin**: Ejecutar `safe` regularmente para mantener el proyecto limpio.

---

## Referencias

- `npm run db:prune` - Prune de datos vencidos (TS: `scripts/database/db-prune.ts`)
- `npm run db:optimize` - WAL checkpoint + REINDEX + VACUUM
- `npm run db:health` - Verificación de integridad de la base de datos
- `npx tsx src/snapshot-manager.ts --action cleanup` - Limpieza de snapshots
- `AGENTS.md` - Reglas del proyecto
