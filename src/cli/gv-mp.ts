#!/usr/bin/env node
/**
 * gv-mp.ts — Unified MercadoPago setup companion for devs (NO infra manual).
 *
 * Comandos principales:
 *   gv mp doctor               diagnóstico TRANSPARENTE (muestra raw output)
 *   gv mp open                 abre todas las URLs en el browser (MP Panel, login CF)
 *   gv mp run                  corre `mp:activate` con output paso a paso
 *   gv mp webhook-url          imprime la URL exacta del webhook
 *   gv mp status               estado del worker + webhook URL
 *   gv mp test-webhook         firma + POST de prueba contra el webhook
 *   gv mp rotate-secret        genera WEBHOOK_SIGNING_SECRET + indica dónde pegarlo
 *
 * PRINCIPIO: cero "andá a X". Si algo falla, te imprime el output raw + fix exacto.
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { generateSecret } from '../webhooks/standard-webhooks.js';

const ROOT = resolve(process.cwd());
const WORKER_NAME = 'gv-mp-bridge';

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};
const c = (color: string, s: string): string => `${color}${s}${C.reset}`;

function header(): void {
  process.stdout.write('\n' + c(C.cyan, '╔══════════════════════════════════════════════════════════╗\n'));
  process.stdout.write(c(C.cyan, '║  GV MP Bridge — Companion CLI para devs                  ║\n'));
  process.stdout.write(c(C.cyan, '╚══════════════════════════════════════════════════════════╝\n') + '\n');
}

interface WranglerState {
  subdomain: string | null;
  workerDeployed: boolean;
  workerUrl: string | null;
  rawWhoami: string;
  rawDeployments: string;
}

function detectWranglerState(_verbose = false): WranglerState {
  let subdomain: string | null = null;
  let workerDeployed = false;
  let workerUrl: string | null = null;
  const rawWhoami = (spawnSync('npx', ['wrangler', 'whoami'], {
    cwd: ROOT, encoding: 'utf8', windowsHide: true,
  }).stdout || '').trim()
    + '\n' + (spawnSync('npx', ['wrangler', 'whoami'], {
      cwd: ROOT, encoding: 'utf8', windowsHide: true,
    }).stderr || '').trim();

  // Buscar subdomain en cualquier formato conocido
  const m = rawWhoami.match(/subdomain\s*[:=]\s*["']?([a-z0-9_-]+)/i);
  if (m) subdomain = m[1];

  // Fallback: comando `wrangler subdomain get`
  if (!subdomain) {
    const subOut = (spawnSync('npx', ['wrangler', 'subdomain', 'get'], {
      cwd: ROOT, encoding: 'utf8', windowsHide: true,
    }).stdout || '').trim();
    const sm = subOut.match(/["']?([a-z0-9_-]+)["']?\s*$/);
    if (sm) subdomain = sm[1];
  }

  // Detectar deploy via `wrangler deployments list`
  const listOut = (spawnSync('npx', ['wrangler', 'deployments', 'list', WORKER_NAME], {
    cwd: ROOT, encoding: 'utf8', windowsHide: true,
  }).stdout || '') + (spawnSync('npx', ['wrangler', 'deployments', 'list', WORKER_NAME], {
    cwd: ROOT, encoding: 'utf8', windowsHide: true,
  }).stderr || '');
  const hasDeployRecord = /deployed|active|created|2026|2025/i.test(listOut);
  workerDeployed = hasDeployRecord && !/error/i.test(listOut);
  if (workerDeployed && subdomain) {
    workerUrl = `https://${WORKER_NAME}.${subdomain}.workers.dev`;
  }
  return { subdomain, workerDeployed, workerUrl, rawWhoami, rawDeployments: listOut };
}

async function cmdDoctor(): Promise<void> {
  header();
  process.stdout.write(c(C.bold, '═══ Doctor — diagnóstico TRANSPARENTE ═══\n\n'));

  const st = detectWranglerState();

  // ── 0. Probe directo del health (fuente de verdad — no requiere wrangler auth).
  // En shells no-interactivos wrangler puede tener token con scopes limitados
  // (whoami vacío) aunque el worker esté perfectamente deployado.
  const CANONICAL_URL = `https://${WORKER_NAME}.gentlevanguard.workers.dev`;
  let healthOk = false;
  try {
    const probe = await fetch(`${CANONICAL_URL}/api/mp/health`);
    healthOk = probe.ok;
  } catch { /* offline */ }
  if (healthOk && !st.workerUrl) {
    st.workerUrl = CANONICAL_URL;
    st.workerDeployed = true;
  }

  // ── 1. wrangler auth ──
  process.stdout.write('[1/4] ' + c(C.bold, 'wrangler autenticación:\n'));
  if (st.subdomain) {
    process.stdout.write(c(C.green, `    ✓ autenticado, subdomain = ${st.subdomain}\n\n`));
  } else {
    process.stdout.write(c(C.yellow, `    ⚠ no se detectó subdomain vía wrangler whoami\n`));
    process.stdout.write(c(C.dim, '    (en shells no-interactivos el token puede tener scopes limitados;\n'));
    process.stdout.write(c(C.dim, '     NO implica que el worker esté caído — ver health abajo)\n\n'));
  }

  // ── 2. worker deployed ──
  process.stdout.write('[2/4] ' + c(C.bold, 'Worker deployado:\n'));
  if (st.workerDeployed && st.workerUrl) {
    process.stdout.write(c(C.green, `    ✓ ${st.workerUrl}\n\n`));
  } else {
    process.stdout.write(c(C.red, `    ✗ Worker NO deployado (o no se detectó)\n`));
    if (st.subdomain) {
      process.stdout.write(c(C.yellow, '    FIX: ') + c(C.bold, `npx tsx src/mp-bridge/activate.ts\n`));
      process.stdout.write(c(C.dim, '      (te pide credenciales, sube a Cloudflare, deploya)\n\n'));
    } else {
      process.stdout.write(c(C.yellow, '    FIX: primero wrangler login, después activate\n\n'));
    }
    if (process.argv.includes('--verbose') || process.argv.includes('--raw')) {
      process.stdout.write(c(C.dim, '    Output raw de "wrangler deployments list":\n'));
      process.stdout.write(c(C.dim, '    ────────────────────────────────\n'));
      process.stdout.write(st.rawDeployments.split('\n').map((l) => '    ' + l).join('\n') + '\n');
      process.stdout.write(c(C.dim, '    ────────────────────────────────\n\n'));
    }
  }

  // ── 3. health ──
  process.stdout.write('[3/4] ' + c(C.bold, 'Worker /api/mp/health:\n'));
  if (st.workerUrl) {
    try {
      const res = await fetch(`${st.workerUrl}/api/mp/health`);
      if (res.ok) {
        const body = await res.json() as { ok: boolean; hasToken: boolean; hasPublicKey: boolean };
        process.stdout.write(c(C.green, `    ✓ HTTP ${res.status} → ${JSON.stringify(body)}\n\n`));
        if (!body.hasToken || !body.hasPublicKey) {
          process.stdout.write(c(C.yellow, '    ⚠ Falta subir MP_ACCESS_TOKEN o MP_PUBLIC_KEY al worker.\n'));
          process.stdout.write(c(C.dim, '      Re-corré activate.ts — el script sube los secrets automáticamente.\n\n'));
        }
      } else {
        process.stdout.write(c(C.red, `    ✗ HTTP ${res.status}\n\n`));
      }
    } catch (err) {
      process.stdout.write(c(C.red, `    ✗ Unreachable: ${err instanceof Error ? err.message : String(err)}\n\n`));
    }
  } else {
    process.stdout.write(c(C.dim, '    (skipped — worker not deployed)\n\n'));
  }

  // ── 4. webhook secret ──
  process.stdout.write('[4/4] ' + c(C.bold, 'WEBHOOK_SIGNING_SECRET:\n'));
  const secret = process.env.WEBHOOK_SIGNING_SECRET;
  if (secret) {
    process.stdout.write(c(C.green, `    ✓ presente en este shell (${secret.slice(0, 8)}...)\n\n`));
  } else {
    process.stdout.write(c(C.yellow, `    ⚠ no está en este shell (puede estar en el worker, no se puede ver)\n`));
    process.stdout.write(c(C.dim, '      Generá uno nuevo: ') + c(C.bold, 'gv mp rotate-secret\n\n'));
  }

  process.stdout.write(c(C.dim, 'Más diagnóstico: ') + c(C.bold, 'gv mp doctor --raw\n\n'));
}

async function cmdStatus(): Promise<void> {
  header();
  const st = detectWranglerState();
  if (!st.subdomain) {
    process.stdout.write(c(C.red, 'wrangler: NO autenticado\n\n'));
    process.stdout.write(c(C.dim, 'Output raw:\n') + st.rawWhoami + '\n');
    process.stdout.write(c(C.yellow, '\nFIX: ') + c(C.bold, 'npx wrangler login\n\n'));
    process.exit(1);
  }
  if (!st.workerDeployed || !st.workerUrl) {
    process.stdout.write(c(C.green, 'wrangler: autenticado (' + st.subdomain + ')\n'));
    process.stdout.write(c(C.red, 'worker: NO deployado\n\n'));
    process.stdout.write('Output raw de "wrangler deployments list":\n');
    process.stdout.write(st.rawDeployments.trim() + '\n\n');
    process.stdout.write(c(C.yellow, 'FIX: ') + c(C.bold, 'npx tsx src/mp-bridge/activate.ts\n\n'));
    process.exit(1);
  }
  const webhookUrl = `${st.workerUrl}/api/mp/webhook`;
  const healthUrl = `${st.workerUrl}/api/mp/health`;
  process.stdout.write(c(C.green, `Worker deployado:\n`));
  process.stdout.write(`  ${c(C.dim, 'Webhook URL')}    ${c(C.yellow, webhookUrl)}\n`);
  process.stdout.write(`  ${c(C.dim, 'Health URL')}      ${c(C.yellow, healthUrl)}\n\n`);
  process.stdout.write(c(C.dim, 'Pegá esta URL en MP Panel → Notificaciones:\n'));
  process.stdout.write(`  https://www.mercadopago.com.ar/developers/panel/notifications/webhooks\n\n`);
}

async function cmdOpen(): Promise<void> {
  header();
  process.stdout.write(c(C.bold, 'Abriendo URLs en tu browser...\n\n'));

  // 1. wrangler login (URL=https://dash.cloudflare.com/...)
  const cfUrl = 'https://dash.cloudflare.com/login';

  // 2. MP credentials panel
  const mpCredsUrl = 'https://www.mercadopago.com.ar/developers/panel/credentials';

  // 3. MP webhooks panel
  const mpWebhooksUrl = 'https://www.mercadopago.com.ar/developers/panel/notifications/webhooks';

  // 4. Worker health (si está deployado)
  const st = detectWranglerState();
  const healthUrl = st.workerUrl ? `${st.workerUrl}/api/mp/health` : null;

  const urls = [cfUrl, mpCredsUrl, mpWebhooksUrl];
  if (healthUrl) urls.push(healthUrl);

  process.stdout.write('Abrir:\n');
  for (const u of urls) {
    process.stdout.write(`  ${c(C.cyan, u)}\n`);
  }
  process.stdout.write('\n');

  // Abrir con `start` (Windows), `open` (mac), `xdg-open` (linux)
  const cmd = process.platform === 'win32' ? 'start' :
               process.platform === 'darwin' ? 'open' : 'xdg-open';
  for (const u of urls) {
    try {
      spawnSync(cmd, [u], { stdio: 'ignore', shell: process.platform === 'win32' });
      process.stdout.write(c(C.green, `  ✓ ${u}\n`));
    } catch {
      process.stdout.write(c(C.red, `  ✗ ${u}\n`));
    }
  }
  process.stdout.write('\n');
}

async function cmdRun(): Promise<void> {
  header();
  process.stdout.write(c(C.bold, 'Lanzando mp:activate (operatoria interactiva)...\n\n'));
  process.stdout.write(c(C.dim, 'El script va a pedirte:\n'));
  process.stdout.write(c(C.dim, '  1. wrangler whoami (debe estar autenticado — sino, Ctrl+C y corre `npx wrangler login`)\n'));
  process.stdout.write(c(C.dim, '  2. MP_ACCESS_TOKEN (TEST-... o APP-... — entrá en credenciales panel si no lo tenés)\n'));
  process.stdout.write(c(C.dim, '  3. MP_PUBLIC_KEY (mismo formato)\n'));
  process.stdout.write(c(C.dim, '  4. Opcionales: Enter para skipear (CRM_WEBHOOK_URL, MP_BRIDGE_SECRET, WEBHOOK_SIGNING_SECRET)\n'));
  process.stdout.write(c(C.dim, '  5. Confirmación final (y/N)\n\n'));
  process.stdout.write(c(C.yellow, '↑ Pegá Access Token y Public Key cuando los pida (entrada oculta = normal).\n\n'));
  // Spawn interactivo (no `inherit` porque queremos que el usuario pueda ver nuestro mensaje)
  const proc = spawnSync('npx', ['tsx', 'src/mp-bridge/activate.ts'], {
    cwd: ROOT, stdio: 'inherit', windowsHide: true,
  });
  process.exit(proc.status ?? 1);
}

async function cmdWebhookUrl(): Promise<void> {
  const st = detectWranglerState();
  if (st.workerUrl) {
    process.stdout.write(`${st.workerUrl}/api/mp/webhook\n`);
  } else {
    process.stdout.write('NO_DEPLOYED\n');
    process.exit(1);
  }
}

async function cmdHealth(): Promise<void> {
  const st = detectWranglerState();
  if (!st.workerUrl) {
    process.stdout.write('Worker no deployado. Corré `gv mp run` o `npm run mp:activate`.\n');
    process.exit(2);
  }
  const url = `${st.workerUrl}/api/mp/health`;
  process.stdout.write(`GET ${url}\n`);
  try {
    const res = await fetch(url);
    const body = await res.text();
    process.stdout.write(`HTTP ${res.status}\n${body}\n`);
    process.exit(res.ok ? 0 : 1);
  } catch (err) {
    process.stdout.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  }
}

async function cmdRotateSecret(): Promise<void> {
  const secret = generateSecret();
  process.stdout.write(c(C.bold, 'NUEVO WEBHOOK_SIGNING_SECRET:\n\n'));
  process.stdout.write(`  ${c(C.yellow, secret)}\n\n`);
  process.stdout.write(c(C.bold, 'Pegalo en:\n\n'));
  process.stdout.write('  ' + c(C.bold, 'A) Worker (Cloudflare):\n'));
  process.stdout.write('     ' + c(C.yellow, 'npx wrangler secret put WEBHOOK_SIGNING_SECRET gv-mp-bridge') + '\n');
  process.stdout.write('     ' + c(C.dim, '(te pide el valor, pegá el secret)\n\n'));
  process.stdout.write('  ' + c(C.bold, 'B) CRM (apps/academy-crm/server):\n'));
  process.stdout.write('     ' + c(C.yellow, 'CRM_WEBHOOK_SECRET=' + secret) + '\n');
  process.stdout.write('     ' + c(C.dim, '(variable de entorno del daemon CRM)\n\n'));
  process.stdout.write(c(C.dim, 'Mismo valor en ambos lados. Rotación zero-downtime:\n'));
  process.stdout.write(c(C.dim, '  1) Cambiá receptor (B) primero\n'));
  process.stdout.write(c(C.dim, '  2) Después emisor (A)\n'));
  process.stdout.write(c(C.dim, '  3) Verificá con: ') + c(C.bold, 'gv mp test-webhook\n\n'));
}

async function cmdTestWebhook(): Promise<void> {
  const st = detectWranglerState();
  if (!st.workerUrl) {
    process.stdout.write('Worker no deployado. Corré `gv mp run` primero.\n');
    process.exit(2);
  }
  const secret = process.env.WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    process.stdout.write('Falta WEBHOOK_SIGNING_SECRET. Corré `gv mp rotate-secret` y pegá el valor en worker + CRM.\n');
    process.exit(2);
  }
  const { StandardWebhooks } = await import('../webhooks/standard-webhooks.js');
  const sw = new StandardWebhooks(secret);
  const id = `test_${Date.now()}`;
  const ts = Math.floor(Date.now() / 1000);
  const payload = {
    event: 'mp_sale', ts: new Date(ts * 1000).toISOString(),
    paymentId: 'TEST-PAYMENT', status: 'approved', statusDetail: 'accredited',
    amount: 42.0, currency: 'USD', externalReference: 'gv-test-ref',
    payerEmail: 'test@example.com', paymentMethod: 'visa',
    dateApproved: new Date(ts * 1000).toISOString(),
  };
  const body = JSON.stringify(payload);
  const sig = sw.sign(id, ts, body);
  const url = `${st.workerUrl}/api/mp/webhook`;
  process.stdout.write(`POST ${url}\n  webhook-id: ${id}\n  webhook-signature: ${sig.slice(0, 30)}...\n\n`);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhook-id': id, 'webhook-timestamp': ts.toString(),
        'webhook-signature': sig,
      },
      body,
    });
    const text = await res.text();
    process.stdout.write(`HTTP ${res.status}\n${text}\n`);
    process.exit(res.ok ? 0 : 1);
  } catch (err) {
    process.stdout.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  }
}

async function main(): Promise<void> {
  const sub = process.argv[2] || 'help';
  switch (sub) {
    case 'doctor': return cmdDoctor();
    case 'status': return cmdStatus();
    case 'open': return cmdOpen();
    case 'run': return cmdRun();
    case 'webhook-url': return cmdWebhookUrl();
    case 'health': return cmdHealth();
    case 'rotate-secret': return cmdRotateSecret();
    case 'test-webhook': return cmdTestWebhook();
    case 'help':
    default:
      header();
      process.stdout.write('gv mp — companion CLI para MP activate. CERO manual infra.\n\n');
      process.stdout.write('  doctor             Diagnóstico transparente (te muestra qué falla)\n');
      process.stdout.write('  status             Estado actual del worker + URL del webhook\n');
      process.stdout.write('  open               Abre Cloudflare login + MP panels en el browser\n');
      process.stdout.write('  run                Lanza mp:activate (operatoria guiada)\n');
      process.stdout.write('  webhook-url        Solo la URL del webhook (para pipe)\n');
      process.stdout.write('  health             GET /api/mp/health del worker\n');
      process.stdout.write('  rotate-secret      Genera WEBHOOK_SIGNING_SECRET nuevo\n');
      process.stdout.write('  test-webhook       POST firmado de prueba contra /api/mp/webhook\n\n');
      process.stdout.write('Flujo TÍPICO (1ª vez):\n\n');
      process.stdout.write('  1) npx wrangler login                       ' + c(C.dim, '(browser, 1 vez)\n'));
      process.stdout.write('  2) gv mp open                                ' + c(C.dim, '(abre MP credentials + webhooks)\n'));
      process.stdout.write('  3) gv mp run                                 ' + c(C.dim, '(carga secretos + deploy)\n'));
      process.stdout.write('  4) gv mp status                              ' + c(C.dim, '(URL del webhook para MP)\n'));
      process.stdout.write('  5) Pegar URL en MP Panel (browser abierto)  ' + c(C.dim, '(1 click)\n'));
      process.stdout.write('  6) gv mp rotate-secret                       ' + c(C.dim, '(secret para firmar)\n'));
      process.stdout.write('  7) gv mp test-webhook                        ' + c(C.dim, '(E2E)\n\n'));
  }
}

main().catch((err) => {
  process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(2);
});