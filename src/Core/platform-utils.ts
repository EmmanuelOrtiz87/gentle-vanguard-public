/**
 * platform-utils.ts — Utilidades multiplataforma del stack.
 *
 * Abstrae operaciones de sistema que difieren entre Windows / macOS / Linux:
 * deteccion de SO, dueño de puerto, matar procesos, abrir browser, deteccion
 * de dependencias. Sin dependencia de PowerShell ni comandos Windows-only.
 *
 * Uso:
 *   import { isWindows, findPortOwner, killProcess, openBrowser, checkDeps } from "./platform-utils.js";
 */

import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

export type Platform = "win32" | "darwin" | "linux" | "other";

export function currentPlatform(): Platform {
  const p = process.platform;
  if (p === "win32" || p === "darwin" || p === "linux") return p;
  return "other";
}

export const isWindows = (): boolean => currentPlatform() === "win32";
export const isMac = (): boolean => currentPlatform() === "darwin";
export const isLinux = (): boolean => currentPlatform() === "linux";

/** Ejecuta un comando de sistema con shell (resuelve .cmd en Windows). */
export function runSystem(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(`${cmd} ${args.map((a) => `"${a}"`).join(" ")}`, {
    cwd: opts.cwd,
    encoding: "utf8",
    windowsHide: true,
    timeout: opts.timeoutMs ?? 30_000,
    shell: true,
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/**
 * Encuentra el PID del proceso que escucha en un puerto.
 * Multiplataforma: netstat (win32) / lsof (darwin, linux).
 * Devuelve null si no hay listener.
 */
export function findPortOwner(port: number): number | null {
  if (isWindows()) {
    const r = runSystem("netstat", ["-ano"], { timeoutMs: 10_000 });
    const lines = (r.stdout ?? "").split("\n");
    for (const line of lines) {
      if (line.includes(`:${port}`) && /LISTENING/i.test(line)) {
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (Number.isFinite(pid) && pid > 0) return pid;
      }
    }
    return null;
  }
  // darwin / linux: lsof -ti :PORT
  const r = runSystem("lsof", ["-ti", `:${port}`], { timeoutMs: 10_000 });
  const pid = Number((r.stdout ?? "").trim().split("\n")[0]);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

/**
 * Mata un proceso por PID. Multiplataforma:
 * taskkill /pid (win32) / kill (darwin, linux).
 */
export function killProcess(pid: number): boolean {
  if (!pid || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    if (isWindows()) {
      runSystem("taskkill", ["/pid", String(pid), "/t", "/f"], { timeoutMs: 10_000 });
    } else {
      process.kill(pid, "SIGTERM");
    }
    return true;
  } catch {
    return false;
  }
}

/** Verifica si un proceso esta vivo (pid existe). */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Abre una URL en el browser del sistema. Multiplataforma. */
export function openBrowser(url: string): void {
  const { spawn } = require("child_process") as typeof import("child_process");
  if (isWindows()) {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } else if (isMac()) {
    spawn("open", [url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  }
}

export interface DepCheck {
  name: string;
  installed: boolean;
  version?: string;
  detail: string;
}

/**
 * Verifica dependencias de runtime en un directorio de app.
 * - node_modules presente?
 * - binarios clave (tsx, tsc, vitest) presentes?
 * - package.json valido?
 */
export function checkAppDeps(appDir: string, requiredBins: string[] = []): DepCheck[] {
  const checks: DepCheck[] = [];
  const pkgPath = join(appDir, "package.json");
  const nmPath = join(appDir, "node_modules");

  checks.push({
    name: "package.json",
    installed: existsSync(pkgPath),
    detail: existsSync(pkgPath) ? "presente" : "FALTA package.json",
  });

  checks.push({
    name: "node_modules",
    installed: existsSync(nmPath),
    detail: existsSync(nmPath) ? "dependencias instaladas" : "FALTA node_modules (correr npm install)",
  });

  for (const bin of requiredBins) {
    const binPath = join(nmPath, ".bin", bin);
    const installed = existsSync(binPath) || existsSync(binPath + ".cmd") || existsSync(binPath + ".ps1");
    checks.push({
      name: `bin:${bin}`,
      installed,
      detail: installed ? "presente" : `FALTA ${bin} (npm install)`,
    });
  }

  return checks;
}

/** Version de node (major.minor). */
export function nodeVersion(): string {
  return process.version.replace("v", "");
}

/** Verifica que node >= 20 (requisito del stack). */
export function checkNodeVersion(): { ok: boolean; version: string } {
  const v = nodeVersion();
  const major = Number(v.split(".")[0]);
  return { ok: major >= 20, version: v };
}
