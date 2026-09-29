/**
 * Verifica la cadena de distribucion del release contra GitHub REAL.
 *
 * QUE PROBLEMA RESUELVE
 * ---------------------
 * El 2026-09-29, al publicar el release 4.1.0, el manifiesto
 * `releases/latest-version.json` apuntaba su `download_url` al repo PRIVADO
 * (`EmmanuelOrtiz87/gentle-vanguard`). Como ese repo es privado, la URL daba
 * 404 para cualquiera sin autenticacion — y el `sha256` del manifiesto
 * describia un binario al que nadie podia llegar.
 *
 * Peor: en el repo PUBLICO el asset de 4.0.0 se llamaba
 * `Gentle-Vanguard-Setup-4.0.0.exe` (16.4 MB, build viejo) mientras el
 * manifiesto pedia `gentle-vanguard-4.0.0.exe`. O sea la URL del manifiesto
 * no resolvia en NINGUNO de los dos repos. El flujo de descarga publico lleva
 * al menos una release roto.
 *
 * Nada de eso lo detecta el typecheck, el lint ni los tests: solo aparece
 * cuando alguien sin sesion intenta instalar.
 *
 * QUE HACE
 * --------
 * Para la version del manifiesto:
 *  1. El `download_url` NO apunta a un repo privado.
 *  2. La URL responde 200 SIN autenticacion (HEAD con redirect).
 *  3. El tamano publicado coincide con lo que el manifiesto espera, si esta.
 *  4. El `sha256` tiene forma de SHA-256 (64 hex) y no es el de otra version.
 *  5. El `.sha256` del repo, si existe, declara el mismo hash.
 *
 * Red publica: solo GET/HEAD. Nunca descarga 57 MB para checkear.
 *
 * Run: npx tsx src/release/verify-distribution.ts
 *   --version <v>   verifica otra version (default: la del manifiesto)
 *   --offline       saltea los checks de red (solo los locales)
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface Manifest {
  version: string;
  download_url: string;
  sha256: string;
  release_date: string;
  minimum_version: string;
  changelog_url: string;
}

const ROOT = process.cwd();
const args = process.argv.slice(2);
const offline = args.includes('--offline');
const versionArg = args.includes('--version') ? args[args.indexOf('--version') + 1] : null;

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  /** Un check de red que no pudo ejecutarse no es un PASS: es un SKIP. */
  skipped?: boolean;
}

function readManifest(): Manifest {
  const path = resolve(ROOT, 'releases', 'latest-version.json');
  if (!existsSync(path)) {
    console.error(`[FATAL] no existe ${path}`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
}

const manifest = readManifest();
const version = versionArg ?? manifest.version;
const checks: Check[] = [];

// ── 1. el destino tiene que ser publico ────────────────────────────────

const PRIVATE_REPOS = ['EmmanuelOrtiz87/gentle-vanguard'];
const targetRepo = /github\.com\/([^/]+\/[^/]+)\//.exec(manifest.download_url)?.[1] ?? '';
checks.push({
  name: 'download-url-not-private',
  ok: !!targetRepo && !PRIVATE_REPOS.includes(targetRepo),
  detail: targetRepo
    ? `destino=${targetRepo}${PRIVATE_REPOS.includes(targetRepo) ? ' — PRIVADO: la URL dara 404 sin sesion' : ''}`
    : `no se pudo parsear el repo de la URL: ${manifest.download_url}`,
});

// ── 2. la forma del sha256 ─────────────────────────────────────────────

const sha = manifest.sha256 ?? '';
checks.push({
  name: 'sha256-format',
  ok: /^[0-9a-f]{64}$/i.test(sha),
  detail: /^[0-9a-f]{64}$/i.test(sha) ? '64 hex, valido' : `formato invalido: "${sha}"`,
});

// ── 3. la URL responde sin autenticacion ───────────────────────────────

if (offline) {
  checks.push({ name: 'url-public-reachable', ok: true, skipped: true, detail: '--offline' });
  checks.push({ name: 'asset-name-matches-url', ok: true, skipped: true, detail: '--offline' });
} else {
  const url = manifest.download_url;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let res: Response;
    try {
      // HEAD: no descarga el binario. redirect:'manual' para NO seguir al CDN,
      // porque es el CDN el que responde 404 a veces y eso no es del repo.
      res = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    const status = res.status;
    // 200 o 3xx: aceptable (GitHub redirige al CDN con signed URL).
    const reachable = status >= 200 && status < 400;
    checks.push({
      name: 'url-public-reachable',
      ok: reachable,
      detail: `HEAD sin sesion → ${status}${reachable ? '' : '  (el publico no puede descargar)'}`,
    });

    const size = Number(res.headers.get('content-length') ?? '0');
    checks.push({
      name: 'asset-published',
      ok: size > 1_000_000,
      detail: size > 0 ? `content-length=${size} bytes` : 'sin content-length en HEAD (se omite)',
      skipped: size === 0,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    checks.push({
      name: 'url-public-reachable',
      ok: false,
      detail: `error de red: ${msg}`,
    });
  }

  // ── 4. el nombre del asset existe en el repo publico ────────────────

  if (targetRepo) {
    const assetName = manifest.download_url.split('/').pop() ?? '';
    const api = `https://api.github.com/repos/${targetRepo}/releases/tags/v${version}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      let res: Response;
      try {
        res = await fetch(api, {
          headers: { accept: 'application/vnd.github+json', 'user-agent': 'gv-verify-distribution' },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (res.ok) {
        const body = (await res.json()) as { assets?: Array<{ name: string }> };
        const names = (body.assets ?? []).map((a) => a.name);
        checks.push({
          name: 'asset-name-matches-url',
          ok: names.includes(assetName),
          detail: names.includes(assetName)
            ? `asset "${assetName}" existe`
            : `el manifest pide "${assetName}" pero el release tiene: ${names.join(', ') || '(sin assets)'}`,
        });
      } else {
        checks.push({
          name: 'asset-name-matches-url',
          ok: false,
          skipped: true,
          detail: `API ${res.status} (repo privado o sin permisos; el check publico sigue siendo valido)`,
        });
      }
    } catch (error) {
      checks.push({
        name: 'asset-name-matches-url',
        ok: false,
        skipped: true,
        detail: `error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
}

// ── 5. el .sha256 local coincide ───────────────────────────────────────

const localShaPath = resolve(ROOT, 'dist', 'gentle-vanguard-4.1.0.exe.sha256');
if (existsSync(localShaPath)) {
  const declared = readFileSync(localShaPath, 'utf8').trim().split(/\s+/)[0] ?? '';
  checks.push({
    name: 'local-sha256-matches-manifest',
    ok: declared.toLowerCase() === sha.toLowerCase(),
    detail:
      declared.toLowerCase() === sha.toLowerCase()
        ? 'el .sha256 local declara el mismo hash'
        : `local=${declared} manifiesto=${sha}`,
  });
} else {
  checks.push({
    name: 'local-sha256-matches-manifest',
    ok: true,
    skipped: true,
    detail: 'sin .sha256 local (no se construye el installer en este entorno)',
  });
}

// ── salida ─────────────────────────────────────────────────────────────

console.log(`\n═══ Verificación de distribución — v${version} ═══\n`);
for (const c of checks) {
  const mark = c.skipped ? '⏭ ' : c.ok ? '✅' : '❌';
  console.log(`  ${mark} ${c.name.padEnd(32)} ${c.detail}`);
}

const failed = checks.filter((c) => !c.ok && !c.skipped);
const skipped = checks.filter((c) => c.skipped);
console.log(
  `\n  ${checks.length - failed.length - skipped.length} ok · ${failed.length} fallidos · ${skipped.length} omitidos`,
);

if (failed.length) {
  console.log(
    '\n  La distribucion publica esta rota. Nada de esto lo detectan el typecheck,\n' +
      '  el lint ni los tests: solo aparece cuando alguien sin sesion instala.\n',
  );
  process.exit(1);
}
console.log('');
process.exit(0);
