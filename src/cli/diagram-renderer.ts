#!/usr/bin/env node
/**
 * Diagram Renderer CLI — renders Graphviz DOT and PlantUML diagrams to SVG/PNG/HTML.
 * Falls back to viz.js WASM or plantuml.com online renderer when native binaries unavailable.
 *
 * Usage:
 *   npx tsx src/cli/diagram-renderer.ts input.dot --output diagram.svg
 *   npx tsx src/cli/diagram-renderer.ts --dot "digraph { A -> B; }" --output graph.svg
 *   npx tsx src/cli/diagram-renderer.ts docs/diagrams/ --output-dir docs/generated/
 *   npx tsx src/cli/diagram-renderer.ts --from-codegraph --module src/core --output arch.svg
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  statSync,
} from 'fs';
import { resolve, dirname, extname, basename, relative, join } from 'path';
import { runSync } from '../core/run-command.js';

interface RenderArgs {
  input: string;
  output: string;
  outputDir: string;
  format: string;
  dotInline: string;
  watch: boolean;
  fromCodegraph: boolean;
  codegraphModule: string;
  codegraphDepth: number;
  codegraphAll: boolean;
  json: boolean;
}

interface RenderResult {
  success: boolean;
  input: string;
  output: string;
  format: string;
  engine: string;
  size: number;
  error?: string;
}

function parseArgs(): RenderArgs {
  const raw = process.argv.slice(2);
  const positional: string[] = [];
  let output = '';
  let outputDir = '';
  let format = 'svg';
  let dotInline = '';
  let watch = false;
  let fromCodegraph = false;
  let codegraphModule = '';
  let codegraphDepth = 2;
  let codegraphAll = false;
  let json = false;

  for (let i = 0; i < raw.length; i++) {
    switch (raw[i]) {
      case '--output':
        output = raw[++i] || '';
        break;
      case '--output-dir':
        outputDir = raw[++i] || '';
        break;
      case '--format':
        format = raw[++i] || 'svg';
        break;
      case '--dot':
        dotInline = raw[++i] || '';
        break;
      case '--watch':
        watch = true;
        break;
      case '--from-codegraph':
        fromCodegraph = true;
        break;
      case '--module':
        codegraphModule = raw[++i] || '';
        break;
      case '--depth':
        codegraphDepth = parseInt(raw[++i] || '2', 10);
        break;
      case '--all-modules':
        codegraphAll = true;
        break;
      case '--json':
        json = true;
        break;
      default:
        if (!raw[i].startsWith('--')) positional.push(raw[i]);
    }
  }

  return {
    input: positional[0] || '',
    output,
    outputDir,
    format,
    dotInline,
    watch,
    fromCodegraph,
    codegraphModule,
    codegraphDepth,
    codegraphAll,
    json,
  };
}

function detectEngine(): 'graphviz-cli' | 'viz-js' | 'plantuml-cli' | 'plantuml-http' | 'unknown' {
  // Try native Graphviz
  try {
    const result = runSync('dot', ['-V'], { timeout: 5000 });
    if (result.status === 0) return 'graphviz-cli';
  } catch {
    /* not found */
  }

  // Try native PlantUML
  try {
    const result = runSync('java', ['-jar', 'plantuml.jar', '-version'], {
      timeout: 5000,
    });
    if (result.status === 0) return 'plantuml-cli';
  } catch {
    /* not found */
  }

  // Check local plantuml.jar
  const jarPath = resolve(process.cwd(), 'plantuml.jar');
  if (existsSync(jarPath)) return 'plantuml-cli';

  return 'viz-js'; // Fallback to viz.js HTML
}

async function renderGraphviz(
  dotContent: string,
  format: string,
  outputPath: string,
): Promise<string | null> {
  const engine = detectEngine();

  if (engine === 'graphviz-cli') {
    const tmpFile = resolve(process.cwd(), `.tmp/diagram-${Date.now()}.dot`);
    mkdirSync(dirname(tmpFile), { recursive: true });
    writeFileSync(tmpFile, dotContent);

    const outFormat = format === 'svg' ? 'svg' : format === 'png' ? 'png' : 'svg';
    try {
      // Array form: paths may contain spaces — shell quoting is unreliable.
      const r = runSync('dot', ['-T' + outFormat, tmpFile, '-o', outputPath], {
        timeout: 30000,
      });
      if (r.status !== 0) throw new Error(r.stderr || `dot exited ${r.status}`);
      return outputPath;
    } catch (err) {
      console.error(`[DIAGRAM] Graphviz render failed: ${err}`);
      return null;
    } finally {
      try {
        rmSync(tmpFile, { force: true });
      } catch {
        /* ignore */
      }
    }
  }

  // Fallback: generate HTML with viz.js CDN
  const safeId = `graph_${Date.now()}`;
  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.jsdelivr.net/npm/@viz-js/viz@3.9.0/lib/viz-standalone.min.js"></script>
  <style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#fff}</style>
</head>
<body>
  <div id="${safeId}"></div>
  <script>
    Viz.instance().then(viz => {
      document.getElementById('${safeId}').innerHTML = viz.renderSVGElement(\`${escapeForJs(dotContent)}\`);
    }).catch(console.error);
  </script>
</body>
</html>`;

  writeFileSync(outputPath.replace(/\.\w+$/, '.html'), htmlContent);
  console.warn(`[DIAGRAM] Graphviz CLI not found. Generated HTML+JS fallback (requires browser).`);
  return outputPath.replace(/\.\w+$/, '.html');
}

function renderPlantUml(pumlContent: string, format: string, outputPath: string): string | null {
  const jarPath = resolve(process.cwd(), 'plantuml.jar');
  const outFormat = format === 'png' ? 'png' : 'svg';

  if (existsSync(jarPath)) {
    const tmpFile = resolve(process.cwd(), `.tmp/diagram-${Date.now()}.puml`);
    mkdirSync(dirname(tmpFile), { recursive: true });
    writeFileSync(tmpFile, pumlContent);

    try {
      const r = runSync(
        'java',
        ['-jar', jarPath, '-t' + outFormat, tmpFile, '-o', dirname(outputPath)],
        {
          timeout: 30000,
        },
      );
      if (r.status !== 0) throw new Error(r.stderr || `java exited ${r.status}`);
      return outputPath;
    } catch (err) {
      console.error(`[DIAGRAM] PlantUML render failed: ${err}`);
      return null;
    } finally {
      try {
        rmSync(tmpFile, { force: true });
      } catch {
        /* ignore */
      }
    }
  }

  // Fallback: PlantUML online server
  const encoded = Buffer.from(pumlContent).toString('base64url');
  const url = `https://www.plantuml.com/plantuml/${outFormat}/${encoded}`;
  console.warn(`[DIAGRAM] PlantUML jar not found. Online URL: ${url}`);
  console.warn(`[DIAGRAM] Download: wget "${url}" -O "${outputPath}"`);
  return url;
}

function escapeForJs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$').replace(/'/g, "\\'");
}

function detectInputType(content: string): 'dot' | 'puml' {
  const trimmed = content.trim();
  if (trimmed.startsWith('@start')) return 'puml';
  if (trimmed.startsWith('digraph') || trimmed.startsWith('graph') || trimmed.startsWith('strict'))
    return 'dot';
  return 'dot'; // default
}

async function renderFile(inputPath: string, args: RenderArgs): Promise<RenderResult> {
  const fullPath = resolve(process.cwd(), inputPath);
  if (!existsSync(fullPath)) {
    return {
      success: false,
      input: inputPath,
      output: '',
      format: args.format,
      engine: 'unknown',
      size: 0,
      error: `File not found: ${inputPath}`,
    };
  }

  const content = readFileSync(fullPath, 'utf8');
  const inputType = detectInputType(content);
  const ext = extname(fullPath).toLowerCase();
  const name = basename(fullPath, ext);

  const outDir = args.outputDir ? resolve(process.cwd(), args.outputDir) : dirname(fullPath);
  const outputPath = args.output
    ? resolve(process.cwd(), args.output)
    : resolve(outDir, `${name}.${args.format}`);

  mkdirSync(dirname(outputPath), { recursive: true });

  let result: string | null = null;
  let engine = '';

  if (inputType === 'dot' || ext === '.dot' || ext === '.gv') {
    engine = detectEngine();
    if (engine === 'graphviz-cli') engine = 'Graphviz CLI';
    else engine = 'viz.js (HTML fallback)';
    result = await renderGraphviz(content, args.format, outputPath);
  } else {
    engine = detectEngine();
    if (engine === 'plantuml-cli' || existsSync(resolve(process.cwd(), 'plantuml.jar')))
      engine = 'PlantUML CLI';
    else engine = 'PlantUML HTTP (online fallback)';
    result = renderPlantUml(content, args.format, outputPath);
  }

  if (!result) {
    return {
      success: false,
      input: inputPath,
      output: '',
      format: args.format,
      engine,
      size: 0,
      error: 'Render failed',
    };
  }

  const resultPath = result.startsWith('http') ? result : result;
  const fileSize = result.startsWith('http') ? 0 : statSync(resultPath).size;

  return {
    success: true,
    input: inputPath,
    output: resultPath,
    format: args.format,
    engine,
    size: fileSize,
  };
}

async function generateFromCodegraph(args: RenderArgs): Promise<string | null> {
  // Read CodeGraph index and generate DOT representation
  const graphPath = resolve(process.cwd(), '.codegraph', 'graph.json');
  const graphifyPath = resolve(process.cwd(), 'graphify-out', 'graph.json');

  let graphData: any = null;

  for (const gp of [graphPath, graphifyPath]) {
    if (existsSync(gp)) {
      try {
        graphData = JSON.parse(readFileSync(gp, 'utf8'));
        break;
      } catch {
        /* try next */
      }
    }
  }

  if (!graphData) {
    console.error('[DIAGRAM] No CodeGraph index found. Run codegraph-sync first.');
    return null;
  }

  const nodes = graphData.nodes || [];
  const edges = graphData.edges || graphData.links || [];

  // Filter by module if specified
  let filteredNodes = nodes;
  if (args.codegraphModule) {
    filteredNodes = nodes.filter((n: any) => {
      const id = n.id || n.name || '';
      return id.includes(args.codegraphModule);
    });
  }

  if (filteredNodes.length === 0) {
    console.error(`[DIAGRAM] No nodes found for module: ${args.codegraphModule}`);
    return null;
  }

  // Build DOT
  const nodeIds = new Set(
    filteredNodes.map((n: any) => {
      const id = (n.id || n.name || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_');
      return id;
    }),
  );

  let dot = 'digraph CodeGraph {\n';
  dot += '  rankdir=LR;\n';
  dot += '  node [shape=box, style=rounded, fillcolor=lightyellow, style=filled];\n';
  dot += '  edge [color=#666, arrowhead=vee];\n\n';

  for (const n of filteredNodes) {
    const id = (n.id || n.name || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_');
    const label = (n.label || n.name || id).replace(/"/g, '\\"');
    dot += `  "${id}" [label="${label}"];\n`;
  }

  dot += '\n';
  for (const e of edges) {
    const src = (e.source || e.from || '').replace(/[^a-zA-Z0-9_]/g, '_');
    const tgt = (e.target || e.to || '').replace(/[^a-zA-Z0-9_]/g, '_');
    if (nodeIds.has(src) && nodeIds.has(tgt)) {
      const label = (e.label || e.type || '').replace(/"/g, '\\"');
      dot += `  "${src}" -> "${tgt}"${label ? ` [label="${label}"]` : ''};\n`;
    }
  }

  dot += '}\n';

  // Write to temp file and render
  const tmpDir = resolve(process.cwd(), '.tmp');
  mkdirSync(tmpDir, { recursive: true });
  const dotFile = resolve(tmpDir, `codegraph-${Date.now()}.dot`);
  writeFileSync(dotFile, dot);

  const outputPath =
    args.output || resolve(process.cwd(), 'docs/diagrams/codegraph-architecture.svg');
  mkdirSync(dirname(outputPath), { recursive: true });

  const result = await renderGraphviz(dot, args.format, outputPath);
  if (result) {
    console.log(`[DIAGRAM] ✅ CodeGraph architecture diagram: ${result}`);
  }
  return result;
}

async function main(): Promise<void> {
  const args = parseArgs();

  // Watch mode
  if (args.watch && args.input) {
    console.error(`[DIAGRAM] Watching: ${args.input}`);
    const watchDir = resolve(process.cwd(), args.input);
    // Simple polling watch
    const fileTimestamps = new Map<string, number>();

    // Initial render
    const files = existsSync(watchDir)
      ? readdirSync(watchDir).filter(
          (f) => f.endsWith('.dot') || f.endsWith('.gv') || f.endsWith('.puml'),
        )
      : [args.input];

    for (const f of files) {
      const fp = resolve(watchDir, f);
      if (existsSync(fp)) {
        fileTimestamps.set(fp, statSync(fp).mtimeMs);
        const result = await renderFile(fp, args);
        if (result.success) {
          console.log(`[DIAGRAM] ✅ Rendered: ${relative(process.cwd(), result.output)}`);
        } else {
          console.error(`[DIAGRAM] ❌ ${result.error}`);
        }
      }
    }

    console.error(`[DIAGRAM] Watching for changes... (Ctrl+C to stop)`);
    const interval = setInterval(async () => {
      for (const [fp, mtime] of fileTimestamps.entries()) {
        if (existsSync(fp)) {
          const newMtime = statSync(fp).mtimeMs;
          if (newMtime > mtime) {
            fileTimestamps.set(fp, newMtime);
            console.error(`[DIAGRAM] Change detected: ${basename(fp)}`);
            const result = await renderFile(fp, args);
            if (result.success) {
              console.log(`[DIAGRAM] ✅ Re-rendered: ${relative(process.cwd(), result.output)}`);
            } else {
              console.error(`[DIAGRAM] ❌ ${result.error}`);
            }
          }
        }
      }
    }, 2000);

    process.on('SIGINT', () => {
      clearInterval(interval);
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      clearInterval(interval);
      process.exit(0);
    });
    return;
  }

  // CodeGraph mode
  if (args.fromCodegraph) {
    await generateFromCodegraph(args);
    return;
  }

  // Inline DOT mode
  if (args.dotInline) {
    const outputPath =
      args.output || resolve(process.cwd(), `docs/diagrams/diagram-${Date.now()}.svg`);
    mkdirSync(dirname(outputPath), { recursive: true });
    const result = await renderGraphviz(args.dotInline, args.format, outputPath);
    if (result) {
      console.log(`[DIAGRAM] ✅ Rendered: ${result}`);
    }
    return;
  }

  // File or directory mode
  if (!args.input) {
    console.error(`[DIAGRAM] Usage:`);
    console.error(`  npx tsx src/cli/diagram-renderer.ts input.dot --output output.svg`);
    console.error(
      `  npx tsx src/cli/diagram-renderer.ts --dot "digraph { A -> B; }" --output graph.svg`,
    );
    console.error(
      `  npx tsx src/cli/diagram-renderer.ts docs/diagrams/ --output-dir docs/generated/`,
    );
    console.error(
      `  npx tsx src/cli/diagram-renderer.ts --from-codegraph --module src/core --output arch.svg`,
    );
    process.exit(1);
  }

  const inputPath = resolve(process.cwd(), args.input);

  if (!existsSync(inputPath)) {
    console.error(`[DIAGRAM] Not found: ${args.input}`);
    process.exit(1);
  }

  // Directory — batch render
  if (statSync(inputPath).isDirectory()) {
    const diagramFiles = readdirSync(inputPath).filter(
      (f) => f.endsWith('.dot') || f.endsWith('.gv') || f.endsWith('.puml') || f.endsWith('.wsd'),
    );

    if (diagramFiles.length === 0) {
      console.error(`[DIAGRAM] No diagram files found in: ${args.input}`);
      process.exit(1);
    }

    console.error(`[DIAGRAM] Batch rendering ${diagramFiles.length} files from ${args.input}`);
    const results: RenderResult[] = [];
    let passed = 0;
    let failed = 0;

    for (const f of diagramFiles) {
      const fp = join(args.input, f);
      const result = await renderFile(fp, args);
      results.push(result);
      if (result.success) {
        passed++;
        console.log(
          `  ✅ ${f} → ${relative(process.cwd(), result.output)} (${(result.size / 1024).toFixed(1)} KB)`,
        );
      } else {
        failed++;
        console.error(`  ❌ ${f}: ${result.error}`);
      }
    }

    if (args.json) {
      console.log(JSON.stringify(results, null, 2));
    }
    console.error(`\n[DIAGRAM] Batch complete: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
    return;
  }

  // Single file
  const result = await renderFile(args.input, args);
  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  }
  if (result.success) {
    console.log(
      `[DIAGRAM] ✅ Rendered: ${result.output} (${(result.size / 1024).toFixed(1)} KB, ${result.engine})`,
    );
    process.exit(0);
  } else {
    console.error(`[DIAGRAM] ❌ ${result.error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[DIAGRAM] Fatal error:', err);
  process.exit(1);
});
