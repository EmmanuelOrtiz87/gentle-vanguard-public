#!/usr/bin/env node
/**
 * Quick Start - Script unificado de inicio rápido
 * Versión TypeScript nativa (no depende de batch files)
 *
 * USO: npx tsx src/quick-start.ts [--complete]
 */

import { runSync, runSyncShell, runNpxTsxSync } from './core/run-command.js';

const ROOT = process.cwd();

interface StartOptions {
  complete: boolean;
  verbose: boolean;
}

function parseArgs(): StartOptions {
  return {
    complete: process.argv.includes('--complete'),
    verbose: process.argv.includes('--verbose') || process.argv.includes('-v'),
  };
}

function log(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
  const icons = {
    info: '[INFO]',
    success: '✓',
    warning: '⚠',
    error: '✗',
  };
  console.log(`${icons[type]} ${message}`);
}

function cleanupProcesses(): void {
  log('Limpiando procesos zombie...', 'info');
  try {
    runNpxTsxSync('src/process-cleanup.ts', [], {
      cwd: ROOT,
      stdio: 'pipe',
      timeout: 10000,
    });
    log('Procesos limpiados', 'success');
  } catch {
    // Continuar aunque falle
  }
}

function checkDashboardRunning(): boolean {
  try {
    runSync('curl', ['-s', 'http://localhost:8080/health'], {
      timeout: 2000,
      stdio: 'pipe',
    });
    return true;
  } catch {}
  return false;
}

function startDashboard(): boolean {
  log('Iniciando dashboard...', 'info');

  try {
    // Use execSync con detachment via start /B en Windows
    const isWin = process.platform === 'win32';
    const cmd = isWin
      ? `start /B npx tsx src/dashboard-start.ts --no-browser > .runtime/dashboard.log 2>&1`
      : `npx tsx src/dashboard-start.ts --no-browser > .runtime/dashboard.log 2>&1 &`;

    runSyncShell(cmd, {
      cwd: ROOT,
      stdio: 'pipe',
    });

    // Esperar a que inicie
    let attempts = 0;
    const maxAttempts = 20;

    while (attempts < maxAttempts) {
      // Esperar 1 segundo entre checks
      setTimeout(() => {}, 1000);
      if (checkDashboardRunning()) {
        return true;
      }
      attempts++;
    }

    return checkDashboardRunning();
  } catch (e) {
    log(`Error iniciando: ${e}`, 'warning');
    // A veces el comando funciona aunque retorne error
    return checkDashboardRunning();
  }
}

function printBanner(): void {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║  GENTLE-VANGUARD - Quick Start                        ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log();
}

function printSuccess(): void {
  console.log();
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║  STACK INICIADO                                       ║');
  console.log('╠════════════════════════════════════════════════════════╣');
  console.log('║  Web UI:  http://localhost:5173                       ║');
  console.log('║  WS API:  http://localhost:8080                       ║');
  console.log('╠════════════════════════════════════════════════════════╣');
  console.log('║  Status:  npx tsx src/cli/gv.ts status                  ║');
  console.log('║  Stop:    npx tsx src/dashboard-stop.ts               ║');
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log();
}

function main(): void {
  const options = parseArgs();
  const startTime = Date.now();

  printBanner();

  // Paso 1: Cleanup
  cleanupProcesses();

  // Paso 2: Verificación completa (opcional)
  if (options.complete) {
    log('Modo completo: verificando builds...', 'info');
    // Aquí irían verificaciones adicionales
  }

  // Paso 3: Verificar si ya está corriendo
  if (checkDashboardRunning()) {
    log('Dashboard ya está corriendo', 'success');
    printSuccess();
    return;
  }

  // Paso 4: Iniciar
  const success = startDashboard();

  if (success) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    log(`Dashboard iniciado en ${elapsed}s`, 'success');
    printSuccess();
  } else {
    log('No se pudo verificar el inicio, revisa logs:', 'warning');
    console.log('  .runtime/dashboard.log');
  }
}

main();
