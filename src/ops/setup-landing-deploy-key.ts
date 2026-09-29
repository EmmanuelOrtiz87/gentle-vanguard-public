#!/usr/bin/env tsx
/**
 * setup-landing-deploy-key.ts — Setup one-time SSH deploy key para
 * gentlevanguard/gentlevanguard.github.io (landing oficial, URL de marca).
 *
 * Que problema resuelve: el sync-to-public actual usa HTTPS+PAT. Cuando el
 * target es cross-org (gentlevanguard ≠ EmmanuelOrtiz87), el PAT_SYNC de
 * Settings > Secrets NO tiene acceso. Hay que configurar un mecanismo
 * nativo del stack que SI funcione.
 *
 * Solucion: SSH deploy key (recomendada por GitHub para cross-org):
 *   1. Genera par ed25519 dedicado en ~/.ssh/gv-landing-deploy (o reusa si ya existe)
 *   2. Imprime la publica para que el user la agregue UNA sola vez al repo:
 *      https://github.com/gentlevanguard/gentlevanguard.github.io/settings/keys/new
 *      Title: "gv-landing-deploy (bot)"
 *      Allow write access: SI
 *   3. Configura ~/.ssh/config con alias github-gentlevanguard que mapea la clave
 *   4. Verifica conectividad SSH contra el repo
 *
 * Idempotente: si la clave ya existe, la reusa. Si el host alias ya existe en
 * ssh config, no lo duplica.
 *
 * Uso:
 *   npx tsx src/ops/setup-landing-deploy-key.ts                # setup interactivo
 *   npx tsx src/ops/setup-landing-deploy-key.ts --show-pubkey  # solo muestra la publica
 *   npx tsx src/ops/setup-landing-deploy-key.ts --verify       # solo verifica conectividad
 *   npx tsx src/ops/setup-landing-deploy-key.ts --rotate       # rota la clave (genera nueva)
 */

import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

const KEY_DIR = join(homedir(), '.ssh');
const KEY_NAME = 'gv-landing-deploy';
const KEY_PATH = join(KEY_DIR, KEY_NAME);
const PUB_PATH = `${KEY_PATH}.pub`;
const SSH_CONFIG = join(KEY_DIR, 'config');
const HOST_ALIAS = 'github-gentlevanguard';


const args = process.argv.slice(2);

function log(level: 'INFO' | 'OK' | 'WARN' | 'ERR', msg: string): void {
  const icon = { INFO: '…', OK: '✓', WARN: '!', ERR: '✗' }[level];
  console.log(`${icon} ${msg}`);
}

function ensureSshDir(): void {
  if (!existsSync(KEY_DIR)) {
    log('INFO', `Creando ${KEY_DIR}`);
    spawnSync('mkdir', ['-p', KEY_DIR], { stdio: 'ignore' });
    chmodSync(KEY_DIR, 0o700);
  }
}

function keyExists(): boolean {
  return existsSync(KEY_PATH) && existsSync(PUB_PATH);
}

function generateKey(): void {
  if (keyExists() && !args.includes('--rotate')) {
    log('OK', `Key existente en ${KEY_PATH} (reusando)`);
    return;
  }
  log('INFO', `Generando ed25519 en ${KEY_PATH}`);
  const r = spawnSync(
    'ssh-keygen',
    [
      '-t', 'ed25519',
      '-C', 'gv-bot-landing-sync',
      '-f', KEY_PATH,
      '-N', '', // sin passphrase — bots non-interactive
      '-q',
    ],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) {
    log('ERR', `ssh-keygen fallo (exit ${r.status})`);
    process.exit(1);
  }
  log('OK', 'Key generada');
}

function readPublicKey(): string {
  return readFileSync(PUB_PATH, 'utf8').trim();
}

function ensureSshConfig(): boolean {
  if (!existsSync(SSH_CONFIG)) {
    writeFileSync(SSH_CONFIG, '', 'utf8');
    chmodSync(SSH_CONFIG, 0o600);
  }
  const current = readFileSync(SSH_CONFIG, 'utf8');
  if (current.includes(`Host ${HOST_ALIAS}`)) {
    log('OK', `Host alias '${HOST_ALIAS}' ya en ~/.ssh/config`);
    return false;
  }
  const block = `\n# gentle-vanguard landing sync — agregado por setup-landing-deploy-key.ts\nHost ${HOST_ALIAS}\n  HostName github.com\n  User git\n  IdentityFile ${KEY_PATH}\n  IdentitiesOnly yes\n  StrictHostKeyChecking accept-new\n`;
  writeFileSync(SSH_CONFIG, current + block, 'utf8');
  chmodSync(SSH_CONFIG, 0o600);
  log('OK', `Host alias '${HOST_ALIAS}' agregado a ~/.ssh/config`);
  return true;
}

function verifyConnectivity(): boolean {
  log('INFO', `Verificando SSH contra ${HOST_ALIAS}`);
  const r = spawnSync(
    'ssh',
    ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', HOST_ALIAS, 'git-upload-pack gentlevanguard/gentlevanguard.github.io.git'],
    { stdio: 'pipe', encoding: 'utf8' },
  );
  if (r.status === 0) {
    log('OK', 'Conectividad SSH OK al repo gentlevanguard');
    return true;
  }
  log('WARN', `SSH fallo (exit ${r.status}): ${r.stderr?.slice(0, 200) ?? '(sin stderr)'}`);
  return false;
}

function showSetupInstructions(): void {
  const pub = readPublicKey();
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  🚀  DEPLOY KEY GENERADA — UN SOLO PASO MANUAL              ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  1. Abrí esta URL en tu navegador:                          ║');
  console.log('║     https://github.com/gentlevanguard/gentlevanguard.github.io/settings/keys/new');
  console.log('║                                                              ║');
  console.log('║  2. Pegá esta clave publica en el campo "Key":              ║');
  console.log('║                                                              ║');
  console.log(`║  ${pub}`);
  console.log('║                                                              ║');
  console.log('║  3. Titulo sugerido: "gv-landing-deploy (bot)"                ║');
  console.log('║  4. MARCÁ "Allow write access"                               ║');
  console.log('║  5. Click "Add key"                                          ║');
  console.log('║                                                              ║');
  console.log('║  Despues de eso, ejecuta:                                     ║');
  console.log('║     npx tsx src/ops/setup-landing-deploy-key.ts --verify     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
}

// ─── Main ─────────────────────────────────────────────────────────────

function main(): number {
  if (args.includes('--show-pubkey')) {
    ensureSshDir();
    if (!keyExists()) {
      log('ERR', `Key no existe en ${KEY_PATH}. Corré setup primero (sin --show-pubkey)`);
      return 1;
    }
    console.log(readPublicKey());
    return 0;
  }

  if (args.includes('--verify')) {
    ensureSshConfig();
    const ok = verifyConnectivity();
    return ok ? 0 : 1;
  }

  log('INFO', '=== Setup SSH deploy key para gentlevanguard landing ===');
  ensureSshDir();
  generateKey();
  ensureSshConfig();
  verifyConnectivity();
  showSetupInstructions();

  return 0;
}

main();
