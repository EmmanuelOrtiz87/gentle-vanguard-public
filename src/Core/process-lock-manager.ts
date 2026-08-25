#!/usr/bin/env tsx
/**
 * Process Lock Manager - Sistema robusto de prevención de duplicados
 *
 * Implementa el patrón "file-based locking with PID tracking" que es el estándar
 * de la industria para prevenir duplicados en procesos de larga duración.
 *
 * CARACTERÍSTICAS:
 * - Lock files con PID validation
 * - Stale lock detection (detecta procesos muertos)
 * - Cross-platform (Windows/Unix)
 * - Atomic operations
 * - Graceful handover (si hay proceso nuevo vs viejo)
 *
 * USO:
 *   import { ProcessLock } from './process-lock-manager.js';
 *
 *   const lock = new ProcessLock('codegraph-server');
 *   if (lock.acquire()) {
 *     // Ejecutar proceso - soy el único
 *     runMyProcess();
 *   } else {
 *     // Ya hay otro proceso corriendo
 *     console.log('Process already running, PID:', lock.getHolderPid());
 *   }
 *
 * @version 1.0.0
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { join, resolve } from 'path';
import { execSync } from 'child_process';

// ─── Configuration ────────────────────────────────────────────────────────────
const LOCKS_DIR = join(resolve(process.cwd()), '.runtime', 'locks');
// Stale lock threshold: 30 seconds to consider stale
const STALE_THRESHOLD_MS = 30000;
const activeLocks = new Set<ProcessLock>();
let shutdownHandlersInstalled = false;

function installShutdownHandlers(): void {
  if (shutdownHandlersInstalled) return;
  shutdownHandlersInstalled = true;
  process.once('exit', () => {
    for (const lock of activeLocks) lock.release();
  });
  const shutdown = () => {
    for (const lock of activeLocks) lock.release();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

// ─── Process Lock Class ──────────────────────────────────────────────────────
export class ProcessLock {
  private name: string;
  private lockFile: string;
  private acquired = false;

  constructor(name: string) {
    this.name = name;
    this.lockFile = join(LOCKS_DIR, `${name}.lock`);
    this.ensureLocksDir();
  }

  private ensureLocksDir(): void {
    if (!existsSync(LOCKS_DIR)) {
      mkdirSync(LOCKS_DIR, { recursive: true });
    }
  }

  /**
   * Intenta adquirir el lock.
   * Retorna true si se adquirió exitosamente (somos el únicos).
   * Retorna false si ya hay otro proceso activo.
   */
  acquire(): boolean {
    if (this.acquired) return true;

    try {
      // Si existe lock file, verificar si es válido
      if (existsSync(this.lockFile)) {
        const existing = this.readLock();

        if (existing && this.isProcessAlive(existing.pid)) {
          // Hay un proceso vivo con el lock
          const age = Date.now() - existing.timestamp;

          // Si el lock es muy viejo, podría ser stale
          if (age > STALE_THRESHOLD_MS) {
            console.log(
              `[LOCK] ${this.name}: Lock file is old (${Math.floor(age / 1000)}s), checking process...`,
            );
            // Double-check: el proceso podría estar vivo pero sin responder
            if (!this.isProcessResponsive(existing.pid)) {
              console.log(
                `[LOCK] ${this.name}: Process ${existing.pid} is not responsive, taking over`,
              );
              this.forceUnlock();
              return this.createLock();
            }
          }

          // Proceso está vivo, no podemos tomar el lock
          return false;
        } else {
          // Lock file apunta a proceso muerto
          console.log(
            `[LOCK] ${this.name}: Stale lock (PID ${existing?.pid} not alive), taking over`,
          );
          this.forceUnlock();
          return this.createLock();
        }
      }

      // No existe lock, crearlo
      return this.createLock();
    } catch (err) {
      console.error(`[LOCK] ${this.name}: Error acquiring lock: ${err}`);
      // En caso de error, permitir ejecución (fail-safe)
      return true;
    }
  }

  /**
   * Libera el lock.
   */
  release(): void {
    if (!this.acquired) return;

    try {
      if (existsSync(this.lockFile)) {
        const lock = this.readLock();
        // Solo liberar si somos nosotros los dueños
        if (lock && lock.pid === process.pid) {
          unlinkSync(this.lockFile);
          this.acquired = false;
          activeLocks.delete(this);
          console.log(`[LOCK] ${this.name}: Lock released`);
        }
      }
    } catch (err) {
      console.error(`[LOCK] ${this.name}: Error releasing lock: ${err}`);
    }
  }

  /**
   * Obtiene el PID del proceso que tiene el lock.
   */
  getHolderPid(): number | null {
    const lock = this.readLock();
    return lock?.pid ?? null;
  }

  /**
   * Verifica si el lock está activo.
   */
  isLocked(): boolean {
    if (!existsSync(this.lockFile)) return false;

    const lock = this.readLock();
    if (!lock) return false;

    return this.isProcessAlive(lock.pid);
  }

  // ─── Private Methods ────────────────────────────────────────────────────────

  readLock(): { pid: number; timestamp: number } | null {
    try {
      const content = readFileSync(this.lockFile, 'utf-8');
      const lines = content.split('\n');
      const pidLine = lines.find((l) => l.startsWith('pid='));
      const timeLine = lines.find((l) => l.startsWith('timestamp='));

      if (!pidLine || !timeLine) return null;

      const pid = parseInt(pidLine.split('=')[1], 10);
      const timestamp = parseInt(timeLine.split('=')[1], 10);

      return { pid, timestamp };
    } catch {
      return null;
    }
  }

  private createLock(): boolean {
    try {
      const content = `pid=${process.pid}\ntimestamp=${Date.now()}\nprocess=${process.title}\n`;
      const fd = openSync(this.lockFile, 'wx');
      try {
        writeFileSync(fd, content, 'utf-8');
      } finally {
        closeSync(fd);
      }
      this.acquired = true;

      // Install one shared shutdown handler instead of three listeners per lock.
      activeLocks.add(this);
      installShutdownHandlers();

      console.log(`[LOCK] ${this.name}: Lock acquired (PID ${process.pid})`);
      return true;
    } catch (err) {
      console.error(`[LOCK] ${this.name}: Failed to create lock: ${err}`);
      return false;
    }
  }

  private forceUnlock(): void {
    try {
      if (existsSync(this.lockFile)) {
        unlinkSync(this.lockFile);
      }
    } catch {
      // Ignore
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      // Windows: usa tasklist
      if (process.platform === 'win32') {
        execSync(`tasklist /FI "PID eq ${pid}" /FO CSV`, { windowsHide: true });
        return true;
      } else {
        // Unix: kill -0 verifica si el proceso existe
        process.kill(pid, 0);
        return true;
      }
    } catch {
      return false;
    }
  }

  private isProcessResponsive(pid: number): boolean {
    try {
      if (process.platform === 'win32') {
        // En Windows, verificar si el proceso tiene threads activos
        const result = execSync(`wmic process where ProcessId=${pid} GET ThreadCount /VALUE`, {
          windowsHide: true,
          encoding: 'utf-8',
        });
        const threads = result.match(/ThreadCount=(\d+)/);
        return threads ? parseInt(threads[1], 10) > 0 : false;
      }
      return this.isProcessAlive(pid);
    } catch {
      return false;
    }
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────
export const processLocks = new Map<string, ProcessLock>();

export function getProcessLock(name: string): ProcessLock {
  if (!processLocks.has(name)) {
    processLocks.set(name, new ProcessLock(name));
  }
  return processLocks.get(name)!;
}

// ─── Wrapper Function ──────────────────────────────────────────────────────
/**
 * Wrapper que ejecuta una función solo si puede adquirir el lock.
 * Si no puede, retorna null.
 */
export function withProcessLock<T>(name: string, fn: () => T): T | null {
  const lock = getProcessLock(name);

  if (lock.acquire()) {
    try {
      return fn();
    } finally {
      // No liberar aquí - el proceso debe mantener el lock mientras viva
      // Se auto-libera en exit
    }
  } else {
    console.log(`[SKIP] ${name}: Already running (PID ${lock.getHolderPid()})`);
    return null;
  }
}

// ─── Health Check ───────────────────────────────────────────────────────────
export function checkProcessLocks(): { name: string; pid: number | null; age: number }[] {
  const results: { name: string; pid: number | null; age: number }[] = [];

  try {
    const files = readdirSync(LOCKS_DIR);
    for (const file of files) {
      if (file.endsWith('.lock')) {
        const name = file.slice(0, -5);
        const lock = new ProcessLock(name);
        const info = lock.readLock();

        results.push({
          name,
          pid: info?.pid ?? null,
          age: info ? Date.now() - info.timestamp : -1,
        });
      }
    }
  } catch {
    // Ignore
  }

  return results;
}

// CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);

  if (args.includes('--status')) {
    const locks = checkProcessLocks();
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║  Process Locks Status                  ║');
    console.log('╚════════════════════════════════════════╝');

    for (const lock of locks) {
      const status = lock.pid ? '🔒 LOCKED' : '🔓 UNLOCKED';
      const age = lock.age > 0 ? `${Math.floor(lock.age / 1000)}s` : 'N/A';
      console.log(`${status} ${lock.name} (PID: ${lock.pid}, Age: ${age})`);
    }

    if (locks.length === 0) {
      console.log('No locks found');
    }
    console.log('');
  }

  if (args.includes('--test')) {
    const lock = getProcessLock('test-process');
    console.log('Testing lock acquisition...');

    if (lock.acquire()) {
      console.log('✅ Lock acquired!');
      setTimeout(() => {
        lock.release();
        console.log('✅ Lock released!');
      }, 2000);
    } else {
      console.log('❌ Lock failed - already held by:', lock.getHolderPid());
    }
  }
}

// Helper para readdirSync
import { readdirSync } from 'fs';
