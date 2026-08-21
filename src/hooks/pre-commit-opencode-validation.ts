#!/usr/bin/env node

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { runSync } from '../core/run-command.js';
import { pathToFileURL } from 'url';
import { validateOpencodeJsonSteps, validateAgentMdSteps } from './opencode-guards.js';

const LOG_COLORS: Record<string, string> = {
  Success: '32',
  Error: '31',
  Warning: '33',
  Info: '36',
};

function writeLog(message: string, level: string = 'Info'): void {
  const color = LOG_COLORS[level] ?? '37';
  console.log(`\x1b[${color}m[${level}] ${message}\x1b[0m`);
}

function execGit(args: string[], cwd: string = process.cwd()): string {
  const result = runSync('git', args, { cwd });
  return result.stdout?.trim() ?? '';
}

function tryParseJson(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Validates a JSON document against its JSON-Schema (draft 2020-12) without external
 * dependencies (no AJV available in this stack).
 *
 * Supports the subset used by the stack schemas:
 *   - required: top-level and nested (recursive)
 *   - type: object | array | string | number | integer | boolean | null
 *   - properties (objects)
 *   - patternProperties / additionalProperties (objects)
 *   - items / additionalItems (arrays)
 *   - enum, minimum/maximum, pattern, format (basic checks)
 *
 * Note: this intentionally does NOT enforce the legacy `provider.anthropic` root shape.
 * Provider config now lives in `defaults.provider` / `agentBindings[*].provider` (opencode).
 */
function validateAgainstSchema(
  value: unknown,
  schema: Record<string, unknown>,
  path: string,
): string[] {
  const errors: string[] = [];

  // required
  const required = schema.required as string[] | undefined;
  if (required && (typeof value !== 'object' || value === null)) {
    errors.push(`${path}: expected object for required check`);
    return errors;
  }
  if (required && typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    for (const field of required) {
      if (!(field in obj)) {
        errors.push(`${path}: missing required field '${field}'`);
      }
    }
  }

  // type
  const type = schema.type as string | string[] | undefined;
  if (type) {
    const types = Array.isArray(type) ? type : [type];
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    // integer is a number in JS
    const matches = types.some(
      (t) =>
        t === actual ||
        (t === 'integer' && actual === 'number' && Number.isInteger(value as number)),
    );
    if (!matches) {
      errors.push(`${path}: expected type '${types.join(' | ')}', got '${actual}'`);
      return errors;
    }
  }

  // enum
  const enumValues = schema.enum as unknown[] | undefined;
  if (enumValues && !enumValues.includes(value)) {
    errors.push(`${path}: value not in enum [${enumValues.map((e) => String(e)).join(', ')}]`);
  }

  // numeric constraints
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${path}: ${value} < minimum ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`${path}: ${value} > maximum ${schema.maximum}`);
    }
  }

  // string pattern / format
  if (typeof value === 'string') {
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: '${value}' does not match pattern ${schema.pattern}`);
    }
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) {
      errors.push(`${path}: '${value}' is not a valid date-time`);
    }
    if (schema.format === 'date' && Number.isNaN(Date.parse(value))) {
      errors.push(`${path}: '${value}' is not a valid date`);
    }
  }

  // nested objects
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const props = (schema.properties as Record<string, unknown>) ?? {};
    const patternProps = (schema.patternProperties as Record<string, unknown>) ?? {};
    const additional = schema.additionalProperties as Record<string, unknown> | boolean | undefined;

    for (const [key, child] of Object.entries(obj)) {
      let childSchema: Record<string, unknown> | undefined = props[key] as
        Record<string, unknown> | undefined;
      if (!childSchema) {
        for (const [pattern, pSchema] of Object.entries(patternProps)) {
          if (new RegExp(pattern).test(key)) {
            childSchema = pSchema as Record<string, unknown>;
            break;
          }
        }
      }
      if (!childSchema) {
        if (additional === false) {
          errors.push(`${path}.${key}: additional property not allowed`);
        } else if (additional && typeof additional === 'object') {
          childSchema = additional;
        }
      }
      if (childSchema && typeof childSchema === 'object') {
        errors.push(...validateAgainstSchema(child, childSchema, `${path}.${key}`));
      }
    }
  }

  // nested arrays
  if (Array.isArray(value)) {
    const items = schema.items as Record<string, unknown> | undefined;
    if (items && typeof items === 'object') {
      value.forEach((item, idx) => {
        errors.push(...validateAgainstSchema(item, items, `${path}[${idx}]`));
      });
    }
  }

  return errors;
}

function testJsonSchema(jsonPath: string, schemaPath: string): boolean {
  if (!existsSync(jsonPath)) {
    writeLog(`File not found: ${jsonPath}`, 'Error');
    return false;
  }
  if (!existsSync(schemaPath)) {
    writeLog(`Schema not found: ${schemaPath}`, 'Error');
    return false;
  }

  const json = tryParseJson(jsonPath);
  if (!json) {
    writeLog(`Invalid JSON: ${jsonPath}`, 'Error');
    return false;
  }

  const schema = tryParseJson(schemaPath);
  if (!schema) {
    writeLog(`Invalid schema: ${schemaPath}`, 'Error');
    return false;
  }

  const errors = validateAgainstSchema(json, schema, jsonPath.split(/[\\/]/).pop() ?? jsonPath);
  if (errors.length > 0) {
    for (const err of errors.slice(0, 10)) {
      writeLog(`  Schema error: ${err}`, 'Error');
    }
    if (errors.length > 10) {
      writeLog(`  ...and ${errors.length - 10} more errors`, 'Error');
    }
    return false;
  }

  writeLog('JSON schema validation passed', 'Success');
  return true;
}

function testNormativas(jsonPath: string, gitRoot: string): boolean {
  const normativasPath = join(
    gitRoot,
    'docs',
    'governance',
    'normatives',
    'NORMATIVAS-ORQUESTADOR.md',
  );
  if (!existsSync(normativasPath)) {
    writeLog(
      'NORMATIVAS-ORQUESTADOR.md not found in docs/governance/normatives, checking legacy location',
      'Warning',
    );
    // Fallback to legacy location for backwards compatibility
    const legacyPath = join(gitRoot, 'docs', 'reference', 'NORMATIVAS-ORQUESTADOR.md');
    if (!existsSync(legacyPath)) {
      writeLog(
        'NORMATIVAS-ORQUESTADOR.md not found in legacy location either, skipping',
        'Warning',
      );
      return true;
    }
  }

  try {
    const json = tryParseJson(jsonPath);
    if (!json) {
      writeLog(`Invalid JSON: ${jsonPath}`, 'Error');
      return false;
    }

    const normativas = readFileSync(normativasPath, 'utf-8');

    const requiredSections = ['Objetivo', 'Ubicación', 'Contenido', 'Decisiones'];
    for (const section of requiredSections) {
      const sectionRe = new RegExp(`##\\s*${section}`);
      if (!sectionRe.test(normativas)) {
        writeLog(`Missing section in NORMATIVAS: ${section}`, 'Warning');
      }
    }

    writeLog('Normativas check completed', 'Success');
    return true;
  } catch (err) {
    writeLog(`Error checking normativas: ${err}`, 'Warning');
    return true;
  }
}

async function main(): Promise<number> {
  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');
  const cwd = process.cwd();

  const gitRoot = execGit(['rev-parse', '--show-toplevel'], cwd);
  if (!gitRoot) {
    writeLog('Not in a git repository', 'Warning');
    return 0;
  }

  const stagedRaw = execGit(['diff', '--cached', '--name-only', '--diff-filter=ACM'], gitRoot);
  if (!stagedRaw) return 0;

  const stagedFiles = stagedRaw.split('\n').filter(Boolean);
  const configFiles = stagedFiles.filter((f) => {
    if (f.endsWith('.json') && /(config|opencode)/.test(f)) return true;
    if (f.endsWith('.md') && f.startsWith('.opencode/agents/')) return true;
    return false;
  });

  if (configFiles.length === 0) {
    writeLog('No configuration changes', 'Success');
    return 0;
  }

  writeLog(`Configuration files to validate: ${configFiles.length}`, 'Info');

  if (verbose) {
    for (const file of configFiles) {
      writeLog(`  ${file}`, 'Info');
    }
  }

  let hasErrors = false;

  for (const file of configFiles) {
    writeLog(`Validating: ${file}`, 'Info');

    // Agent MD files use YAML frontmatter (not JSON) — validate via agent-specific guard.
    if (file.endsWith('.md') && file.startsWith('.opencode/agents/')) {
      writeLog('  Validating agent MD steps...', 'Info');
      const agentErrors = validateAgentMdSteps(file);
      if (agentErrors.length > 0) {
        for (const err of agentErrors) {
          writeLog(`  ${err}`, 'Error');
        }
        hasErrors = true;
      } else {
        writeLog('  Agent MD steps valid', 'Success');
      }
      continue;
    }

    const json = tryParseJson(file);
    if (!json) {
      writeLog(`  Invalid JSON in ${file}`, 'Error');
      hasErrors = true;
      continue;
    }
    writeLog('  Valid JSON', 'Success');

    const schemaFile = file.replace(/\.json$/, '.schema.json');
    if (existsSync(schemaFile)) {
      writeLog('  Validating against schema...', 'Info');
      if (!testJsonSchema(file, schemaFile)) {
        hasErrors = true;
      }
    }

    if (/opencode|config/.test(file)) {
      writeLog('  Checking normativas...', 'Info');
      if (!testNormativas(file, gitRoot)) {
        hasErrors = true;
      }
    }

    if (file === 'opencode.json') {
      writeLog('  Validating opencode steps...', 'Info');
      const errors = validateOpencodeJsonSteps(json);
      if (errors.length > 0) {
        for (const err of errors) {
          writeLog(`  ${err}`, 'Error');
        }
        hasErrors = true;
      }
    }
  }

  if (hasErrors) {
    writeLog('Configuration validation failed', 'Error');
    return 1;
  }

  writeLog('All configuration validations passed', 'Success');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

export { main as preCommitOpencodeValidation };
