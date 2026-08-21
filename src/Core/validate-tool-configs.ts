#!/usr/bin/env node
/**
 * Validate Tool Configs — validates tool configuration files against known schemas.
 * TS migration of scripts/utilities/config/validate-tool-configs.ps1
 */

import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';

const ROOT = path.resolve(process.cwd());

// Schema definitions — known valid properties per tool config
const SCHEMAS: Record<string, string[]> = {
  'opencode.json': [
    '$schema',
    'agent',
    'attachment',
    'autoshare',
    'autoupdate',
    'command',
    'compaction',
    'default_agent',
    'disabled_providers',
    'enabled_providers',
    'enterprise',
    'experimental',
    'formatter',
    'instructions',
    'layout',
    'logLevel',
    'lsp',
    'mcp',
    'mode',
    'model',
    'permission',
    'plugin',
    'provider',
    'reference',
    'references',
    'server',
    'share',
    'shell',
    'skills',
    'small_model',
    'snapshot',
    'tools',
    'tool_output',
    'username',
    'watcher',
  ],
  '.windsurf/config.json': [
    'name',
    'description',
    'version',
    'rules',
    'customRules',
    'handle',
    'mcpServers',
    'gentle-vanguard-skills',
    'engram',
    'codegraph',
    'workspace',
    'aiSettings',
    'toolPermissions',
    'contextManagement',
    'cascade',
    'preProcessing',
    'sessionManagement',
    'language',
  ],
  '.continue/config.json': [
    'name',
    'description',
    'version',
    'models',
    'modelProviders',
    'tabAutocompleteModel',
    'contextProviders',
    'slashCommands',
    'docs',
    'experimental',
    'allowAnonymousTelemetry',
    'disableIndexing',
    'mcpServers',
  ],
};

// Cline rules sections silently ignored
const CLINE_IGNORED_SECTIONS = ['system_prompt', 'system_prompt_optimization'];

/** Validate a JSON config file against known valid properties */
function testConfigFile(
  configPath: string,
  validProps: string[],
  label: string,
  fix: boolean,
  quiet: boolean,
): boolean {
  const fullPath = path.resolve(ROOT, configPath);
  if (!fs.existsSync(fullPath)) {
    if (!quiet) console.log(`SKIP: ${label} (${configPath} not found)`);
    return true;
  }

  try {
    const raw = fs.readFileSync(fullPath, 'utf-8');
    const config = JSON.parse(raw);
    const props = Object.keys(config);
    const unknown = props.filter((p) => !validProps.includes(p));

    if (unknown.length > 0) {
      console.log(`WARN: ${label} — propiedades no estándar (ignoradas por la herramienta):`);
      for (const u of unknown) {
        console.log(`  - ${u}`);
      }

      if (fix) {
        const lines = raw.split('\n');
        const filtered = lines.filter((line) => {
          const trimmed = line.trim();
          return !unknown.some((u) => trimmed.startsWith(`"${u}"`));
        });
        fs.writeFileSync(fullPath, filtered.join('\n'), 'utf-8');
        console.log(`  → FIXED: removed from ${configPath}`);
      }
      return true;
    }

    if (!quiet) console.log(`PASS: ${label}`);
    return true;
  } catch (err) {
    console.log(`ERR: ${label} — ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** Validate .clinerules for ignored sections */
function testClinerules(configPath: string, fix: boolean, quiet: boolean): boolean {
  const fullPath = path.resolve(ROOT, configPath);
  if (!fs.existsSync(fullPath)) {
    if (!quiet) console.log(`SKIP: ${configPath} (not found)`);
    return true;
  }

  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    let ok = true;

    for (const section of CLINE_IGNORED_SECTIONS) {
      const regex = new RegExp(`^${section}:`, 'm');
      if (regex.test(content)) {
        console.log(
          `WARN: ${configPath} contiene sección '${section}' que Cline ignora silenciosamente`,
        );
        if (fix) {
          const pattern = new RegExp(`(?:^|\\n)${section}:.*?(?=\\n[a-z_]|\\n\\n|\\n$)`, 's');
          const newContent = content.replace(
            pattern,
            `\n# [REMOVED] ${section} — ver config/system-prompt-optimization.json`,
          );
          fs.writeFileSync(fullPath, newContent, 'utf-8');
          console.log(`  → FIXED: removed '${section}' from ${configPath}`);
        }
        ok = false;
      }
    }

    if (ok && !quiet) console.log(`PASS: ${configPath}`);
    return true;
  } catch (err) {
    console.log(`ERR: ${configPath} — ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

function main(): number {
  const quiet = process.argv.includes('--quiet') || process.argv.includes('-Quiet');
  const fix = process.argv.includes('--fix') || process.argv.includes('-Fix');

  let exitCode = 0;

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  validate-tool-configs — Multi-Tool Validator   ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  // Validate each schema-defined config
  for (const [configPath, validProps] of Object.entries(SCHEMAS)) {
    const ok = testConfigFile(configPath, validProps, configPath, fix, quiet);
    if (!ok) exitCode = 1;
  }

  // Validate .clinerules
  const clineOk = testClinerules('.clinerules', fix, quiet);
  if (!clineOk) exitCode = 1;

  // Summary
  console.log('');
  if (exitCode === 0) {
    console.log('RESULT: ALL PASS — todos los tool configs cumplen schemas oficiales');
  } else {
    console.log('RESULT: FAIL — algunos tool configs tienen errores estructurales');
    console.log('INFO: Las props no estándar son ignoradas silenciosamente por las herramientas.');
    console.log('      Usa --fix para removerlas automáticamente.');
  }

  return exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
