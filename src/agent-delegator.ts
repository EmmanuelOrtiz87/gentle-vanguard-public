import { pathToFileURL } from 'url';
/**
 * Agent Delegator - Entry Point
 * 
 * Este archivo es el punto de entrada principal para el sistema de delegación
 * de agentes. Re-exporta la implementación real desde orchestration.
 * 
 * NOTA: La implementación real vive en src/orchestration/agent-delegator.ts
 * Este archivo actúa como wrapper para mantener compatibilidad con documentación
 * y scripts que esperan la ruta src/agent-delegator.ts
 */

// Re-exportar todo desde la implementación real
export * from './orchestration/agent-delegator.js';

// Script CLI - ejecutar si se invoca directamente
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { main } = await import('./orchestration/agent-delegator.js');
  void main();
}
