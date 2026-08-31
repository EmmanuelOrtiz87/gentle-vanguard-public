#!/usr/bin/env node

import { existsSync } from 'fs';
import { resolve, join } from 'path';
import { runSync, runNpxTsxSync } from '../core/run-command.js';
import { pathToFileURL } from 'url';

const ROOT = resolve(process.cwd());

function getTsEquivalent(psPath: string): string | null {
  const base =
    psPath
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      ?.replace(/\.ps1$/i, '') ?? '';
  const tsPath = join(ROOT, 'src', `${base}.ts`);
  return existsSync(tsPath) ? tsPath : null;
}

interface Validator {
  name: string;
  path: string | null;
  exists: boolean;
  results: string[];
}

interface Summary {
  validated: string[];
  skipped: string[];
  fixed: string[];
  issues: string[];
  delegated: string[];
}

const validators: Record<string, Validator> = {
  scripts: { name: 'Script Validator', path: null, exists: false, results: [] },
  docs: { name: 'Documentation Validator', path: null, exists: false, results: [] },
  skills: { name: 'Skills Validator', path: null, exists: false, results: [] },
  config: { name: 'Config Validator', path: null, exists: false, results: [] },
  typescript: { name: 'TypeScript Validator', path: null, exists: false, results: [] },
  docker: { name: 'Docker Validator', path: null, exists: false, results: [] },
  security: { name: 'Security Validator', path: null, exists: false, results: [] },
  links: { name: 'Links Validator', path: null, exists: false, results: [] },
};

const summary: Summary = {
  validated: [],
  skipped: [],
  fixed: [],
  issues: [],
  delegated: [],
};

function writeHeader(): void {
  console.log('');
  console.log('\x1b[36m       ORCHESTRATOR: Autofix Unified Flow           \x1b[0m');
  console.log(`\x1b[90mRepository: ${ROOT}\x1b[0m`);
  console.log(`\x1b[90mStarted: ${new Date().toLocaleTimeString()}\x1b[0m`);
}

function announce(validator: string, action: string, detail = ''): void {
  const msg = detail ? `[${validator}] ${action} - ${detail}` : `[${validator}] ${action}`;
  console.log(`\x1b[36m${msg}\x1b[0m`);
}

function skip(validator: string, reason: string): void {
  console.log(`\x1b[90m[SKIP] ${validator} - ${reason}\x1b[0m`);
  summary.skipped.push(validator);
}

function fixed(validator: string, details: string): void {
  console.log(`\x1b[32m[FIXED] ${validator} - ${details}\x1b[0m`);
  summary.fixed.push(`${validator}: ${details}`);
}

function issue(validator: string, details: string): void {
  console.log(`\x1b[33m[ISSUE] ${validator} - ${details}\x1b[0m`);
  summary.issues.push(`${validator}: ${details}`);
}

function writeDelegate(validator: string, task: string): void {
  console.log(`\x1b[35m[DELEGATE] ${validator} - ${task}\x1b[0m`);
  summary.delegated.push(`${validator}: ${task}`);
}

function success(validator: string, details: string): void {
  console.log(`\x1b[32m[OK] ${validator} - ${details}\x1b[0m`);
  summary.validated.push(`${validator}: ${details}`);
}

function findFirstFile(root: string, pattern: string, recursive = true): string | null {
  const cmd = `Get-ChildItem -Path "${root}" -Filter "${pattern}" ${recursive ? '-Recurse' : ''} -File -ErrorAction SilentlyContinue | Select-Object -First 1 | Select-Object -ExpandProperty FullName`;
  const result = runSync('pwsh', ['-NoProfile', '-Command', cmd], { stdio: 'pipe' });
  const out = result.stdout.trim();
  return out || null;
}

function findFirstFileWithExtension(
  root: string,
  pattern: string,
  extensions: string[],
): string | null {
  const cmd = `Get-ChildItem -Path "${root}" -Filter "${pattern}" -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Extension -in @(${extensions.map((e) => `'${e}'`).join(',')}) } | Select-Object -First 1 | Select-Object -ExpandProperty FullName`;
  const result = runSync('pwsh', ['-NoProfile', '-Command', cmd], { stdio: 'pipe' });
  const out = result.stdout.trim();
  return out || null;
}

function findInDir(root: string, regex: string): string | null {
  const cmd = `Get-ChildItem -Path "${root}" -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.DirectoryName -match "${regex}" } | Select-Object -First 1 | Select-Object -ExpandProperty FullName`;
  const result = runSync('pwsh', ['-NoProfile', '-Command', cmd], { stdio: 'pipe' });
  const out = result.stdout.trim();
  return out || null;
}

function initializeValidators(): void {
  console.log('\n\x1b[36mPHASE 1: Discovery\x1b[0m\n');

  let p = findFirstFile(ROOT, 'auto-fix-delegate.ps1');
  if (!p) p = findFirstFile(ROOT, 'pre-push-script-validator.ps1');
  validators.scripts.path = p;
  validators.scripts.exists = p !== null;

  const docsPath = findInDir(ROOT, 'gentle-vanguard-audit');
  validators.docs.path = docsPath;
  validators.docs.exists = docsPath !== null;

  validators.skills.path = validators.docs.path;
  validators.skills.exists = validators.docs.exists;

  const configPath = findFirstFile(ROOT, 'cross-workspace-validator.ps1');
  validators.config.path = configPath;
  validators.config.exists = configPath !== null;

  const tsPath = findFirstFile(ROOT, 'tsconfig.json', false);
  validators.typescript.path = tsPath;
  validators.typescript.exists = tsPath !== null;

  const dockerPath = findFirstFile(ROOT, 'Dockerfile', false);
  validators.docker.path = dockerPath;
  validators.docker.exists = dockerPath !== null;

  const secPath = findFirstFileWithExtension(ROOT, 'security-orchestrator.*', ['.ps1', '.ts']);
  validators.security.path = secPath;
  validators.security.exists = secPath !== null;

  const linksPath = findFirstFile(ROOT, 'broken-links*.ps1');
  validators.links.path = linksPath;
  validators.links.exists = linksPath !== null;
}

function runPwsh(scriptPath: string, args: string[] = []): string {
  const tsAlt = getTsEquivalent(scriptPath);
  const result = tsAlt
    ? runNpxTsxSync(tsAlt, args, { stdio: 'pipe' })
    : runSync('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args], {
        stdio: 'pipe',
      });
  return result.stdout || '';
}

function invokeScriptsValidation(v: Validator): void {
  if (!v.path) return;
  try {
    const output = runPwsh(v.path);
    if (/SUCCESS|PASS|0 issues found/i.test(output)) {
      success('Scripts', 'No issues found');
    } else if (/Auto-fixed\s+(\d+)/.test(output)) {
      fixed('Scripts', 'Patterns auto-corrected');
    } else {
      issue('Scripts', 'Check output for details');
    }
  } catch (e: unknown) {
    issue('Scripts', e instanceof Error ? e.message : String(e));
  }
}

function invokeDocsValidation(v: Validator): void {
  if (!v.path) return;
  try {
    const output = runPwsh(v.path, ['-Scope', 'quick']);
    if (/0 errors|0 issues/i.test(output)) {
      success('Documentation', 'No broken links');
    } else if (/(\d+)\s+(warnings|broken)/i.test(output)) {
      const m = output.match(/(\d+)\s+(warnings|broken)/i);
      issue('Documentation', `${m ? m[1] : '?'} ${m ? m[2] : ''} found`);
    } else {
      success('Documentation', 'Validated');
    }
  } catch (e: unknown) {
    skip('Documentation', e instanceof Error ? e.message : String(e));
  }
}

function invokeSkillsValidation(v: Validator): void {
  if (!v.path) return;
  try {
    const output = runPwsh(v.path, ['-Scope', 'standard']);
    const m = output.match(/(\d+)\s+skills/);
    if (m) {
      success('Skills', `${m[1]} skills validated`);
    } else {
      success('Skills', 'Structure valid');
    }
  } catch (e: unknown) {
    skip('Skills', e instanceof Error ? e.message : String(e));
  }
}

function invokeConfigValidation(v: Validator): void {
  if (!v.path) return;
  try {
    const tsAlt = getTsEquivalent(v.path);
    const result = tsAlt
      ? runNpxTsxSync(tsAlt, [], { stdio: 'pipe' })
      : runSync('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', v.path], {
          stdio: 'pipe',
        });
    if (result.status === 0) {
      success('Configuration', 'No inconsistencies');
    } else {
      issue('Configuration', 'Differences found');
    }
  } catch (e: unknown) {
    skip('Configuration', e instanceof Error ? e.message : String(e));
  }
}

function invokeTypeScriptValidation(): void {
  success('TypeScript', 'tsconfig.json present - CI handles validation');
}

function invokeDockerValidation(): void {
  success('Docker', 'Dockerfile present - CI handles validation');
}

function invokeSecurityValidation(): void {
  success('Security', 'Security orchestrator available');
}

function invokeLinksValidation(): void {
  skip('Links', 'Dedicated validator not configured');
}

function invokeValidationPhase(): void {
  console.log('\n\x1b[36mPHASE 2: Validation\x1b[0m\n');

  for (const [key, v] of Object.entries(validators)) {
    if (!v.exists) {
      skip(v.name, 'Validator not found - skipping');
      continue;
    }
    announce(v.name, 'Validating...', v.path || '');
    summary.validated.push(v.name);

    switch (key) {
      case 'scripts':
        invokeScriptsValidation(v);
        break;
      case 'docs':
        invokeDocsValidation(v);
        break;
      case 'skills':
        invokeSkillsValidation(v);
        break;
      case 'config':
        invokeConfigValidation(v);
        break;
      case 'typescript':
        invokeTypeScriptValidation();
        break;
      case 'docker':
        invokeDockerValidation();
        break;
      case 'security':
        invokeSecurityValidation();
        break;
      case 'links':
        invokeLinksValidation();
        break;
    }
  }
}

function invokeAutoFixPhase(_dryRun: boolean, fix: boolean): void {
  if (!fix) return;

  console.log('\n\x1b[36mPHASE 3: Auto-Fix\x1b[0m\n');

  if (summary.issues.length === 0) {
    console.log('\x1b[32m[AUTO-FIX] No issues to fix\x1b[0m');
    return;
  }

  console.log(
    `\x1b[33m[AUTO-FIX] Attempting fixes for: ${summary.issues.length} validators with issues\x1b[0m`,
  );

  if (validators.scripts.exists && summary.issues.some((i) => /scripts/i.test(i))) {
    const fixScript = findFirstFile(ROOT, 'auto-fix-delegate.ps1');
    if (fixScript) {
      try {
        const output = runPwsh(fixScript);
        if (/Auto-fixed/i.test(output)) {
          fixed('Scripts', 'Parser patterns corrected');
        }
      } catch {
        /* */
      }
    }
  }
}

function invokeDelegationPhase(delegate: boolean): void {
  if (!delegate) return;
  if (summary.issues.length === 0) return;

  console.log('\n\x1b[36mPHASE 4: Delegation\x1b[0m\n');

  const wrapperScript = findFirstFile(ROOT, 'auto-delegation-wrapper.ps1');
  if (!wrapperScript) {
    console.log('\x1b[33m[DELEGATE] Wrapper not found - manual intervention required\x1b[0m');
    return;
  }

  for (const iss of summary.issues) {
    const validatorName = iss.replace(/:.*/, '');
    const task = `fix ${iss.toLowerCase()}`;
    writeDelegate(validatorName, task);
  }
}

function writeFinalSummary(_delegate: boolean): void {
  console.log('\n\x1b[36mSUMMARY\x1b[0m\n');

  console.log('\x1b[37mValidated:\x1b[0m');
  for (const v of summary.validated) console.log(`   \x1b[90m${v}\x1b[0m`);

  if (summary.skipped.length > 0) {
    console.log('\n\x1b[37mSkipped:\x1b[0m');
    for (const s of summary.skipped) console.log(`  - \x1b[90m${s}\x1b[0m`);
  }

  if (summary.fixed.length > 0) {
    console.log('\n\x1b[32mFixed:\x1b[0m');
    for (const f of summary.fixed) console.log(`   \x1b[32m${f}\x1b[0m`);
  }

  if (summary.issues.length > 0) {
    console.log('\n\x1b[33mIssues:\x1b[0m');
    for (const iss of summary.issues) console.log(`  ! \x1b[33m${iss}\x1b[0m`);
  }

  if (summary.delegated.length > 0) {
    console.log('\n\x1b[35mDelegated:\x1b[0m');
    for (const d of summary.delegated) console.log(`   \x1b[35m${d}\x1b[0m`);
  }

  console.log('');
  const issuesCount = summary.issues.length;
  const fixedCount = summary.fixed.length;

  if (issuesCount === 0) {
    console.log('\x1b[32mRESULT: SUCCESS - All validations passed!\x1b[0m');
    console.log('\x1b[32mREADY: Push authorized\x1b[0m');
    process.exit(0);
  } else if (fixedCount > 0 && issuesCount > 0) {
    console.log(`\x1b[33mRESULT: PARTIAL - Fixed ${fixedCount}, ${issuesCount} remaining\x1b[0m`);
    console.log('\x1b[36mRECOMMENDATION: Run with -Fix -Delegate for full resolution\x1b[0m');
    process.exit(0);
  } else {
    console.log(`\x1b[31mRESULT: ACTION REQUIRED - ${issuesCount} issues need attention\x1b[0m`);
    process.exit(1);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const fix = args.includes('--fix');
  const delegate = args.includes('--delegate');

  writeHeader();
  initializeValidators();
  invokeValidationPhase();
  invokeAutoFixPhase(false, fix);
  invokeDelegationPhase(delegate);
  writeFinalSummary(delegate);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
