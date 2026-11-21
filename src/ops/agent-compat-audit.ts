/**
 * agent-compat-audit — score de compatibilidad AGENTE del repo (backlog
 * absorcion cursor/plugins 2026-11-21, item #1).
 *
 * Idea upstream (agent-compatibility): medir cuánta adivinanza necesita un
 * agente para (1) arrancar, (2) verificar un cambio chico, (3) confiar en los
 * docs. Nuestro eje MCP ya declara declarado→alcanzable→descubrible→operable
 * para CAPACIDADES; esto extiende ese eje al REPO entero.
 *
 * Determinístico, solo-lectura, <10s. Tres dimensiones:
 *  - startup: el comando de session-start documentado existe en package.json;
 *    el canon .mcp.json declara los servers always-on de la política.
 *  - validation-loop: scripts canónicos (typecheck/test/lint) presentes y el
 *    ciclo pre-commit tiene gates reales (lefthook + config).
 *  - docs-reliability: cada `npm run X` citado en AGENTS.md y docs canon
 *    existe en package.json (doc que cita un comando inexistente = mentira
 *    en la sala).
 *
 * Score = redondeo de (startup*0.3 + validation*0.3 + docs*0.4), 0-100, con
 * top-fixes accionables. Uso: npm run agent:compat [--json]
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');

interface DimensionResult {
  score: number; // 0-100
  checks: Array<{ name: string; ok: boolean; detail: string }>;
  fixes: string[];
}

function readJson(root: string, path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(join(root, path), 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Todos los `npm run X` citados en los docs canónicos que un agente lee frío. */
function citedNpmScripts(root = ROOT): Array<{ cmd: string; source: string }> {
  const sources = ['AGENTS.md', 'README.md', 'docs/stack-manual-modules.md'];
  const out: Array<{ cmd: string; source: string }> = [];
  const re = /npm run ([a-z0-9:_-]+)/gi;
  for (const src of sources) {
    const p = join(root, src);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, 'utf8');
    for (const m of text.matchAll(re)) out.push({ cmd: m[1], source: src });
  }
  return out;
}

function scoreStartup(root = ROOT): DimensionResult {
  const checks: DimensionResult['checks'] = [];
  const fixes: string[] = [];
  const pkg = readJson(root, 'package.json') as { scripts?: Record<string, string> } | null;
  const scripts = pkg?.scripts ?? {};
  const agents = existsSync(join(root, 'AGENTS.md'))
    ? readFileSync(join(root, 'AGENTS.md'), 'utf8')
    : '';
  const sessionCmd = agents.match(/npm run (session:autostart:[\w:-]+)/)?.[1];
  checks.push({
    name: 'session-start documentado',
    ok: Boolean(sessionCmd) && Boolean(scripts[sessionCmd ?? '']),
    detail: sessionCmd
      ? scripts[sessionCmd]
        ? `\`${sessionCmd}\` documentado y existente`
        : `\`${sessionCmd}\` documentado pero AUSENTE en package.json`
      : 'AGENTS.md no documenta comando de session-start',
  });
  if (sessionCmd && !scripts[sessionCmd])
    fixes.push(`Agregar script \`${sessionCmd}\` a package.json o corregir AGENTS.md`);
  if (!sessionCmd) fixes.push('Documentar el comando de session-start en AGENTS.md');

  const policy = readJson(root, 'config/mcp-lifecycle-policy.json') as {
    servers?: Record<string, { activation?: string }>;
  } | null;
  const alwaysOn = Object.entries(policy?.servers ?? {})
    .filter(([, s]) => s.activation === 'always-on' || s.activation === 'warm-when-developing')
    .map(([id]) => id);
  const mcpCanon = readJson(root, '.mcp.json') as {
    mcpServers?: Record<string, unknown>;
  } | null;
  const declared = Object.keys(mcpCanon?.mcpServers ?? {});
  const missing = alwaysOn.filter((id) => !declared.includes(id));
  checks.push({
    name: 'canon .mcp.json cubre always-on de la política',
    ok: alwaysOn.length > 0 && missing.length === 0,
    detail:
      missing.length === 0
        ? `${alwaysOn.length} always-on declarados (${alwaysOn.join(', ')})`
        : `ausentes en .mcp.json: ${missing.join(', ')}`,
  });
  if (missing.length > 0) fixes.push(`Declarar en .mcp.json: ${missing.join(', ')}`);

  const score = checks.every((c) => c.ok)
    ? 100
    : Math.round((checks.filter((c) => c.ok).length / checks.length) * 100);
  return { score, checks, fixes };
}

function scoreValidationLoop(root = ROOT): DimensionResult {
  const checks: DimensionResult['checks'] = [];
  const fixes: string[] = [];
  const pkg = readJson(root, 'package.json') as { scripts?: Record<string, string> } | null;
  const scripts = pkg?.scripts ?? {};
  const canonicos: Array<[string, RegExp]> = [
    ['typecheck', /^typecheck$/],
    ['test', /^test$/],
    ['lint', /^lint$|^lint:/],
  ];
  for (const [name, re] of canonicos) {
    const ok = Object.keys(scripts).some((s) => re.test(s));
    checks.push({ name: `script \`${name}\``, ok, detail: ok ? 'presente' : 'AUSENTE' });
    if (!ok) fixes.push(`Agregar script \`${name}\``);
  }
  const lefthook = existsSync(join(root, '.lefthook.yml'));
  // Los comandos viven bajo `pre-commit: > commands:` con `run:` por gate —
  // contar `run:` de esa sección, no la indentación (el YAML del repo usa
  // 4 espacios en las claves; juez del primer tiro: el conteo dio 0).
  const lefthookCfg = lefthook ? readFileSync(join(root, '.lefthook.yml'), 'utf8') : '';
  // split con grupo de captura: [0]=antes, [1]='pre-commit', [2]=sección
  const preCommitSection = lefthookCfg.split(/^(pre-commit):$/m)[2] ?? '';
  const preCommitGates = (preCommitSection.match(/^\s+run:/gm) ?? []).length;
  checks.push({
    name: 'ciclo pre-commit con gates reales',
    ok: lefthook && preCommitGates >= 10,
    detail: lefthook
      ? `lefthook presente, ${preCommitGates} comandos \`run:\``
      : '.lefthook.yml AUSENTE',
  });
  if (!lefthook || preCommitGates < 10)
    fixes.push('Pre-commit sin ciclos de verificación suficientes (lefthook + ≥10 gates)');

  const score = Math.round((checks.filter((c) => c.ok).length / checks.length) * 100);
  return { score, checks, fixes };
}

function scoreDocsReliability(root = ROOT): DimensionResult {
  const pkg = readJson(root, 'package.json') as { scripts?: Record<string, string> } | null;
  const scripts = pkg?.scripts ?? {};
  // Fallback a apps/* Y packages/*: docs que citan `conformance --prefix
  // packages/gv-design-system` o `release:check` del wpp-bot citan scripts
  // DE PAQUETES — válidos si existen en su package.json.
  const appScripts = new Set<string>();
  for (const scopeDir of ['apps', 'packages']) {
    const dir = join(root, scopeDir);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const app = readJson(root, join(scopeDir, entry.name, 'package.json')) as {
        scripts?: Record<string, string>;
      } | null;
      for (const s of Object.keys(app?.scripts ?? {})) appScripts.add(s);
    }
  }
  // Citaciones con placeholder (`skills:sync:<tool>`) documentan una FAMILIA,
  // no un comando literal — no se marcan rotas.
  // Familias con placeholder: `<tool>` truncado por el regex o sufijo \n  // dejan cmd terminando en ':' — documentan una familia, no un literal.
  const cited = citedNpmScripts(root).filter(({ cmd }) => !cmd.includes('<') && !cmd.endsWith(':'));
  const unique = new Map<string, string[]>();
  for (const { cmd, source } of cited) {
    unique.set(cmd, [...(unique.get(cmd) ?? []), source]);
  }
  const rotos = [...unique.entries()].filter(([cmd]) => !scripts[cmd] && !appScripts.has(cmd));
  const checks: DimensionResult['checks'] = [
    {
      name: 'comandos citados vs package.json (raíz + apps)',
      ok: rotos.length === 0 && unique.size > 0,
      detail:
        rotos.length === 0
          ? `${unique.size} comandos citados, todos existen (raíz o apps)`
          : `rotos: ${rotos.map(([cmd]) => cmd).join(', ')}`,
    },
  ];
  const fixes = rotos.map(
    ([cmd, srcs]) =>
      `\`npm run ${cmd}\` citado en ${srcs.join(', ')} no existe ni en raíz ni en apps`,
  );
  const score =
    unique.size === 0 ? 50 : Math.round(((unique.size - rotos.length) / unique.size) * 100);
  return { score, checks, fixes };
}

export function auditAgentCompatibility(root = ROOT): {
  score: number;
  dimensions: Record<string, DimensionResult>;
  topFixes: string[];
} {
  const startup = scoreStartup(root);
  const validation = scoreValidationLoop(root);
  const docs = scoreDocsReliability(root);
  const score = Math.round(startup.score * 0.3 + validation.score * 0.3 + docs.score * 0.4);
  const topFixes = [...new Set([...startup.fixes, ...validation.fixes, ...docs.fixes])].slice(0, 5);
  return {
    score,
    dimensions: { startup, validation: validation, 'docs-reliability': docs },
    topFixes,
  };
}

function main(): number {
  const asJson = process.argv.includes('--json');
  const report = auditAgentCompatibility();
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return report.score >= 80 ? 0 : 1;
  }
  console.log(`Agent Compatibility Score: ${report.score}/100`);
  for (const [dim, d] of Object.entries(report.dimensions)) {
    console.log(
      `  ${dim}: ${d.score}/100 — ${d.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.name}`).join(' · ')}`,
    );
  }
  if (report.topFixes.length > 0) {
    console.log('Top fixes:');
    for (const f of report.topFixes) console.log(`  - ${f}`);
  } else {
    console.log('Top fixes: (ninguno — repo operativo para agentes)');
  }
  return report.score >= 80 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main());
}
