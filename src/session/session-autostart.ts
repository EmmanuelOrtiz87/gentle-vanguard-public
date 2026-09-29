#!/usr/bin/env node
/**
 * session-autostart.ts — Entry point for AGENTS.md compatibility
 *
 * The actual implementation lives at src/core/session-autostart.ts.
 * This file exists so the AGENTS.md command `npx tsx src/session/session-autostart.ts`
 * resolves correctly.
 *
 * AUTO-ACTIVACIÓN DEL CACHE:
 * Importa cache-hook-system automáticamente para que esté activo
 * sin necesidad de configuración manual.
 */

// AUTO-ACTIVATE: Cache hook system - no requiere importación manual
// Se ejecuta automáticamente al iniciar cualquier sesión
import '../core/session-cache-auto';

// Delegate to the core implementation
import '../core/session-autostart';
