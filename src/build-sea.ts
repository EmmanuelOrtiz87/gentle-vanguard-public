#!/usr/bin/env node
/**
 * Build SEA (Single Executable Application) — compiles Gentle-Vanguard CLI into a standalone .exe
 * using Node.js built-in SEA feature (Node >= 20.11.0).
 *
 * This eliminates the PS2EXE dependency for the launcher.
 *
 * Usage:
 *   npx tsx src/build-sea.ts                       # Build all SEA targets
 *   npx tsx src/build-sea.ts --target launcher     # Only the launcher
 *   npx tsx src/build-sea.ts --target cli          # Only the CLI
 *   npx tsx src/build-sea.ts --target all          # All targets
 *   npx tsx src/build-sea.ts --node-path "C:\Program Files\nodejs\node.exe"  # Custom node binary
 *   npx tsx src/build-sea.ts --json                # JSON output
 *
 * Prerequisites:
 *   - Node.js >= 20.11.0 (or Node 22+ for better SEA support)
 *   - pnpm build:mcp (compiles TS to JS in dist/)
 *   - On Windows: node.exe must be available
 *
 * Reference:
 *   https://nodejs.org/api/single-executable-applications.html
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync } from 'fs';
import { resolve, dirname, basename, extname } from 'path';
import { createRequire } from 'module';
import { runSync, runSyncShell } from './core/run-command.js';

const require = createRequire(import.meta.url);

interface SEATarget {
  name: string;
  entryTs: string;
  outputExe: string;
  description: string;
}

interface BuildResult {
  target: string;
  success: boolean;
  output: string;
  size?: number;
  error?: string;
}

const SEA_DIR = 'dist/sea';
const DIST_DIR = 'dist';

const TARGETS: SEATarget[] = [
  {
    name: 'launcher',
    entryTs: 'src/cli/gentle-vanguard.ts',
    outputExe: 'build/Gentle-Vanguard.exe',
    description: 'Gentle-Vanguard interactive setup wizard (replaces PS2EXE)',
  },
  {
    name: 'cli',
    entryTs: 'src/cli/gv.ts',
    outputExe: 'build/gv.exe',
    description: 'Gentle-Vanguard CLI shortcut (gv command)',
  },
  {
    name: 'protect',
    entryTs: 'src/cli/protect.ts',
    outputExe: 'build/protect.exe',
    description: 'Encryption / protect tool',
  },
];

function parseArgs(): { targets: string[]; nodePath: string; json: boolean; skipBuild: boolean } {
  const raw = process.argv.slice(2);
  const targetArg = extractArg(raw, '--target') || 'all';
  return {
    targets: targetArg === 'all' ? TARGETS.map((t) => t.name) : targetArg.split(','),
    nodePath: extractArg(raw, '--node-path') || process.execPath,
    json: raw.includes('--json'),
    skipBuild: raw.includes('--skip-build'),
  };
}

function extractArg(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function checkNodeVersion(): { ok: boolean; version: string } {
  const version = process.version;
  const match = version.match(/^v(\d+)\.(\d+)\.(\d+)/);
  if (!match) return { ok: false, version };
  const major = parseInt(match[1], 10);
  return {
    ok: major >= 22 || (major === 20 && parseInt(match[2], 10) >= 11),
    version,
  };
}

function compileTS(entry: string): string | null {
  const entryName = basename(entry, extname(entry));
  const outJs = resolve(process.cwd(), SEA_DIR, `${entryName}.cjs`);

  mkdirSync(dirname(outJs), { recursive: true });

  // Record the previous bundle state so we can detect a stale (unregenerated) build.
  const prevMtime = existsSync(outJs) ? statSync(outJs).mtimeMs : 0;
  const prevSize = existsSync(outJs) ? statSync(outJs).size : 0;

  // Use esbuild's JS API directly (no shell) — avoids cmd.exe quoting bugs
  // that corrupt Windows paths (e.g. leading spaces) and lets us check the
  // real exit status. Fallback to tsc if esbuild is unavailable.
  try {
    const esbuild = require('esbuild') as {
      buildSync: (opts: Record<string, unknown>) => { errors: unknown[] };
    };
    esbuild.buildSync({
      entryPoints: [resolve(process.cwd(), entry)],
      bundle: true,
      platform: 'node',
      target: 'node20',
      outfile: outJs,
      format: 'cjs',
      external: ['better-sqlite3'],
      logLevel: 'silent',
    });
    if (bundleChanged(outJs, prevMtime, prevSize)) {
      patchSeaBundle(outJs);
      return outJs;
    }
    console.error(`[SEA] esbuild did not produce ${basename(outJs)} — falling back to tsc`);
  } catch (err) {
    console.error(
      `[SEA] esbuild failed (${err instanceof Error ? err.message : String(err)}) — falling back to tsc`,
    );
  }

  // esbuild not available or failed — try tsc
  try {
    const tscResult = runSyncShell(
      `npx tsc "${resolve(process.cwd(), entry)}" --outDir "${resolve(process.cwd(), SEA_DIR)}" --module commonjs --target es2020 --moduleResolution node --skipLibCheck`,
      { timeout: 60000 },
    );
    if (tscResult.status === 0 && bundleChanged(outJs, prevMtime, prevSize)) {
      patchSeaBundle(outJs);
      return outJs;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * True when the bundle file was actually rewritten by the compiler
 * (mtime or size changed vs the recorded previous state).
 */
function bundleChanged(outJs: string, prevMtime: number, prevSize: number): boolean {
  if (!existsSync(outJs)) return false;
  const cur = statSync(outJs);
  return cur.mtimeMs !== prevMtime || cur.size !== prevSize;
}

/**
 * Patch esbuild's CJS output for SEA compatibility.
 *
 * esbuild emits `var import_meta = {};` followed by
 * `createRequire(import_meta.url)` when the source uses `import.meta.url`.
 * Inside a Node SEA binary `import.meta` is `{}`, so `import_meta.url` is
 * `undefined` and `createRequire(undefined)` throws
 * `ERR_INVALID_ARG_VALUE`. Replace the empty shim with a real file URL
 * derived from `__filename`.
 */
function patchSeaBundle(outJs: string): void {
  try {
    let content = readFileSync(outJs, 'utf8');
    const brokenShim = /var import_meta = \{\};/;
    if (brokenShim.test(content)) {
      content = content.replace(
        brokenShim,
        'var import_meta = { url: require("url").pathToFileURL(__filename).href };',
      );
      writeFileSync(outJs, content, 'utf8');
      console.error(`[SEA] Patched import_meta shim in ${basename(outJs)}`);
    }
  } catch (err) {
    console.error(
      `[SEA] Warning: could not patch import_meta shim in ${basename(outJs)}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

function buildSEA(target: SEATarget, nodePath: string, skipBuild: boolean): BuildResult {
  const result: BuildResult = { target: target.name, success: false, output: '' };

  try {
    console.error(`[SEA] Building: ${target.name} (${target.description})`);

    // Step 1: Compile TS to JS
    let jsFile: string | null = null;
    if (!skipBuild) {
      jsFile = compileTS(target.entryTs);
      if (!jsFile || !existsSync(jsFile)) {
        result.error = `Compilation failed for ${target.entryTs}`;
        return result;
      }
    } else {
      // Use pre-built file from dist/
      const jsPath = resolve(
        process.cwd(),
        DIST_DIR,
        target.entryTs.replace(/\.ts$/, '.js').replace('src/', ''),
      );
      if (existsSync(jsPath)) jsFile = jsPath;
      else {
        const altPath = resolve(
          process.cwd(),
          DIST_DIR,
          target.entryTs.replace(/\.ts$/, '.mjs').replace('src/', ''),
        );
        if (existsSync(altPath)) jsFile = altPath;
      }
      if (!jsFile) {
        result.error = `No pre-built JS found. Run 'pnpm build:mcp' first or omit --skip-build.`;
        return result;
      }
    }

    // Step 2: Ensure the JS file has a hashbang (needed for SEA)
    let jsContent = readFileSync(jsFile, 'utf8');
    if (!jsContent.startsWith('#!')) {
      jsContent = '#!/usr/bin/env node\n' + jsContent;
      writeFileSync(jsFile, jsContent);
    }

    // Step 3: Create SEA config
    const seaConfig = {
      main: jsFile.replace(/\\/g, '/'),
      output: resolve(process.cwd(), SEA_DIR, `${target.name}.blob`).replace(/\\/g, '/'),
      disableExperimentalSEAWarning: true,
    };
    const configPath = resolve(process.cwd(), SEA_DIR, `${target.name}-sea-config.json`);
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(seaConfig, null, 2));

    // Step 4: Generate SEA blob
    const nodeMajor = parseInt(process.version.match(/^v(\d+)/)?.[1] ?? '0', 10);
    const seaConfigFlag =
      nodeMajor >= 22 ? '--experimental-sea-config' : '--experimental-sea-config';

    const blobResult = runSync('node', [seaConfigFlag, configPath], {
      timeout: 30000,
    });

    if (blobResult.status !== 0) {
      result.error = `SEA blob generation failed (exit code: ${blobResult.status ?? 'unknown'})`;
      return result;
    }

    // Step 5: Copy node binary and inject blob
    const outputPath = resolve(process.cwd(), target.outputExe);
    mkdirSync(dirname(outputPath), { recursive: true });

    // Remove existing output first to ensure clean copy (prevents locked file issues)
    if (existsSync(outputPath)) {
      try {
        runSyncShell(`del "${outputPath}" 2>nul`);
      } catch {
        try {
          require('fs').unlinkSync(outputPath);
        } catch {}
      }
    }

    // Copy node.exe as base
    try {
      copyFileSync(nodePath, outputPath);
    } catch (err) {
      result.error = `Failed to copy Node binary from ${nodePath}: ${err}`;
      return result;
    }

    // Step 6: Post-process — inject the blob into the copied binary
    // This requires `node --experimental-sea-config` which generates the blob,
    // then `postject` to inject it into the copied binary.
    // Postject is the official Node.js tool for SEA injection.

    // Try using postject (check common install paths)
    const blobFile = resolve(process.cwd(), SEA_DIR, `${target.name}.blob`);
    if (!existsSync(blobFile)) {
      result.error = `SEA blob not found at ${blobFile}`;
      return result;
    }

    // Find postject's cli.js (call via node directly — avoids .cmd argument issues)
    const postjectCandidates = [
      resolve(process.cwd(), 'node_modules', 'postject', 'dist', 'cli.js'),
      'C:\\Users\\emman\\AppData\\Roaming\\npm\\node_modules\\postject\\dist\\cli.js',
      'C:\\Users\\emman\\AppData\\Roaming\\npm\\node_modules\\@postject\\cli.js',
    ];

    let postjectArgs: [string, string[]] = ['postject', []];
    for (const cliPath of postjectCandidates) {
      if (existsSync(cliPath)) {
        postjectArgs = [process.execPath, [cliPath]];
        break;
      }
    }

    const postjectCmd = postjectArgs[0];
    const postjectBaseArgs = postjectArgs[1];
    const postjectCallArgs = [
      ...postjectBaseArgs,
      outputPath,
      'NODE_SEA_BLOB',
      blobFile,
      '--sentinel-fuse',
      'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
      '--macho-segment-name',
      'NODE_SEA',
      '--overwrite',
    ];

    const postjectResult = runSync(postjectCmd, postjectCallArgs, { timeout: 30000 });

    if (postjectResult.status !== 0 && postjectResult.status !== null) {
      // postject not available or failed — the blob was still generated,
      // but the .exe won't be self-contained. Provide instructions.
      result.error = `Postject failed (install with: npm install -g postject). Blob available at ${blobFile}`;
      result.output = blobFile;
      result.success = true;
      return result;
    }

    // Verify the output
    if (!existsSync(outputPath)) {
      result.error = `Output binary not found at ${outputPath}`;
      return result;
    }

    const stats = readFileSync(outputPath);
    result.success = true;
    result.output = outputPath;
    result.size = stats.length;

    return result;
  } catch (err) {
    result.error = `Build failed: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }
}

function main(): void {
  const args = parseArgs();
  const versionCheck = checkNodeVersion();
  const results: BuildResult[] = [];

  console.error(`\n╔═══ Node SEA Builder ═══════════════════`);
  console.error(
    `║ Node: ${versionCheck.version} ${versionCheck.ok ? '✅' : '⚠️  (SEA requires Node >= 20.11.0)'}`,
  );
  console.error(`║ Targets: ${args.targets.join(', ')}`);
  console.error(`╚${'═'.repeat(40)}`);

  if (!versionCheck.ok) {
    console.error(
      `\n[SEA] ⚠️  Node ${versionCheck.version} may not support SEA fully. Node 22+ recommended.`,
    );
  }

  for (const targetName of args.targets) {
    const target = TARGETS.find((t) => t.name === targetName);
    if (!target) {
      console.error(
        `[SEA] Unknown target: ${targetName}. Available: ${TARGETS.map((t) => t.name).join(', ')}`,
      );
      results.push({ target: targetName, success: false, output: '', error: 'Unknown target' });
      continue;
    }
    const result = buildSEA(target, args.nodePath, args.skipBuild);
    results.push(result);
  }

  if (args.json) {
    console.log(JSON.stringify(results, null, 2));
    process.exit(results.every((r) => r.success) ? 0 : 1);
  }

  console.error(`\n📦 SEA Build Results:`);
  for (const r of results) {
    if (r.success) {
      const sizeKB = r.size ? (r.size / 1024).toFixed(1) : '?';
      console.error(`   ✅ ${r.target}: ${r.output || r.output} (${sizeKB} KB)`);
    } else {
      console.error(`   ❌ ${r.target}: ${r.error}`);
    }
  }

  if (!results.every((r) => r.success)) {
    console.error(`\n⚠️  Some builds failed. Install postject for full SEA support:`);
    console.error(`   npm install -g postject`);
    process.exit(1);
  }

  console.error(`\n✅ SEA build complete! Run:`);
  for (const r of results) {
    if (r.success && r.output && !r.output.endsWith('.blob')) {
      console.error(`   ${r.output}`);
    }
  }
}

main();
