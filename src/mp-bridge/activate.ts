#!/usr/bin/env node
/**
 * MP Bridge Activation CLI (P0-#2) — operatoria segura de credenciales
 * MercadoPago desde la PC del dueño, en un solo comando.
 *
 *   npm run mp:activate            → flujo interactivo completo
 *   npm run mp:check               → solo diagnóstico (sin prompts)
 *
 * Flujo: valida wrangler auth → pide MP_ACCESS_TOKEN / MP_PUBLIC_KEY con
 * entrada OCULTA (nunca quedan en historial de shell ni archivos) →
 * opcional CRM_WEBHOOK_URL → `wrangler secret put` de cada una (stdin, nunca
 * argv) → `wrangler deploy` → health check del worker → ofrece regenerar la
 * landing con MP_BRIDGE_URL. Las credenciales viven cifradas en Cloudflare
 * (secrets del worker); la landing solo recibe la URL PÚBLICA del bridge.
 *
 * No-interactivo: si MP_ACCESS_TOKEN/MP_PUBLIC_KEY vienen en env, no pregunta
 * (útil para automatizar; los valores siguen yendo a secrets, no al repo).
 */
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BRIDGE_DIR = dirname(fileURLToPath(import.meta.url));
const LANDING_BUILD = join(BRIDGE_DIR, '..', '..', 'apps', 'academy-web', 'scripts', 'build-landing.mjs');
const MODE = process.argv.includes('--check') ? 'check' : 'activate';

interface RunResult {
  ok: boolean;
  stdout: string;
}

function wrangler(args: string[], opts: { inherit?: boolean; input?: string } = {}): RunResult {
  // npx resuelve wrangler on-demand (-y). shell:true solo en win32 para el shim .cmd.
  const result = spawnSync('npx', ['-y', 'wrangler@4', ...args], {
    cwd: BRIDGE_DIR,
    encoding: 'utf8',
    windowsHide: false, // CLI interactivo del dueño: su propia terminal
    shell: process.platform === 'win32',
    stdio: opts.inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'],
    input: opts.input,
    env: { ...process.env, CI: 'true', NO_COLOR: '1' },
  });
  return { ok: result.status === 0, stdout: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function question(query: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Prompt con eco oculto — el valor nunca aparece en pantalla ni historial. */
function questionHidden(query: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {
      process.stdout.write('*');
    };
    rl.question(query, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

function validateToken(name: string, value: string): string | null {
  // Formatos MP 2026: el prefijo YA NO distingue prueba vs producción — la doc
  // oficial indica que el Access Token de PRUEBA puede empezar con APP_USR-.
  // Aceptamos TEST- (legacy), APP_USR- y APP- (ambos, prueba o producción).
  if (/^(TEST|APP(?:_USR)?)-[A-Za-z0-9\-_]{10,}$/.test(value)) return null;
  return `${name} no parece válida: debe comenzar con TEST-, APP_USR- o APP- (formatos MercadoPago).`;
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  GV MP Bridge — Activación de checkout MercadoPago       ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // ── Auth check ──────────────────────────────────────────────────────────
  console.log('[1/6] Verificando autenticación de Cloudflare (wrangler whoami)...');
  const who = wrangler(['whoami']);
  if (!who.ok) {
    console.error('\n✖ Wrangler no está autenticado. Corré una vez:\n');
    console.error('    npx wrangler login\n');
    console.error('   (abre el browser y autoriza; después re-ejecutá este comando)');
    process.exit(1);
  }
  const account =
    who.stdout.match(/[\w.+-]+@[\w.-]+/)?.[0] ??
    who.stdout.match(/account name "([^"]+)"/i)?.[1] ??
    'cuenta activa';
  console.log(`✔ Autenticado como ${account}\n`);

  // ── Secrets ya configurados ─────────────────────────────────────────────
  console.log('[2/6] Secrets actuales del worker gv-mp-bridge...');
  const list = wrangler(['secret', 'list']);
  const current = new Set<string>();
  if (list.ok) {
    for (const m of list.stdout.matchAll(/"name":\s*"([^"]+)"/g)) current.add(m[1]);
  }
  console.log(
    current.size > 0
      ? `✔ Configurados: ${[...current].join(', ')}\n`
      : '· (ninguno configurado aún)\n',
  );

  if (MODE === 'check') {
    console.log('[check] Health del worker (si ya está deployado)...');
    const deployed = wrangler(['deployments', 'list']);
    const url = deployed.stdout.match(/https:\/\/gv-mp-bridge[\w.\-]*\.workers\.dev/)?.[0];
    if (url) {
      try {
        const res = await fetch(`${url}/api/mp/health`);
        console.log(`✔ ${url}/api/mp/health → HTTP ${res.status}${res.status === 200 ? ' (OK)' : ''}`);
      } catch {
        console.log(`✖ ${url}/api/mp/health no responde`);
      }
    } else {
      console.log('· Worker aún no deployado (ejecutá npm run mp:activate para el flujo completo)');
    }
    console.log('\nDiagnóstico completo.');
    return;
  }

  if (!process.stdout.isTTY && !process.env.MP_ACCESS_TOKEN) {
    console.error('✖ Este flujo es interactivo (necesita terminal). Para automatizar: pasá MP_ACCESS_TOKEN y MP_PUBLIC_KEY por env.');
    process.exit(1);
  }

  // ── Credenciales (entrada oculta; env permite no-interactivo) ──────────
  console.log('[3/6] Credenciales de MercadoPago (Panel → Desarrollo → Credenciales)');
  console.log('     Entrada oculta — queda solo en Cloudflare, jamás en el repo.\n');

  const token = process.env.MP_ACCESS_TOKEN || (await questionHidden('  MP_ACCESS_TOKEN (TEST-… o APP-…): '));
  const publicKey = process.env.MP_PUBLIC_KEY || (await questionHidden('  MP_PUBLIC_KEY  (TEST-… o APP-…): '));
  const crmWebhook =
    process.env.CRM_WEBHOOK_URL ||
    (await question('  CRM_WEBHOOK_URL (opcional, Enter para saltear): '));

  for (const [name, value] of [
    ['MP_ACCESS_TOKEN', token],
    ['MP_PUBLIC_KEY', publicKey],
  ] as const) {
    if (!value) {
      console.error(`✖ ${name} es obligatoria.`);
      process.exit(1);
    }
    const error = validateToken(name, value);
    if (error) {
      console.error(`✖ ${error}`);
      process.exit(1);
    }
  }
  if (crmWebhook && !/^https:\/\/.+/.test(crmWebhook)) {
    console.error('✖ CRM_WEBHOOK_URL debe ser https:// o vacía.');
    process.exit(1);
  }
  console.log('✔ Formatos válidos\n');

  // ── Subida de secrets (stdin, nunca argv) ───────────────────────────────
  console.log('[4/6] Subiendo secrets a Cloudflare...');
  const toUpload: Array<[string, string]> = [
    ['MP_ACCESS_TOKEN', token],
    ['MP_PUBLIC_KEY', publicKey],
  ];
  if (crmWebhook) toUpload.push(['CRM_WEBHOOK_URL', crmWebhook]);
  for (const [name, value] of toUpload) {
    process.stdout.write(`  · ${name}... `);
    const put = wrangler(['secret', 'put', name], { input: `${value}\n` });
    console.log(put.ok ? '✔' : `✖ (${put.stdout.slice(-200).trim()})`);
    if (!put.ok) process.exit(1);
  }
  console.log('');

  // ── Deploy ──────────────────────────────────────────────────────────────
  console.log('[5/6] Deploy del worker...');
  const deploy = wrangler(['deploy']);
  if (!deploy.ok) {
    console.error(`✖ Deploy falló:\n${deploy.stdout.slice(-500)}`);
    process.exit(1);
  }
  const bridgeUrl = deploy.stdout.match(/https:\/\/gv-mp-bridge[\w.\-]*\.workers\.dev/)?.[0];
  console.log(`✔ Worker deployado${bridgeUrl ? `: ${bridgeUrl}` : ''}\n`);

  // ── Health + landing ────────────────────────────────────────────────────
  console.log('[6/6] Health check + landing...');
  if (bridgeUrl) {
    try {
      const res = await fetch(`${bridgeUrl}/api/mp/health`);
      console.log(`  · health → HTTP ${res.status}${res.status === 200 ? ' ✔' : ' ⚠'}`);
    } catch {
      console.log('  · health no respondió (puede tardar ~30s en propagarse)');
    }
  }

  if (existsSync(LANDING_BUILD)) {
    const regen = await question(`  ¿Regenerar la landing con MP_BRIDGE_URL=${bridgeUrl ?? '<url>'}? [s/N]: `);
    if (regen.toLowerCase() === 's' && bridgeUrl) {
      const build = spawnSync(process.execPath, [LANDING_BUILD], {
        cwd: dirname(LANDING_BUILD),
        env: { ...process.env, MP_BRIDGE_URL: bridgeUrl },
        stdio: 'inherit',
      });
      console.log(build.status === 0 ? '  ✔ Landing regenerada (publicala con tu flujo de sync normal)' : '  ✖ Falló la regeneración');
    } else {
      console.log(`  · Manual: MP_BRIDGE_URL=${bridgeUrl} node apps/academy-web/scripts/build-landing.mjs`);
    }
  }

  console.log('\n║ Activación completa — el checkout Pro queda operativo.        ║');
}

void main();
