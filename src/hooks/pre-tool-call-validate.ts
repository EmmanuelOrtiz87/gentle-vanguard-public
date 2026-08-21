#!/usr/bin/env node

import { pathToFileURL } from 'url';

export interface ValidationResult {
  Valid: boolean;
  OriginalLength: number;
  ToolName: string;
  Timestamp: string;
  ValidatorVersion: string;
  RepairedJson?: string;
  FixesApplied?: string[];
  Warnings?: string[];
  Error?: string;
  CanRepair?: boolean;
  WasRepaired?: boolean;
  FixesAttempted?: string[];
}

interface SymbolAnalysis {
  TotalQuotes: number;
  UnterminatedString: boolean;
  UnterminatedPosition: number;
  OpenBraces: number;
  CloseBraces: number;
  UnmatchedBraces: number;
  OpenBrackets: number;
  CloseBrackets: number;
  UnmatchedBrackets: number;
  InString: boolean;
  EscapeNext: boolean;
}

interface RepairResult {
  Success: boolean;
  Json?: string;
  Fixes?: string[];
  Error?: string;
}

const VALIDATOR_VERSION = '1.0.0';

const STRICT_TOOLS = new Set([
  'engram_mem_judge',
  'engram_mem_compare',
  'engram_mem_save',
  'git_commit',
  'git_push',
]);

const RISKY_FIELDS = ['summary', 'content', 'observation', 'description', 'prompt'];

function getSymbolAnalysis(json: string): SymbolAnalysis {
  const analysis: SymbolAnalysis = {
    TotalQuotes: 0,
    UnterminatedString: false,
    UnterminatedPosition: -1,
    OpenBraces: 0,
    CloseBraces: 0,
    UnmatchedBraces: 0,
    OpenBrackets: 0,
    CloseBrackets: 0,
    UnmatchedBrackets: 0,
    InString: false,
    EscapeNext: false,
  };

  for (let i = 0; i < json.length; i++) {
    const char = json[i];

    if (analysis.EscapeNext) {
      analysis.EscapeNext = false;
      continue;
    }

    if (char === '\\') {
      analysis.EscapeNext = true;
      continue;
    }

    if (char === '"' && !analysis.EscapeNext) {
      analysis.TotalQuotes++;
      analysis.InString = !analysis.InString;
      continue;
    }

    if (!analysis.InString) {
      switch (char) {
        case '{':
          analysis.OpenBraces++;
          break;
        case '}':
          analysis.CloseBraces++;
          break;
        case '[':
          analysis.OpenBrackets++;
          break;
        case ']':
          analysis.CloseBrackets++;
          break;
      }
    }
  }

  if (analysis.InString) {
    analysis.UnterminatedString = true;
    analysis.UnterminatedPosition = json.length;
  }

  analysis.UnmatchedBraces = analysis.OpenBraces - analysis.CloseBraces;
  analysis.UnmatchedBrackets = analysis.OpenBrackets - analysis.CloseBrackets;

  return analysis;
}

function testJsonStructure(json: string): {
  valid: boolean;
  error: string | null;
  position: number;
  details: SymbolAnalysis;
} {
  const result: {
    valid: boolean;
    error: string | null;
    position: number;
    details: SymbolAnalysis;
  } = {
    valid: false,
    error: null,
    position: 0,
    details: getSymbolAnalysis(''),
  };

  if (!json || json.trim().length === 0) {
    result.error = 'JSON payload is empty';
    return result;
  }

  const trimmed = json.trim();

  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    result.error = "JSON must start with '{' or '['";
    result.position = 0;
    return result;
  }

  const endsCorrectly = trimmed.endsWith('}') || trimmed.endsWith(']');
  const analysis = getSymbolAnalysis(trimmed);
  result.details = analysis;

  if (!endsCorrectly) {
    result.error = "JSON must end with '}' or ']'";
    result.position = trimmed.length - 1;
    return result;
  }

  if (analysis.UnterminatedString) {
    result.error = 'Unterminated string detected';
    result.position = analysis.UnterminatedPosition;
    return result;
  }

  if (analysis.UnmatchedBraces !== 0) {
    const braceWord = analysis.UnmatchedBraces > 0 ? 'missing' : 'extra';
    result.error = `Unbalanced braces: ${braceWord} ${Math.abs(analysis.UnmatchedBraces)} '}'`;
    result.position = trimmed.length;
    return result;
  }

  if (analysis.UnmatchedBrackets !== 0) {
    const bracketWord = analysis.UnmatchedBrackets > 0 ? 'missing' : 'extra';
    result.error = `Unbalanced brackets: ${bracketWord} ${Math.abs(analysis.UnmatchedBrackets)} ']'`;
    result.position = trimmed.length;
    return result;
  }

  try {
    JSON.parse(trimmed);
    result.valid = true;
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    result.error = `JSON syntax error: ${errMsg}`;
    result.position = 0;
  }

  return result;
}

function repairJsonPayload(json: string, analysis: SymbolAnalysis): RepairResult {
  let repaired = json.trim();
  const fixes: string[] = [];

  // Fix 1: Unterminated string
  if (analysis.UnterminatedString) {
    repaired += '"';
    fixes.push('Added missing closing quote');
  }

  // Fix 2: Unbalanced braces
  if (analysis.UnmatchedBraces > 0) {
    repaired += '}'.repeat(analysis.UnmatchedBraces);
    fixes.push(`Added ${analysis.UnmatchedBraces} closing brace(s)`);
  } else if (analysis.UnmatchedBraces < 0) {
    const excess = Math.abs(analysis.UnmatchedBraces);
    return {
      Success: false,
      Error: `Extra ${excess} closing brace(s) '}' - auto-repair not safe`,
      Fixes: fixes,
    };
  }

  // Fix 3: Unbalanced brackets
  if (analysis.UnmatchedBrackets > 0) {
    repaired += ']'.repeat(analysis.UnmatchedBrackets);
    fixes.push(`Added ${analysis.UnmatchedBrackets} closing bracket(s)`);
  } else if (analysis.UnmatchedBrackets < 0) {
    const excess = Math.abs(analysis.UnmatchedBrackets);
    return {
      Success: false,
      Error: `Extra ${excess} closing bracket(s) ']' - auto-repair not safe`,
      Fixes: fixes,
    };
  }

  // Fix 4: Trailing commas
  let iteration = 0;
  let current = repaired;
  while (iteration < 10) {
    const next = current.replace(/,(\s*)([}\]])/g, '$1$2');
    if (next === current) break;
    current = next;
    iteration++;
  }
  if (current !== repaired) {
    fixes.push('Removed trailing commas');
    repaired = current;
  }

  try {
    JSON.parse(repaired);
    return { Success: true, Json: repaired, Fixes: fixes };
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    return { Success: false, Error: `Repair failed: ${errMsg}`, Fixes: fixes };
  }
}

function getTruncationRisk(json: string, _toolName: string): string[] {
  const risks: string[] = [];

  for (const field of RISKY_FIELDS) {
    const fieldPattern = new RegExp(`"${field}"\\s*:`);
    if (!fieldPattern.test(json)) continue;
    const valuePattern = new RegExp(`"${field}"\\s*:\\s*"([^"]*)`);
    const match = valuePattern.exec(json);
    if (match && match[1].length > 500) {
      risks.push(`Field '${field}' is very long (${match[1].length} chars) - truncation risk`);
    }
  }

  if (json.length > 2000) {
    risks.push(`Very long payload (${json.length} chars) - consider using file references`);
  }

  return risks;
}

export function validateToolCall(
  toolName: string,
  jsonPayload: string,
  autoFix: boolean,
  strictMode: boolean,
): ValidationResult {
  const now = new Date().toISOString();
  const isStrictTool = STRICT_TOOLS.has(toolName);
  const effectiveStrictMode = strictMode || isStrictTool;

  const validation = testJsonStructure(jsonPayload);

  const output: ValidationResult = {
    Valid: validation.valid,
    OriginalLength: jsonPayload.length,
    ToolName: toolName,
    Timestamp: now,
    ValidatorVersion: VALIDATOR_VERSION,
  };

  if (validation.valid) {
    const risks = getTruncationRisk(jsonPayload, toolName);
    if (risks.length > 0) {
      output.Warnings = risks;
    }
    output.RepairedJson = jsonPayload;
    output.FixesApplied = [];
  } else {
    if (autoFix && !effectiveStrictMode) {
      const repair = repairJsonPayload(jsonPayload, validation.details);
      if (repair.Success && repair.Json) {
        output.Valid = true;
        output.RepairedJson = repair.Json;
        output.FixesApplied = repair.Fixes;
        output.WasRepaired = true;
      } else {
        output.Error = repair.Error;
        output.FixesAttempted = repair.Fixes;
      }
    } else {
      output.Error = validation.error ?? undefined;
      output.CanRepair = !effectiveStrictMode;
    }
  }

  return output;
}

function main(): number {
  const args = process.argv.slice(2);

  let toolName = '';
  let jsonPayload = '';
  let context = '';
  let autoFix = false;
  let strictMode = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--tool-name':
      case '-t':
        toolName = args[++i] ?? '';
        break;
      case '--json-payload':
      case '-j':
        jsonPayload = args[++i] ?? '';
        break;
      case '--context':
      case '-c':
        context = args[++i] ?? '';
        break;
      case '--auto-fix':
      case '-a':
        autoFix = true;
        break;
      case '--strict':
      case '-s':
        strictMode = true;
        break;
      default:
        break;
    }
  }

  if (!toolName || !jsonPayload) {
    console.error(
      'Usage: pre-tool-call-validate --tool-name <name> --json-payload <json> [--auto-fix] [--strict] [--context <ctx>]',
    );
    return 1;
  }

  const contextPrefix = context ? `[${context}] ` : '';
  const toolPrefix = `[${toolName}]`;

  const result = validateToolCall(toolName, jsonPayload, autoFix, strictMode);

  if (result.Warnings && result.Warnings.length > 0) {
    for (const risk of result.Warnings) {
      console.error(`${contextPrefix}${toolPrefix} Truncation warning: ${risk}`);
    }
  }

  if (!result.Valid) {
    console.error(`${contextPrefix}${toolPrefix} Validation error: ${result.Error}`);
    if (result.WasRepaired) {
      console.log(`${contextPrefix}${toolPrefix} JSON auto-repaired:`);
      for (const fix of result.FixesApplied ?? []) {
        console.log(`  * ${fix}`);
      }
    } else if (result.CanRepair) {
      console.log(`${contextPrefix}${toolPrefix} Can be repaired with --auto-fix`);
    }
    return 1;
  }

  if (result.WasRepaired) {
    console.log(`${contextPrefix}${toolPrefix} JSON auto-repaired:`);
    for (const fix of result.FixesApplied ?? []) {
      console.log(`  * ${fix}`);
    }
  }

  console.log(JSON.stringify(result, null, 2));
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

export { main as preToolCallValidate };
