# Testing Determinista para Agentes

**Basado en:**
[gentle-ai testing-agents-deterministically](https://github.com/Gentleman-Programming/gentle-ai/blob/main/docs/testing-agents-deterministically.md)

---

## ¿Qué es el Testing Determinista?

El testing determinista permite probar el orquestador con un "modelo fixture" que devuelve
respuestas scripteadas en lugar de llamar a una API de LLM real. Esto hace que los tests sean:

- **Gratuitos** — sin costo de tokens
- **Offline** — sin dependencia de red
- **Deterministas** — misma secuencia siempre
- **Rápidos** — milisegundos en lugar de segundos

---

## El Problema que Resuelve

Los tests tradicionales con LLM reales tienen problemas:

| Problema               | Impacto                                     |
| ---------------------- | ------------------------------------------- |
| **No-determinismo**    | Misma instrucción, diferentes tool calls    |
| **Costo por token**    | Cada push, cada PR, cada plataforma         |
| **Dependencia de red** | Rate limits y outages hacen fallar CI       |
| **Secrets**            | API keys en CI son objetivo de exfiltración |

Un test con estas propiedades eventualmente se desactiva.

---

## Implementación en Gentle-Vanguard

### Arquitectura

```
┌─────────────────┐     POST /v1/chat/completions     ┌─────────────────┐
│   Orquestador   │ ─────────────────────────────────► │  Model Fixture  │
│   (real)        │                                    │  (scripteado)   │
│                 │ ◄───────────────────────────────── │                 │
└─────────────────┘     Respuesta con tool calls       └─────────────────┘
         │
         ▼
┌─────────────────┐
│  Validación de  │
│  requests       │
└─────────────────┘
```

### Componentes

| Componente  | Archivo                               | Descripción                          |
| ----------- | ------------------------------------- | ------------------------------------ |
| Framework   | `src/deterministic-test-framework.ts` | Servidor HTTP fixture + runner       |
| Escenarios  | `SCENARIOS` object                    | Secuencias scripteadas de tool calls |
| Validadores | `validate` functions                  | Verifican requests del agente        |

---

## Escenarios de Prueba

### 1. Direct Inline (`direct-inline`)

**Propósito:** Verificar que la ruta `direct_inline` se mantiene inline sin crear artefactos SDD.

```bash
npx tsx src/deterministic-test-framework.ts --scenario direct-inline
```

**Secuencia:**

1. `bash.capabilities` — Consulta capacidades
2. `bash.execute` — Ejecuta tarea directamente

**Validación:** No se crean artefactos SDD.

---

### 2. Delegated Direct (`delegated-direct`)

**Propósito:** Verificar ruta `delegated_direct` sin ciclo de vida SDD.

```bash
npx tsx src/deterministic-test-framework.ts --scenario delegated-direct
```

**Secuencia:**

1. `bash.capabilities` — Consulta capacidades
2. `task.delegate` — Delega a sub-agente
3. `bash.verify` — Verifica resultado

---

### 3. SDD Lifecycle (`sdd-lifecycle`)

**Propósito:** Verificar ciclo completo BA→SAD→DEV→QA.

```bash
npx tsx src/deterministic-test-framework.ts --scenario sdd-lifecycle
```

**Secuencia:**

1. `bash.sdd-start` — Inicia sesión SDD
2. `task.ba-explore` — Fase de exploración
3. `task.sad-design` — Fase de diseño
4. `task.dev-implement` — Fase de implementación
5. `task.qa-verify` — Fase de verificación
6. `bash.sdd-complete` — Completa SDD

---

### 4. Kill Switch (`kill-switch`)

**Propósito:** Verificar que el kill switch detiene el flujo antes de avanzar.

```bash
npx tsx src/deterministic-test-framework.ts --scenario kill-switch
```

**Secuencia:**

1. `bash.capabilities` — Consulta capacidades
2. `bash.check-kill-switch` — Verifica kill switch (bloqueado)

---

## Uso

### Listar escenarios disponibles

```bash
npx tsx src/deterministic-test-framework.ts --list
```

### Ejecutar un escenario

```bash
npx tsx src/deterministic-test-framework.ts --scenario <nombre>
```

### Integración en CI

```yaml
# .github/workflows/deterministic-tests.yml
name: Deterministic Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Run deterministic tests
        run: |
          npx tsx src/deterministic-test-framework.ts --scenario direct-inline
          npx tsx src/deterministic-test-framework.ts --scenario delegated-direct
          npx tsx src/deterministic-test-framework.ts --scenario sdd-lifecycle
          npx tsx src/deterministic-test-framework.ts --scenario kill-switch
```

---

## Cómo Funciona

### El Model Fixture

Es un servidor HTTP que:

1. Escucha en un puerto local aleatorio
2. Expone endpoint `/v1/chat/completions` compatible con OpenAI
3. Responde con tool calls scripteadas según el contador de llamadas
4. Valida requests antes de responder

### Validación de Requests

Cada call puede incluir una función `validate`:

```typescript
{
  tool: 'bash',
  action: 'execute',
  response: { status: 'ok' },
  validate: (request) => {
    // Verificar condiciones
    if (!request.messages?.length) {
      return 'No messages in request';
    }
    return true; // Pass
  }
}
```

### Secuencia Scripteada

El fixture mantiene un contador de llamadas y responde con la tool call correspondiente:

```
Call #1 → tool: bash, action: capabilities
Call #2 → tool: bash, action: execute
Call #3 → tool: task, action: delegate
...
```

---

## Por Qué es Gratuito

La distinción clave:

| Componente     | Costo | Detalle                     |
| -------------- | ----- | --------------------------- |
| **Agente**     | $0    | Programa local (como `git`) |
| **Modelo API** | $$$   | HTTP call a vendor          |

El fixture intercepta la llamada:

```
Antes: Agente ──POST──▶ Vendor API ($$$)
Después: Agente ──POST──▶ 127.0.0.1 ($0)
```

El agente hace todo el trabajo real. Solo cambia el destino de su request de razonamiento.

---

## Ventajas

| Ventaja          | Descripción                                                         |
| ---------------- | ------------------------------------------------------------------- |
| **Gratuito**     | Sin costo de tokens, ejecutable cualquier cantidad de veces         |
| **Offline**      | Sin dependencia de red, funciona en runners aislados                |
| **Determinista** | Misma secuencia siempre, un fallo significa que el código se rompió |
| **Sin secrets**  | Solo necesita `GITHUB_TOKEN` que Actions provee                     |
| **Rápido**       | Milisegundos de latencia en lugar de minutos                        |

---

## Limitaciones

**No prueba:** Que un modelo real, dado el prompt, produzca las mismas tool calls que el fixture.

**Ese salto es no-determinista por naturaleza** y no pertenece a un merge gate; se cubre con uso
real y tests de paridad de adapters.

---

## Referencias

- [gentle-ai testing-agents-deterministically](https://github.com/Gentleman-Programming/gentle-ai/blob/main/docs/testing-agents-deterministically.md)
- [gentle-ai v2.1.11 release](https://github.com/Gentleman-Programming/gentle-ai/releases/tag/v2.1.11)
- `src/deterministic-test-framework.ts` — Implementación
