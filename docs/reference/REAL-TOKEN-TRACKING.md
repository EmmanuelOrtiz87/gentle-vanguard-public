# Real Token Tracking Integration Guide

## Overview

Gentle-Vanguard ahora soporta **Real Token Tracking** integrando los tokens reales de las APIs del
AI (OpenAI, Anthropic, etc.) en el token-budget-guard.

## What Changed

### 1. token-budget-guard.ps1 (scripts/utilities/TELEMETRY-METRICS/)

Nuevos parámetros:

- `-ActualPromptTokens`: Tokens reales usados en el prompt (desde `$usage.prompt_tokens`)
- `-ActualCompletionTokens`: Tokens reales usados en la completción (desde
  `$usage.completion_tokens`)

Estos reemplazan el estimado basado en caracteres cuando están disponibles.

### 2. src/cli/gv.ts (scripts/utilities/WORKFLOW-ORCHESTRATION/)

Actualizado `Invoke-TokenBudgetGuard` para aceptar y pasar tokens reales:

```TypeScript
function Invoke-TokenBudgetGuard {
    param(
        [string]$Task,
        [string]$Risk = 'medium',
        [int]$EstimatedChars = 0,
        [int]$ActualPromptTokens = 0,
        [int]$ActualCompletionTokens = 0
    )
    # ... passes ActualPromptTokens and ActualCompletionTokens to token-budget-guard.ps1
}
```

### 3. session-autostart.ps1

Actualizado para inicializar con tokens reales (ejemplo):

```TypeScript
& $tokenGuard -Task "session-start" -Risk "low" -Record `
    -ActualPromptTokens 0 -ActualCompletionTokens 0
```

## How to Integrate Real Tokens

### Para desarrolladores de skills/herramientas:

Cuando uses una API de AI y obtengas una respuesta con `usage`:

```TypeScript
$response = Invoke-RestMethod -Uri "https://api.openai.com/v1/chat/completions" `
    -Headers @{ Authorization = "Bearer $apiKey" } `
    -Body $body -ContentType "application/json"

if ($response.usage) {
    $promptTokens = $response.usage.prompt_tokens
    $completionTokens = $response.usage.completion_tokens

    # Record in token budget guard
    $guardScript = "src/telemetry/token-budget-guard.ts"
    & $guardScript -Task "your-task" -Risk "medium" -Record `
        -ActualPromptTokens $promptTokens -ActualCompletionTokens $completionTokens
}
```

### Para el Engine (src/cli/gv.ts):

El engine ahora acepta tokens reales como parámetros adicionales:

```TypeScript
gv context-pack -ActualPromptTokens 1500 -ActualCompletionTokens 800
```

## Backward Compatibility

- Si no se proporcionan tokens reales, el sistema usa estimaciones basadas en caracteres
  (compatibilidad hacia atrás)
- Tokens reales = 0 se manejan correctamente (no sobrescriben estimaciones)
- Formato CSV actualizado:
  `timestamp,date,task,risk,estimated_tokens,actual_prompt,actual_completion,actual_total,status,engram_available,notes`

## Next Steps

1. Integrar en skills que usan AI APIs (anthropic, openai, etc.)
2. Actualizar `session-autostart.ps1` para capturar tokens reales de respuestas
3. Crear dashboard de tokens reales vs estimados
