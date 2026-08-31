#!/usr/bin/env node
/**
 * Benchmark: Compara rendimiento de métodos de inicio
 * Ejecuta: npx tsx src/tools/benchmark-start.ts
 */

import { runSync, runSyncShell, runNpxTsxSync } from '../core/run-command.js';

const ROOT = process.cwd();

interface BenchmarkResult {
  name: string;
  time: number;
  success: boolean;
  features: string[];
}

function stopDashboard(): void {
  try {
    runNpxTsxSync('src/ops/dashboard-stop.ts', [], {
      cwd: ROOT,
      stdio: 'pipe',
      timeout: 10000,
    });
  } catch {}

  // Esperar que se detenga
  runSyncShell('timeout /t 2 /nobreak >nul', { stdio: 'pipe' });
}

function checkDashboardRunning(): boolean {
  try {
    runSync('curl', ['-s', 'http://localhost:8080/health'], {
      timeout: 2000,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

function benchmark(name: string, command: string, args: string[] = []): BenchmarkResult {
  console.log(`\n[ benchmark ] ${name}...`);

  stopDashboard();

  const start = Date.now();
  let success = false;

  try {
    runSync(command, args, {
      cwd: ROOT,
      stdio: 'pipe',
      timeout: 60000,
    });

    const elapsed = Date.now() - start;

    // Esperar 5 segundos y verificar
    runSyncShell('timeout /t 5 /nobreak >nul', { stdio: 'pipe' });
    success = checkDashboardRunning();

    console.log(`  Tiempo: ${(elapsed / 1000).toFixed(2)}s`);
    console.log(`  Éxito: ${success ? '✓ Sí' : '✗ No'}`);

    return {
      name,
      time: elapsed,
      success,
      features: [],
    };
  } catch {
    const elapsed = Date.now() - start;
    console.log(`  Tiempo: ${(elapsed / 1000).toFixed(2)}s`);
    console.log(`  Éxito: ✗ Error`);

    return {
      name,
      time: elapsed,
      success: false,
      features: [],
    };
  }
}

console.log('╔════════════════════════════════════════════════════════╗');
console.log('║     BENCHMARK: Métodos de Inicio del Dashboard         ║');
console.log('╚════════════════════════════════════════════════════════╝');

const results: BenchmarkResult[] = [];

// Test 1: dashboard-start.ts original
const r1 = benchmark('dashboard-start.ts (original)', 'npx', [
  'tsx',
  'src/ops/dashboard-start.ts',
  '--no-browser',
]);
r1.features = ['Busca puertos libres', 'Abre Chrome (opcional)', 'Registra PIDs'];
results.push(r1);

// Test 2: start.bat
const r2 = benchmark('start.bat (simple)', 'cmd', ['/c', 'start.bat']);
r2.features = ['Limpia zombies', 'No bloquea', 'Mensajes'];
results.push(r2);

// Test 3: start-optimized.bat
const r3 = benchmark('start-optimized.bat (modo rápido)', 'cmd', ['/c', 'start-optimized.bat']);
r3.features = ['Limpia zombies', 'No bloquea', 'Verificación opcional', 'Logs'];
results.push(r3);

// Test 4: start-optimized.bat --complete
const r4 = benchmark('start-optimized.bat (modo completo)', 'cmd', [
  '/c',
  'start-optimized.bat',
  '--complete',
]);
r4.features = ['Limpia zombies', 'Verifica builds', 'No bloquea'];
results.push(r4);

// Resumen
console.log('\n═══════════════════════════════════════════════════════════');
console.log('RESUMEN:');
console.log('═══════════════════════════════════════════════════════════');

results.forEach((r, i) => {
  const timeStr = (r.time / 1000).toFixed(2).padStart(6, ' ');
  const successStr = r.success ? ' ✓' : ' ✗';
  console.log(`${i + 1}. ${r.name.padEnd(35)} ${timeStr}s${successStr}`);
  console.log(`   Features: ${r.features.join(', ')}`);
  console.log();
});

// Ganador
const fastest = results.reduce((min, r) => (r.time < min.time ? r : min), results[0]);
const mostReliable = results.filter((r) => r.success).sort((a, b) => a.time - b.time)[0];

console.log('═══════════════════════════════════════════════════════════');
console.log(`🏆 MÁS RÁPIDO: ${fastest.name}`);
console.log(`   Tiempo: ${(fastest.time / 1000).toFixed(2)}s`);
console.log();
console.log(`✅ MÁS CONFIABLE: ${mostReliable?.name || 'Ninguno'}`);
if (mostReliable) {
  console.log(`   Tiempo: ${(mostReliable.time / 1000).toFixed(2)}s`);
}
console.log('═══════════════════════════════════════════════════════════');

console.log('\nRECOMENDACIÓN:');
console.log('Usar start-optimized.bat para inicio diario.');
console.log('Usar dashboard-start.ts solo cuando se necesiten features específicas.');
