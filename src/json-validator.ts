#!/usr/bin/env node
import { pathToFileURL } from 'url';

interface ValidationResult {
  Valid: boolean;
  Error: string | null;
  Position: number;
}

interface RepairResult {
  Json: string;
  Fixes: string[];
}

function testJsonValidStrict(json: string): ValidationResult {
  if (!json || json.trim().length === 0) {
    return { Valid: false, Error: 'Empty JSON string', Position: 0 };
  }

  const trimmed = json.trim();

  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return { Valid: false, Error: "JSON must start with '{' or '['", Position: 0 };
  }

  if (!trimmed.endsWith('}') && !trimmed.endsWith(']')) {
    return { Valid: false, Error: "JSON must end with '}' or ']'", Position: trimmed.length - 1 };
  }

  let inString = false;
  let escapeNext = false;
  let braceCount = 0;
  let bracketCount = 0;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') braceCount++;
      else if (char === '}') braceCount--;
      else if (char === '[') bracketCount++;
      else if (char === ']') bracketCount--;

      if (braceCount < 0)
        return { Valid: false, Error: "Unmatched closing brace '}'", Position: i };
      if (bracketCount < 0)
        return { Valid: false, Error: "Unmatched closing bracket ']'", Position: i };
    }
  }

  if (inString) return { Valid: false, Error: 'Unterminated string', Position: trimmed.length };
  if (braceCount > 0)
    return {
      Valid: false,
      Error: `Missing ${braceCount} closing brace(s) '}'`,
      Position: trimmed.length,
    };
  if (braceCount < 0)
    return { Valid: false, Error: 'Extra closing brace(s)', Position: trimmed.length };
  if (bracketCount > 0)
    return {
      Valid: false,
      Error: `Missing ${bracketCount} closing bracket(s) ']'`,
      Position: trimmed.length,
    };
  if (bracketCount < 0)
    return { Valid: false, Error: 'Extra closing bracket(s)', Position: trimmed.length };

  const noTrailing = trimmed.replace(/,(\s*[}\]])/g, '$1');
  if (noTrailing !== trimmed) {
    return { Valid: false, Error: 'Trailing comma detected', Position: trimmed.lastIndexOf(',') };
  }

  try {
    JSON.parse(trimmed);
    return { Valid: true, Error: null, Position: 0 };
  } catch (e) {
    return { Valid: false, Error: e instanceof Error ? e.message : String(e), Position: 0 };
  }
}

function repairCommonJsonErrors(json: string): RepairResult {
  let repaired = json;
  const fixes: string[] = [];

  const quoteCount = (repaired.match(/"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    repaired = repaired.trimEnd() + '"';
    fixes.push('Added missing closing quote');
  }

  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/\]/g) || []).length;
  if (openBrackets > closeBrackets) {
    repaired = repaired.trimEnd() + ']'.repeat(openBrackets - closeBrackets);
    fixes.push('Added missing closing bracket(s)');
  }

  const openBraces = (repaired.match(/\{/g) || []).length;
  const closeBraces = (repaired.match(/\}/g) || []).length;
  if (openBraces > closeBraces) {
    repaired = repaired + '}'.repeat(openBraces - closeBraces);
    fixes.push('Added missing closing brace(s)');
  }

  const originalBeforeTrailing = repaired;
  const maxIterations = 10;
  let iteration = 0;
  while (iteration < maxIterations) {
    const newRepaired = repaired.replace(/,(\s*[}\]])/g, '$1');
    if (newRepaired === repaired) break;
    repaired = newRepaired;
    iteration++;
  }
  if (repaired !== originalBeforeTrailing) {
    fixes.push('Removed trailing comma(s)');
  }

  return { Json: repaired, Fixes: fixes };
}

function validateJson(
  jsonString: string,
  context: string,
  throwOnError: boolean,
  fixCommonErrors: boolean,
): string {
  const result = testJsonValidStrict(jsonString);

  if (result.Valid) {
    return JSON.stringify({
      Valid: true,
      Original: jsonString,
      Repaired: jsonString,
      Fixes: [],
    });
  }

  if (fixCommonErrors) {
    const repairResult = repairCommonJsonErrors(jsonString);
    const revalidated = testJsonValidStrict(repairResult.Json);

    if (revalidated.Valid) {
      console.warn(`[JSON-VALIDATOR] Repaired JSON for: ${context}`);
      for (const fix of repairResult.Fixes) {
        console.warn(`  - ${fix}`);
      }

      return JSON.stringify({
        Valid: true,
        Original: jsonString,
        Repaired: repairResult.Json,
        Fixes: repairResult.Fixes,
      });
    }
  }

  const errorMsg = `[JSON-VALIDATOR] Invalid JSON in: ${context}\nError: ${result.Error}`;

  if (throwOnError) {
    throw new Error(errorMsg);
  }

  return JSON.stringify({
    Valid: false,
    Original: jsonString,
    Error: result.Error,
    Fixes: [],
  });
}

function main() {
  const args = process.argv.slice(2);
  // Support both --json=<string> and --json-string <value> formats
  let jsonString =
    args
      .find((a) => a.startsWith('--json='))
      ?.split('=')
      .slice(1)
      .join('=') ?? '';
  if (!jsonString) {
    const nsIdx = args.indexOf('--json-string');
    if (nsIdx >= 0 && nsIdx + 1 < args.length) {
      jsonString = args[nsIdx + 1];
      // Strip surrounding single quotes (cmd.exe passes them literally)
      if (jsonString.startsWith("'") && jsonString.endsWith("'")) {
        jsonString = jsonString.slice(1, -1);
      }
    }
  }
  const context =
    args
      .find((a) => a.startsWith('--context='))
      ?.split('=')
      .slice(1)
      .join('=') ?? 'unspecified';
  const throwOnError = args.includes('--throwOnError');
  const fixCommonErrors = args.includes('--fixCommonErrors');

  if (!jsonString) {
    console.error(
      'Usage: --json=<string> | --json-string <value> [--context=<name>] [--throwOnError] [--fixCommonErrors]',
    );
    process.exit(1);
  }

  const output = validateJson(jsonString, context, throwOnError, fixCommonErrors);
  console.log(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
