/** MCP stdio entrypoints in this Node process: no cmd/npx wrapper or child to orphan. */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readState as readCodegraphState } from '../ops/codegraph-toggle.js';
import { activationFor, loadPolicy } from '../mcp/mcp-policy.js';

const ROOT = resolve(import.meta.dirname, '../..');
const PACKAGES: Record<
  string,
  { name: string; version: string; bin: string; workspace?: boolean }
> = {
  codegraph: {
    name: '@colbymchenry/codegraph',
    version: '0.8.0',
    bin: 'codegraph',
    workspace: true,
  },
  'chrome-devtools': { name: 'chrome-devtools-mcp', version: '1.13.0', bin: 'chrome-devtools-mcp' },
  filesystem: {
    name: '@modelcontextprotocol/server-filesystem',
    version: '2.3.0',
    bin: 'mcp-server-filesystem',
  },
  memory: {
    name: '@modelcontextprotocol/server-memory',
    version: '2.1.1',
    bin: 'mcp-server-memory',
  },
};

export function resolveNativeEntry(name: string, store: string, root = ROOT): string {
  const spec = PACKAGES[name];
  if (!spec) throw new Error(`Unknown native MCP: ${name}`);
  const pkgDir = join(
    spec.workspace ? root : join(store, `${name}-${spec.version}`),
    'node_modules',
    spec.name,
  );
  const manifest = join(pkgDir, 'package.json');
  if (!existsSync(manifest))
    throw new Error(
      `Missing ${spec.name}; run node --import tsx src/tools/mcp-native-launch.ts --bootstrap`,
    );
  const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as {
    name: string;
    version: string;
    bin: string | Record<string, string>;
  };
  if (pkg.name !== spec.name || pkg.version !== spec.version)
    throw new Error(
      `Unexpected package/version for ${name}; expected ${spec.name}@${spec.version}`,
    );
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[spec.bin];
  if (!bin) throw new Error(`Missing bin for ${name}`);
  const entry = resolve(pkgDir, bin);
  const rel = relative(pkgDir, entry);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\'))
    throw new Error(`Unsafe bin for ${name}`);
  if (!existsSync(entry)) throw new Error(`Missing entrypoint for ${name}; rerun --bootstrap`);
  return entry;
}

function bootstrap(store: string): void {
  // Preserve each already-installed dependency tree. Re-resolving ranges via npm offline
  // can request newer transitive packages absent from cache; merging trees can break peers.
  const cache =
    process.env.npm_config_cache ??
    (process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData/Local'), 'npm-cache')
      : join(homedir(), '.npm'));
  const npx = join(cache, '_npx');
  for (const [name, spec] of Object.entries(PACKAGES)) {
    if (spec.workspace) continue;
    const target = join(store, `${name}-${spec.version}`);
    if (existsSync(target)) {
      resolveNativeEntry(name, store);
      continue;
    }
    const source = readdirSync(npx)
      .map((d) => join(npx, d, 'node_modules'))
      .find((modules) => {
        try {
          const pkg = JSON.parse(readFileSync(join(modules, spec.name, 'package.json'), 'utf8'));
          return pkg.name === spec.name && pkg.version === spec.version;
        } catch {
          return false;
        }
      });
    if (!source)
      throw new Error(
        `Installed ${spec.name}@${spec.version} not found; no download or shell fallback`,
      );
    mkdirSync(store, { recursive: true });
    cpSync(source, join(target, 'node_modules'), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    resolveNativeEntry(name, store);
  }
  for (const name of Object.keys(PACKAGES)) resolveNativeEntry(name, store);
  console.error(
    '[mcp-native] Preserved installed pinned dependency trees offline; entrypoints verified',
  );
}

/**
 * Una capacidad APAGADA por decision declarada no se lanza, aunque su binario
 * siga instalado y aunque alguien invoque el launcher a mano.
 *
 * POR QUE (2026-11-18): el launcher era el ultimo consumidor que no consultaba
 * la decision: `codegraph` estaba apagado en la politica y en el config, pero
 * `node src/tools/mcp-native-launch.ts codegraph serve --mcp` lo levantaba
 * igual (PID 32888 medido). El consumidor que no pregunta, deshace.
 */
function assertCapabilityEnabled(name: string): void {
  if (name === 'codegraph') {
    const state = readCodegraphState(ROOT);
    if (state.enabled === false) {
      throw new Error(
        `codegraph esta apagado por decision declarada (${state.reason ?? 'sin motivo declarado'}). ` +
          'Reactivar con: npm run codegraph:enable',
      );
    }
  }
  const activation = activationFor(loadPolicy(ROOT), name, 'repo');
  if (activation === 'disabled-by-policy') {
    throw new Error(`${name} esta deshabilitado por politica (config/mcp-lifecycle-policy.json)`);
  }
}

async function main(): Promise<void> {
  const [name, ...args] = process.argv.slice(2);
  const store = process.env.GV_MCP_TOOLS_DIR ?? join(ROOT, '.runtime/mcp-native-tools');
  if (name === '--bootstrap') return bootstrap(store);
  assertCapabilityEnabled(name);
  const entry = resolveNativeEntry(name, store);
  if (name === 'memory' && !process.env.MEMORY_FILE_PATH) {
    const dir = join(ROOT, '.runtime/mcp-memory');
    mkdirSync(dir, { recursive: true });
    process.env.MEMORY_FILE_PATH = join(dir, 'knowledge.jsonl');
  }
  // CLI parsers see their own argv; dynamic import preserves PID and stdio protocol.
  process.argv = [process.execPath, entry, ...args];
  await import(pathToFileURL(entry).href);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[mcp-native] ${String(error)}`);
    process.exitCode = 1;
  });
}
