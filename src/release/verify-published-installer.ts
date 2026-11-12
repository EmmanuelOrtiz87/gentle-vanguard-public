#!/usr/bin/env node
/**
 * verify-published-installer.ts — gate de "un solo instalador" sobre un release.
 *
 * Uso en CI (public-installer-windows.yml):
 *   node --import tsx src/release/verify-published-installer.ts \
 *     --assets release-assets.json --exe dist/Gentle-Vanguard-Setup-X.exe \
 *     --sha dist/Gentle-Vanguard-Setup-X.exe.sha256 --json
 *
 * `--assets` acepta la salida cruda de la API de GitHub
 * (`gh release view <tag> --json assets`) o un array plano de assets.
 *
 * Sale 0 solo si: hay UN instalador, su checksum esta publicado, el instalador
 * descargado coincide con ese checksum y ningun asset de launcher compite.
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import {
  evaluateInstallerAssets,
  parseSha256File,
  digestMatches,
  type ReleaseAsset,
} from './installer-release-contract.js';

interface Args {
  assets: string;
  exe?: string;
  sha?: string;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { assets: '', json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--assets') args.assets = argv[++i] ?? '';
    else if (arg === '--exe') args.exe = argv[++i];
    else if (arg === '--sha') args.sha = argv[++i];
    else if (arg === '--json') args.json = true;
  }
  return args;
}

function readAssets(path: string): ReleaseAsset[] {
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
  // `gh release view --json assets` devuelve { assets: [...] }.
  if (Array.isArray(raw)) return raw as ReleaseAsset[];
  const obj = raw as { assets?: ReleaseAsset[] };
  if (Array.isArray(obj.assets)) return obj.assets;
  throw new Error('el archivo de assets no contiene un array ni { assets: [] }');
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  if (!args.assets) {
    console.error('[verify-published-installer] falta --assets <release-assets.json>');
    return 1;
  }
  let assets: ReleaseAsset[];
  try {
    assets = readAssets(args.assets);
  } catch (error) {
    console.error(
      `[verify-published-installer] no se pudieron leer los assets: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }

  const contract = evaluateInstallerAssets(assets);
  const problems: string[] = [];
  if (contract.verdict !== 'ok') problems.push(`${contract.verdict}: ${contract.detail}`);

  let computed: string | null = null;
  let published: string | null = null;
  if (contract.setup && args.exe && args.sha) {
    if (!existsSync(args.exe)) problems.push(`no existe el instalador descargado: ${args.exe}`);
    else if (!existsSync(args.sha)) problems.push(`no existe el checksum descargado: ${args.sha}`);
    else {
      computed = sha256File(args.exe);
      published = parseSha256File(readFileSync(args.sha, 'utf-8'));
      if (!published) problems.push(`el .sha256 publicado no contiene un SHA-256 valido: ${args.sha}`);
      else if (!digestMatches(computed, published))
        problems.push(`el instalador descargado no coincide con el checksum publicado (${computed})`);
    }
  } else if (contract.verdict === 'ok' && (!args.exe || !args.sha)) {
    problems.push('faltan --exe/--sha: el contrato exige verificar el binario descargado');
  }

  const verdict = {
    ok: problems.length === 0,
    contract: contract.verdict,
    detail: contract.detail,
    setup: contract.setup?.name ?? null,
    launchers: contract.launchers,
    computedSha256: computed,
    publishedSha256: published,
    problems,
  };

  if (args.json) console.log(JSON.stringify(verdict, null, 2));
  else console.log(`[verify-published-installer] ${verdict.ok ? 'PASS' : 'FAIL'}: ${contract.detail}`);

  return verdict.ok ? 0 : 1;
}

process.exitCode = main();
