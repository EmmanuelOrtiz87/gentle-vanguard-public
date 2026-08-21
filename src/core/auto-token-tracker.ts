/**
 * auto-token-tracker.ts — Tracking automático de tokens para integración manual
 *
 * USO: Importar este módulo en el punto de entrada de la aplicación para
 * comenzar a trackear tokens automáticamente.
 *
 * Ejemplo de integración en el código principal:
 *   import './auto-token-tracker'; // Al inicio de tu app
 *
 * O de forma más explícita:
 *   import { enableAutoTracking } from './auto-token-tracker';
 *   enableAutoTracking();
 */

import { trackTokenUsage, trackFeedback } from './session-metrics-tracker';

// Session ID actual (obtenido del environment o generado)
const SESSION_ID =
  process.env.SESSION_ID || process.env.OPEN_CODE_SESSION_ID || `manual-${Date.now()}`;

/**
 * Habilita el tracking automático de tokens
 *
 * Esto intercepta console.log para detectar cuando se usan herramientas
 * y estima tokens basado en la salida.
 *
 * NOTA: Esto es una aproximación. Para tracking preciso, usar la API real del LLM.
 */
export function enableAutoTracking(): void {
  console.log('[AutoTokenTracker] Tracking habilitado para session:', SESSION_ID);

  const originalLog = console.log;

  // Interceptar logs para detectar uso de herramientas
  console.log = (...args: unknown[]) => {
    const message = args.join(' ');

    // Detectar patrones de uso de herramientas
    if (message.includes('[bash]') || message.includes('Tool: bash')) {
      recordToolUsage('bash', 100, 50); // Estimación
    } else if (message.includes('[read]') || message.includes('Tool: read')) {
      recordToolUsage('read', 150, 100); // Estimación
    } else if (message.includes('[edit]') || message.includes('Tool: edit')) {
      recordToolUsage('edit', 80, 40); // Estimación
    } else if (message.includes('[write]') || message.includes('Tool: write')) {
      recordToolUsage('write', 90, 45); // Estimación
    }

    // Llamar al log original
    originalLog.apply(console, args);
  };

  // Tracking periódico
  setInterval(() => {
    void process.memoryUsage(); // Tracking de memoria
    // Los tokens reales no están disponibles desde dentro del proceso
  }, 30000); // Cada 30 segundos
}

/**
 * Registra un evento de métrica manualmente
 */
export function recordToolUsage(
  toolName: string,
  inputTokens: number,
  outputTokens: number,
  latencyMs: number = 0,
): void {
  const cost = estimateCost(inputTokens + outputTokens);

  trackTokenUsage(SESSION_ID, inputTokens, outputTokens, latencyMs, cost);

  console.log(
    `[AutoTokenTracker] ${toolName}: +${inputTokens + outputTokens} tokens (~$${cost.toFixed(4)})`,
  );
}

/**
 * Registra feedback del usuario
 */
export function recordUserFeedback(type: 'up' | 'down'): void {
  trackFeedback(SESSION_ID, type === 'up' ? 'thumbs_up' : 'thumbs_down');
  console.log(`[AutoTokenTracker] Feedback: ${type}`);
}

/**
 * Estima el costo basado en tokens
 */
function estimateCost(totalTokens: number): number {
  // Precio aproximado: $0.003 por 1K tokens (Claude Sonnet)
  return (totalTokens / 1000) * 0.003;
}

// Auto-habilitar si se importa directamente
if (process.env.ENABLE_AUTO_TRACKING === 'true') {
  enableAutoTracking();
}

// Exportar para uso explícito
export { SESSION_ID };
