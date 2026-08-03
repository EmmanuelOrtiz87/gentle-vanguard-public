# Testing Guide - Automated Test Suite

## Visin General

Este documento describe la suite de testing automatizado para gentle-vanguard.

**Versin**: 1.0.0 **Fecha**: 2026-04-21 **Estado**: ACTIVO

---

## Tipos de Tests

### 1. Unit Tests

**Ubicacin**: `tests/unit/*.tests.ps1` **Framework**: Pester **Propsito**: Verificar funciones
individuales

**Cobertura**:

- Engram Memory Manager
- Dynamic Optimizer
- AI Tool Detector
- Cleanup Project

### 2. Integration Tests

**Ubicacin**: `tests/integration/*.integration.tests.ps1` **Framework**: Pester **Propsito**:
Verificar interaccin entre componentes

**Cobertura**:

- Workflows end-to-end
- Integracin Engram-Orquestador
- Consolidacin automtica

### 3. Performance Tests

**Ubicacin**: `tests/performance/*.perf.tests.ps1` **Framework**: Pester **Propsito**: Verificar
rendimiento

**Thresholds**:

- Engram creation: <50ms
- Consolidation: <100ms
- Compression: <200ms
- Optimization: <150ms

### 4. Security Tests

**Ubicacin**: `tests/security/*.security.tests.ps1` **Framework**: Pester **Propsito**: Verificar
seguridad

**Cobertura**:

- Validacin de entrada
- Manejo de errores
- Encriptacin
- Acceso a archivos

---

## Ejecutar Tests

### Todos los Tests

```TypeScript
.\scripts\testing\run-tests.ps1 -TestType all -GenerateReport
```

### Solo Unit Tests

```TypeScript
.\scripts\testing\run-tests.ps1 -TestType unit
```

### Solo Integration Tests

```TypeScript
.\scripts\testing\run-tests.ps1 -TestType integration
```

### Solo Performance Tests

```TypeScript
.\scripts\testing\run-tests.ps1 -TestType performance
```

### Solo Security Tests

```TypeScript
.\scripts\testing\run-tests.ps1 -TestType security
```

---

## configuración

**Archivo**: `config/testing.config.json`

### Parmetros Principales

```json
{
  "testCoverage": {
    "minimumThreshold": 0.8,
    "targetThreshold": 0.9
  },
  "cicd": {
    "runOnCommit": true,
    "runOnPR": true,
    "failOnCoverageLow": true
  }
}
```

---

## Integracin CI/CD

### Pre-Commit Hook

```bash
# Ejecuta unit tests antes de commit
git hook pre-commit: run-tests.ps1 -TestType unit
```

### Pre-Push Hook

```bash
# Ejecuta todos los tests antes de push
git hook pre-push: run-tests.ps1 -TestType all
```

### Pull Request

```bash
# Ejecuta tests en cada PR
CI/CD: run-tests.ps1 -TestType all -GenerateReport
```

---

## Reportes

### Ubicacin

- Resultados: `test-results/`
- Cobertura: `coverage/`

### Formatos

- Console (salida en pantalla)
- JSON (datos estructurados)
- HTML (reporte visual)
- JUnit (compatible con CI/CD)

### Generacin

```TypeScript
.\scripts\testing\run-tests.ps1 -GenerateReport
```

---

## Mejores Prcticas

### Hacer

- [x] Escribir tests para nuevas funciones
- [x] Mantener cobertura >80%
- [x] Ejecutar tests antes de commit
- [x] Revisar reportes de cobertura
- [x] Actualizar tests con cambios

### No Hacer

- [ ] Saltarse tests
- [ ] Reducir cobertura
- [ ] Ignorar fallos
- [ ] Hardcodear valores
- [ ] Dejar tests pendientes

---

## Troubleshooting

### Problema: Tests no se encuentran

**Solucin**: Verificar estructura de directorios

```
tests/
 unit/
 integration/
 performance/
 security/
```

### Problema: Pester no instalado

**Solucin**: Instalar mdulo

```TypeScript
Install-Module -Name Pester -Force
```

### Problema: Tests fallan

**Solucin**: Revisar logs

```TypeScript
.\scripts\testing\run-tests.ps1 -LogLevel debug
```

---

## Prximos Pasos

- [ ] Agregar ms tests de cobertura
- [ ] Implementar load testing
- [ ] Agregar security scanning
- [ ] Integrar con SonarQube
- [ ] Crear dashboard de tests

---

## Referencias

- `config/testing.config.json` - configuración
- `scripts/testing/run-tests.ps1` - Test runner
- `tests/unit/` - Unit tests
- `tests/integration/` - Integration tests
