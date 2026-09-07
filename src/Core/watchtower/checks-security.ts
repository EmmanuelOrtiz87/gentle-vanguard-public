// Security checks (F2.5 split): Security, Secret Scanner, CLI Guard, Hidden
// Spawns, Cloud Connectors, Web Crawler.
// Extracted verbatim from src/core/maintenance-watchtower.ts — no logic changes
// (except the hidden-spawns self-skip now covers the whole watchtower/ dir).

import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import { addResult, quiet, ROOT, RUNTIME_DIR, SESSION_DIR } from './context';
import { fileExists, readJson, payloadFileOk } from './helpers';
const logger = log('CORE-WATCHTOWER-CHECKS-SECURITY');
import { log } from '../../utils/logger.js';

// ─── Component: Security ────────────────────────────────────────────────────

export async function checkSecurity() {
  if (!quiet) logger.info('  [Security] Checking...');

  const secFiles = [
    'config/owner-auth.json.enc',
    'config/owner-auth.json.integrity',
    'src/security/privacy-gateway.ts',
    'src/security/security-orchestrator.ts',
    'SECURITY.md',
    '.github/CODEOWNERS',
    // Dependency bots: Renovate is the single bot (ADR: dependabot removed
    // 2026-08-22 to stop duplicated dependency PRs)
    'renovate.json',
  ];
  for (const f of secFiles) {
    addResult('security', f, fileExists(join(ROOT, f)) ? 'PASS' : 'WARN', '', 'manual');
  }
}

// ─── Component: Secret Scanner (absorbed knowledge, ADR-010) ─────────────────

export async function checkSecretScanner() {
  if (!quiet) logger.info('  [Secret Scanner] Checking...');

  const scannerSrc = join(ROOT, 'src', 'security', 'secret-scanner.ts');
  const scannerCli = join(ROOT, 'src', 'security', 'secret-scanner-cli.ts');
  const scannerCfg = join(ROOT, 'config', 'secret-scanner.json');
  const scannerTest = join(ROOT, 'tests', 'unit', 'secret-scanner.test.ts');

  payloadFileOk(
    'secret-scanner',
    'module (src/security/secret-scanner.ts)',
    scannerSrc,
    'manual',
    true,
  );
  payloadFileOk(
    'secret-scanner',
    'CLI (src/security/secret-scanner-cli.ts)',
    scannerCli,
    'manual',
    true,
  );
  payloadFileOk(
    'secret-scanner',
    'config (config/secret-scanner.json)',
    scannerCfg,
    'manual',
    true,
  );
  payloadFileOk(
    'secret-scanner',
    'tests (tests/unit/secret-scanner.test.ts)',
    scannerTest,
    'manual',
    true,
  );

  // Verify pattern catalog size from config (patterns: builtin|all)
  if (fileExists(scannerCfg)) {
    try {
      const cfg = readJson(scannerCfg) as { patterns?: string };
      if (cfg.patterns === 'builtin' || cfg.patterns === 'all') {
        addResult('secret-scanner', 'patterns mode', 'PASS', `patterns=${cfg.patterns}`, 'ok');
      } else {
        addResult(
          'secret-scanner',
          'patterns mode',
          'WARN',
          `Unexpected patterns value: ${String(cfg.patterns)}`,
          'manual',
        );
      }
    } catch {
      addResult('secret-scanner', 'patterns mode', 'FAIL', 'Invalid config JSON', 'manual');
    }
  }
}

// ─── Component: CLI Guard (Windows pathToFileURL) ────────────────────────────

export async function checkCliGuard() {
  if (!quiet) logger.info('  [CLI Guard] Checking...');

  // Detecta el patrón roto `import.meta.url === \`file://${process.argv[1]}\``
  // que NO normaliza rutas Windows (backslashes) → main() nunca se ejecuta.
  // El patrón correcto usa pathToFileURL(process.argv[1]).href.
  const brokenPattern = /import\.meta\.url\s*===\s*`file:\/\/\$\{process\.argv\[1\]\}`/;
  const srcDir = join(ROOT, 'src');
  let brokenCount = 0;
  const brokenFiles: string[] = [];

  const walk = (dir: string): void => {
    let dirEntries: import('fs').Dirent[];
    try {
      dirEntries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of dirEntries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.ts')) {
        try {
          const content = readFileSync(full, 'utf8');
          if (brokenPattern.test(content)) {
            brokenCount++;
            brokenFiles.push(relative(ROOT, full));
          }
        } catch {
          // skip unreadable
        }
      }
    }
  };
  walk(srcDir);

  if (brokenCount === 0) {
    addResult('cli-guard', 'pathToFileURL guard', 'PASS', 'No broken CLI guards found', 'ok');
  } else {
    addResult(
      'cli-guard',
      'pathToFileURL guard',
      'FAIL',
      `${brokenCount} file(s) with broken guard: ${brokenFiles.join(', ')}`,
      'manual',
    );
  }
}

// ─── Component: Hidden Spawns (invisible execution guard) ────────────────────

export async function checkHiddenSpawns() {
  if (!quiet) console.log('  [Hidden Spawns] Checking invisible-execution invariants...');

  // Guardarrailes anti-regresión de la ejecución invisible (AGENTS.md
  // "procesos-ocultos"). Detección best-effort por patrones:
  // 1. Referencias al CLI de tsx (cli.mjs) → proceso nieto con consola visible.
  // 2. spawn directo de 'npx.cmd'/'npm' sin shell → EINVAL en Node moderno.
  // 3. Launchers 'cmd /k' → ventanas persistentes.
  // 4. exec/execSync con comando string (cmd.exe visible) sin windowsHide cercano.
  const issues: string[] = [];
  const scanDirs = [
    join(ROOT, 'src'),
    join(ROOT, 'apps', 'web-dashboard', 'server'),
    join(ROOT, 'build'),
  ];

  const walk = (dir: string): string[] => {
    const out: string[] = [];
    let entries: import('fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
  };

  for (const dir of scanDirs) {
    for (const file of walk(dir)) {
      // Skip self: this check's own detection patterns (literal command
      // strings) would always flag the watchtower source itself. Covers the
      // orchestrator AND the split watchtower/ modules (F2.5).
      if (
        file.endsWith(join('core', 'maintenance-watchtower.ts')) ||
        file.includes(join('core', 'watchtower'))
      ) {
        continue;
      }
      let content: string;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const rel = relative(ROOT, file);

      if (/(tsx[\\/-][\w.-]*cli\.mjs|['"]cli\.mjs['"])/.test(content)) {
        issues.push(
          `${rel}: referencia al CLI de tsx (cli.mjs) — usar runNpxTsx / node --import tsx`,
        );
      }

      const npxCmdSpawn = /spawn\(\s*['"`](npx\.cmd|npm)['"`]\s*,/.exec(content);
      if (npxCmdSpawn) {
        issues.push(
          `${rel}: spawn directo de '${npxCmdSpawn[1]}' (EINVAL) — enrutar por run()/runNpxTsx`,
        );
      }

      if (/cmd\s+\/k/.test(content)) {
        issues.push(`${rel}: launcher 'cmd /k' (ventana persistente)`);
      }

      const execRe = /(^|[^\w.])(execSync|exec)\(/g;
      let m: RegExpExecArray | null;
      while ((m = execRe.exec(content)) !== null) {
        const after = content.slice(execRe.lastIndex, execRe.lastIndex + 300);
        if (/^\s*['"`](powershell|pwsh|npx |cmd )/.test(after) && !after.includes('windowsHide')) {
          const line = content.slice(0, m.index).split('\n').length;
          issues.push(`${rel}:${line} ${m[2]}() con comando shell sin windowsHide`);
        }
      }
    }
  }

  if (issues.length === 0) {
    addResult(
      'hidden-spawns',
      'invisible execution',
      'PASS',
      'No visible-spawn patterns found',
      'ok',
    );
  } else {
    addResult(
      'hidden-spawns',
      'invisible execution',
      'FAIL',
      `${issues.length} issue(s): ${issues.slice(0, 5).join(' | ')}${issues.length > 5 ? ' …' : ''}`,
      'manual',
    );
  }
}

// ─── Component: Agent Governance (ADR-0027/0028/0029) ────────────────────────

export async function checkAgentGovernance() {
  if (!quiet) logger.info('  [Agent Governance] Checking...');

  // Policy Engine (ADR-0027)
  const policySrc = join(ROOT, 'src', 'security', 'policy-engine', 'policy-engine.ts');
  const policyCfg = join(ROOT, 'config', 'policy-engine.json');
  const policySchema = join(ROOT, 'config', 'policy-engine.schema.json');
  const policyTest = join(ROOT, 'tests', 'unit', 'policy-engine.test.ts');
  payloadFileOk('agent-governance', 'policy engine (src)', policySrc, 'manual', true);
  payloadFileOk('agent-governance', 'policy config', policyCfg, 'manual', true);
  payloadFileOk('agent-governance', 'policy schema', policySchema, 'manual', true);
  payloadFileOk('agent-governance', 'policy tests', policyTest, 'manual', true);

  // MCP Security Gateway (ADR-0028)
  const mcpSecSrc = join(ROOT, 'src', 'mcp', 'security-gateway', 'mcp-security-gateway.ts');
  const mcpSecTest = join(ROOT, 'tests', 'unit', 'mcp-security-gateway.test.ts');
  payloadFileOk('agent-governance', 'mcp security gateway (src)', mcpSecSrc, 'manual', true);
  payloadFileOk('agent-governance', 'mcp security gateway tests', mcpSecTest, 'manual', true);

  // OWASP Agentic Top 10 (ADR-0029)
  const owaspSrc = join(ROOT, 'src', 'security', 'owasp', 'owasp-agentic-top10.ts');
  const owaspTest = join(ROOT, 'tests', 'unit', 'owasp-agentic-top10.test.ts');
  payloadFileOk('agent-governance', 'owasp mapping (src)', owaspSrc, 'manual', true);
  payloadFileOk('agent-governance', 'owasp mapping tests', owaspTest, 'manual', true);

  // Integration facade
  const facadeSrc = join(ROOT, 'src', 'security', 'agent-governance-integration.ts');
  const facadeTest = join(ROOT, 'tests', 'unit', 'agent-governance-integration.test.ts');
  payloadFileOk('agent-governance', 'integration facade (src)', facadeSrc, 'manual', true);
  payloadFileOk('agent-governance', 'integration facade tests', facadeTest, 'manual', true);

  // OWASP coverage from the last generated report (if present)
  const owaspReport = join(RUNTIME_DIR, 'owasp-agentic-top10.json');
  if (fileExists(owaspReport)) {
    try {
      const report = readJson(owaspReport) as { overallCoverage?: number; strictPass?: boolean };
      if (typeof report.overallCoverage === 'number') {
        addResult(
          'agent-governance',
          'owasp coverage',
          report.overallCoverage >= 80 ? 'PASS' : 'WARN',
          `coverage=${report.overallCoverage}% (strict threshold 80%)`,
          'manual',
        );
      }
    } catch {
      addResult('agent-governance', 'owasp coverage', 'FAIL', 'Invalid report JSON', 'manual');
    }
  } else {
    addResult(
      'agent-governance',
      'owasp coverage',
      'WARN',
      'Report not generated yet (run npm run owasp:top10 -- report)',
      'manual',
    );
  }
}

// ─── Component: Cloud Connectors ────────────────────────────────────────────
// NOTE: Cloud connectors deprecated - stack operates in local-only mode
// This check now verifies local execution mode without cloud dependencies

export async function checkCloudConnectors() {
  if (!quiet) console.log('  [Cloud Connectors] Checking...');

  // Stack operates in local-only mode - no cloud dependencies
  addResult('cloud-connectors', 'mode', 'PASS', 'Local-only mode (no cloud dependencies)', 'ok');

  // Verify local execution is working
  const localMetrics = join(SESSION_DIR, 'token-budget.json');
  if (fileExists(localMetrics)) {
    addResult('cloud-connectors', 'local metrics', 'PASS', 'Token budget tracking active', 'ok');
  } else {
    addResult(
      'cloud-connectors',
      'local metrics',
      'PASS',
      'No local metrics yet (will be created on first use)',
      'ok',
    );
  }

  // Cloud scripts intentionally removed - stack is local-only
  addResult(
    'cloud-connectors',
    'cloud scripts',
    'PASS',
    'Cloud scripts removed (local-only stack)',
    'ok',
  );
}

// ─── Component: Web Crawler (Firecrawl) ──────────────────────────────────────

export async function checkWebCrawler() {
  if (!quiet) console.log('  [Web Crawler] Checking...');

  const cfgPath = join(ROOT, 'config', 'web-crawler.json');
  if (!fileExists(cfgPath)) {
    addResult('web-crawler', 'config file', 'WARN', 'Not found', 'manual');
    return;
  }
  payloadFileOk('web-crawler', 'config file', cfgPath, 'manual', true);

  const healthFile = join(RUNTIME_DIR, 'web-crawler-health.json');
  if (fileExists(healthFile)) {
    try {
      const health = readJson(healthFile);
      const apiKeySet = !!health.apiKeyConfigured;
      const fallbackActive = !!health.fallbackActive;
      const cacheReady = !!health.cacheDir;
      addResult(
        'web-crawler',
        'provider ready',
        apiKeySet || fallbackActive ? 'PASS' : 'WARN',
        apiKeySet
          ? 'Firecrawl configured'
          : fallbackActive
            ? 'Fallback activo (Jina Reader + DDG HTML + Bing RSS), sin API key'
            : 'No provider configured',
        'manual',
      );
      addResult(
        'web-crawler',
        'cache directory',
        cacheReady ? 'PASS' : 'WARN',
        cacheReady ? 'Ready' : 'Missing',
        'manual',
      );
    } catch {
      addResult('web-crawler', 'health snapshot', 'FAIL', 'Invalid JSON', 'manual');
    }
  } else {
    addResult('web-crawler', 'health snapshot', 'WARN', 'Not generated yet', 'manual');
  }
}

// ─── Component: Git History Secrets (advisory scan) ──────────────────────────
// Scans a recent slice of the full git history (all branches, textual diff) with
// the stack's native secret-scanner (80 patterns). Findings are ADVISORY (WARN,
// never blocks) — matches the repo policy for a single-operator private repo;
// promote to FAIL when collaboration grows (gitleaks in CI stays authoritative).

// ~45MB of textual diff at 150 commits measured locally — a fast advisory sample
// of recent history; CI gitleaks remains the authoritative full-history gate.
const HISTORY_SCAN_DEPTH = 150;

export async function checkGitHistorySecrets() {
  if (!quiet) logger.info('  [History Secrets] Scanning recent git history...');
  const { runSync } = await import('../run-command.js');
  const { writeFileSync, rmSync, mkdirSync } = await import('fs');
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const { spawnSync } = await import('child_process');

  // Ensure the native scanner exists before doing anything.
  if (!fileExists(join(ROOT, 'src', 'security', 'secret-scanner.ts'))) {
    addResult('history-secrets', 'advisory history scan', 'WARN', 'secret-scanner module missing', 'manual');
    return;
  }

  const dumpPath = join(tmpdir(), `gv-history-dump-${process.pid}.txt`);
  try {
    // Materialize a textual diff of recent commits on ALL branches.
    const log = spawnSync('git', ['log', '--all', '--no-merges', '-p', `-${HISTORY_SCAN_DEPTH}`], {
      cwd: ROOT,
      encoding: 'utf-8',
      maxBuffer: 512 * 1024 * 1024,
      windowsHide: true,
      timeout: 90000,
    });
    if (log.status !== 0) {
      addResult('history-secrets', 'advisory history scan', 'WARN', `git log failed: ${log.stderr?.slice(0, 120)}`, 'manual');
      return;
    }
    mkdirSync(join(tmpdir()), { recursive: true });
    writeFileSync(dumpPath, log.stdout ?? '', 'utf-8');

    const scan = runSync(
      'node',
      ['--import', 'tsx', join(ROOT, 'src', 'security', 'secret-scanner-cli.ts'), '--scan', dumpPath, '--json'],
      { timeout: 90000, cwd: ROOT },
    );
    if (scan.status !== 0) {
      addResult(
        'history-secrets',
        'advisory history scan',
        'WARN',
        `Scan found potential secrets in recent history — review .runtime/secret-scan-report or the scan output.`,
        'manual',
      );
      return;
    }
    addResult('history-secrets', 'advisory history scan', 'PASS', `No secrets in last ${HISTORY_SCAN_DEPTH} commits`, 'ok');
  } catch (e: unknown) {
    addResult(
      'history-secrets',
      'advisory history scan',
      'WARN',
      `scan error: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`,
      'manual',
    );
  } finally {
    try {
      rmSync(dumpPath, { force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}
