#!/usr/bin/env node
/**
 * LSP MCP Server — Agent-level code navigation for TypeScript.
 *
 * Exposes MCP tools wrapping the TypeScript LanguageService API:
 *   - go_to_definition   — Find definition of a symbol at file:line:col
 *   - find_references    — Find all references to a symbol
 *   - get_hover_info     — Get type info and documentation at position
 *   - get_completions    — Get code completions at position
 *   - get_diagnostics    — Get semantic + syntactic diagnostics for a file
 *   - get_signature_help — Get function signature information
 *   - get_symbol_info    — Find symbols by name across the project
 *   - get_file_symbols   — Get all top-level symbols in a file
 *
 * Uses the TypeScript LanguageService (same engine as VS Code/the IDE).
 * Caches the service for performance. No external language server needed.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import * as ts from 'typescript';
import { existsSync, readFileSync } from 'fs';
import { resolve, join, relative, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';

// ── Configuration ────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(__filename), '../..');

interface LspConfig {
  tsconfigPath: string;
  maxReferences: number;
  maxDiagnostics: number;
  maxCompletions: number;
  maxSymbolResults: number;
}

const DEFAULT_CONFIG: LspConfig = {
  tsconfigPath: join(ROOT, 'tsconfig.json'),
  maxReferences: 50,
  maxDiagnostics: 100,
  maxCompletions: 30,
  maxSymbolResults: 20,
};

// ── Logging ──────────────────────────────────────────────────────────────────

function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, meta?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
  console.error(`[${timestamp}] [${level}] [mcp-lsp] ${msg}${metaStr}`);
}

// ── TypeScript LanguageService ───────────────────────────────────────────────

interface LsCache {
  service: ts.LanguageService;
  host: ts.LanguageServiceHost;
  configPath: string;
  fileNames: string[];
}

let _lsCache: LsCache | null = null;

function getProgramFiles(configPath: string): { fileNames: string[]; options: ts.CompilerOptions } {
  if (!existsSync(configPath)) {
    throw new McpError(ErrorCode.InvalidRequest, `tsconfig not found: ${configPath}`);
  }

  const configContent = readFileSync(configPath, 'utf-8');
  const configJson = ts.parseConfigFileTextToJson(configPath, configContent);
  if (configJson.error) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Invalid tsconfig: ${ts.flattenDiagnosticMessageText(configJson.error.messageText, '\n')}`,
    );
  }

  const parsedConfig = ts.parseJsonConfigFileContent(
    configJson.config,
    ts.sys,
    dirname(configPath),
    {},
    basename(configPath),
  );

  return { fileNames: parsedConfig.fileNames, options: parsedConfig.options ?? {} };
}

function getLanguageService(configPath?: string): LsCache {
  const resolvedConfig = configPath
    ? isAbsolute(configPath)
      ? configPath
      : resolve(ROOT, configPath)
    : resolve(ROOT, 'tsconfig.json');

  if (_lsCache && _lsCache.configPath === resolvedConfig) {
    return _lsCache;
  }

  log('INFO', 'Creating LanguageService', { configPath: resolvedConfig });

  const { fileNames, options } = getProgramFiles(resolvedConfig);

  const fileContents = new Map<string, string>();
  const fileVersions = new Map<string, number>();
  const fileExists = new Set<string>();

  // Pre-populate file contents
  for (const f of fileNames) {
    try {
      fileContents.set(f, readFileSync(f, 'utf-8'));
      fileVersions.set(f, 1);
      fileExists.add(f);
    } catch {
      log('WARN', 'Could not read file', { file: f });
    }
  }

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => Array.from(fileExists),
    getScriptVersion: (f) => String(fileVersions.get(f) ?? 0),
    getScriptSnapshot: (f) => {
      const content = fileContents.get(f);
      if (content === undefined) {
        // Try to read on-demand
        try {
          const c = readFileSync(f, 'utf-8');
          fileContents.set(f, c);
          fileVersions.set(f, (fileVersions.get(f) ?? 0) + 1);
          fileExists.add(f);
          return ts.ScriptSnapshot.fromString(c);
        } catch {
          return undefined;
        }
      }
      return ts.ScriptSnapshot.fromString(content);
    },
    getCurrentDirectory: () => dirname(resolvedConfig),
    getCompilationSettings: () => ({
      ...options,
      noEmit: true,
      suppressOutput: true,
    }),
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists: (f) => fileExists.has(f) || existsSync(f),
    readFile: (f) => fileContents.get(f) ?? (existsSync(f) ? readFileSync(f, 'utf-8') : undefined),
    readDirectory: (path, extensions, exclude, include, depth) => {
      return ts.sys.readDirectory(path, extensions, exclude, include, depth);
    },
  };

  const service = ts.createLanguageService(host, ts.createDocumentRegistry());

  _lsCache = { service, host, configPath: resolvedConfig, fileNames };
  log('INFO', 'LanguageService created', { files: fileNames.length });

  return _lsCache;
}

function resolveFilePath(filePath: string): string {
  if (isAbsolute(filePath)) return normalizePath(filePath);
  return normalizePath(resolve(ROOT, filePath));
}

function normalizePath(p: string): string {
  return p.replace(/[/\\]/g, '\\');
}

function getOffset(
  service: ts.LanguageService,
  fileName: string,
  line: number,
  col: number,
): number {
  const program = service.getProgram();
  if (!program) return 0;
  const sf = program.getSourceFile(fileName);
  if (!sf) {
    // Try normalizing path
    const normalized = normalizePath(fileName);
    for (const f of program.getSourceFiles()) {
      if (f.fileName && normalizePath(f.fileName) === normalized) {
        return f.getPositionOfLineAndCharacter(Math.max(0, line - 1), Math.max(0, col - 1));
      }
    }
    return 0;
  }
  return sf.getPositionOfLineAndCharacter(Math.max(0, line - 1), Math.max(0, col - 1));
}

function getLineColFromPosition(sf: ts.SourceFile, pos: number): { line: number; col: number } {
  const lc = sf.getLineAndCharacterOfPosition(pos);
  return { line: lc.line + 1, col: lc.character + 1 };
}

function basename(p: string): string {
  return p.split(/[/\\]/).pop() || p;
}

function getQuickInfoDisplayString(qi: ts.QuickInfo): string {
  if (qi.displayParts) {
    return qi.displayParts.map((p) => p.text).join('');
  }
  return '';
}

// ── Tool Handlers ────────────────────────────────────────────────────────────

function handleGoToDefinition(filePath: string, line: number, col: number) {
  const cache = getLanguageService();
  const resolved = resolveFilePath(filePath);

  const offset = getOffset(cache.service, resolved, line, col);
  const defs = cache.service.getDefinitionAtPosition(resolved, offset);
  if (!defs || defs.length === 0) {
    return { found: false, message: 'No definition found' };
  }

  const def = defs[0];
  const sf = cache.service.getProgram()?.getSourceFile(def.fileName);
  const pos = sf ? getLineColFromPosition(sf, def.textSpan.start) : { line: 0, col: 0 };

  // Get display string via quickInfo
  const quickInfo = cache.service.getQuickInfoAtPosition(def.fileName, def.textSpan.start);

  return {
    found: true,
    symbol: def.fileName,
    file: def.fileName,
    line: pos.line,
    col: pos.col,
    length: def.textSpan.length,
    displayString: quickInfo ? getQuickInfoDisplayString(quickInfo) : '',
    kind: def.kind,
  };
}

function handleFindReferences(filePath: string, line: number, col: number) {
  const cache = getLanguageService();
  const resolved = resolveFilePath(filePath);

  // First get definition to find the actual symbol position
  const offset = getOffset(cache.service, resolved, line, col);
  const defs = cache.service.getDefinitionAtPosition(resolved, offset);
  if (!defs || defs.length === 0) {
    return { found: false, message: 'No symbol at position to find references for' };
  }

  // Use the first definition as the target for findReferences
  const def = defs[0];
  const refs = cache.service.findReferences(def.fileName, def.textSpan.start);

  if (!refs || refs.length === 0) {
    return { found: false, message: 'No references found' };
  }

  const entries: Array<{
    file: string;
    line: number;
    col: number;
    text: string;
    isDefinition: boolean;
  }> = [];

  for (const ref of refs) {
    for (const entry of ref.references) {
      if (entries.length >= DEFAULT_CONFIG.maxReferences) break;
      const sf = cache.service.getProgram()?.getSourceFile(entry.fileName);
      const pos = sf ? getLineColFromPosition(sf, entry.textSpan.start) : { line: 0, col: 0 };
      const text =
        entry.textSpan.length > 0 && sf
          ? sf.text
              .substring(
                entry.textSpan.start,
                Math.min(entry.textSpan.start + entry.textSpan.length + 40, sf.text.length),
              )
              .trim()
          : '';

      entries.push({
        file: entry.fileName,
        line: pos.line,
        col: pos.col,
        text: text.slice(0, 80),
        isDefinition: entry.isDefinition ?? false,
      });
    }
  }

  return {
    found: entries.length > 0,
    symbolName: refs[0]?.definition?.name ?? 'unknown',
    total: entries.length,
    truncated: entries.length >= DEFAULT_CONFIG.maxReferences,
    references: entries,
  };
}

function handleHoverInfo(filePath: string, line: number, col: number) {
  const cache = getLanguageService();
  const resolved = resolveFilePath(filePath);
  const offset = getOffset(cache.service, resolved, line, col);

  const quickInfo = cache.service.getQuickInfoAtPosition(resolved, offset);
  if (!quickInfo) {
    return { found: false, message: 'No info at position' };
  }

  const displayString = getQuickInfoDisplayString(quickInfo);
  const documentation = quickInfo.documentation ?? [];
  const tags = quickInfo.tags ?? [];

  return {
    found: true,
    displayString,
    documentation: documentation
      .map((c) => (c.kind === 'text' ? c.text : c.kind === 'code' ? `\`${c.text}\`` : c.text))
      .join('\n'),
    tags: tags.map((t) => `@${t.name} ${t.text ?? ''}`),
    kind: quickInfo.kind,
    kindModifiers: quickInfo.kindModifiers,
  };
}

function handleCompletions(filePath: string, line: number, col: number, prefix?: string) {
  const cache = getLanguageService();
  const resolved = resolveFilePath(filePath);
  const offset = getOffset(cache.service, resolved, line, col);

  const details = cache.service.getCompletionsAtPosition(resolved, offset, {
    includeExternalModuleExports: false,
    includeInsertTextCompletions: false,
    triggerCharacter: undefined,
  });

  if (!details || details.entries.length === 0) {
    return { found: false, message: 'No completions at position' };
  }

  let entries = details.entries;
  if (prefix) {
    const q = prefix.toLowerCase();
    entries = entries.filter((e) => e.name.toLowerCase().startsWith(q));
  }

  entries = entries.slice(0, DEFAULT_CONFIG.maxCompletions);

  return {
    found: entries.length > 0,
    total: entries.length,
    isNewIdentifierLocation: details.isNewIdentifierLocation ?? false,
    entries: entries.map((e) => ({
      name: e.name,
      kind: e.kind,
      kindModifiers: e.kindModifiers ?? '',
      sortText: e.sortText,
      isRecommended: e.sortText?.startsWith('15') ?? false,
      replacementSpan: e.replacementSpan
        ? {
            start: e.replacementSpan.start,
            length: e.replacementSpan.length,
          }
        : undefined,
    })),
  };
}

function handleDiagnostics(filePath: string) {
  const cache = getLanguageService();
  const resolved = resolveFilePath(filePath);

  const syntacticDiags = cache.service.getSyntacticDiagnostics(resolved);
  const semanticDiags = cache.service.getSemanticDiagnostics(resolved);
  const suggestionDiags = cache.service.getSuggestionDiagnostics(resolved);

  const allDiags = [...syntacticDiags, ...semanticDiags, ...suggestionDiags].slice(
    0,
    DEFAULT_CONFIG.maxDiagnostics,
  );

  if (allDiags.length === 0) {
    return { hasDiagnostics: false, diagnostics: [] };
  }

  return {
    hasDiagnostics: true,
    total: allDiags.length,
    truncated: allDiags.length >= DEFAULT_CONFIG.maxDiagnostics,
    diagnostics: allDiags.map((d) => {
      const file = d.file;
      const pos =
        file && d.start !== undefined ? getLineColFromPosition(file, d.start) : { line: 0, col: 0 };
      return {
        category:
          d.category === ts.DiagnosticCategory.Error
            ? 'error'
            : d.category === ts.DiagnosticCategory.Warning
              ? 'warning'
              : 'suggestion',
        code: d.code,
        message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
        line: pos.line,
        col: pos.col,
        source: d.source ?? 'typescript',
        relatedInformation: d.relatedInformation?.map((r) => ({
          message: ts.flattenDiagnosticMessageText(r.messageText, '\n'),
          file: r.file?.fileName,
          line: r.file && r.start !== undefined ? getLineColFromPosition(r.file, r.start).line : 0,
        })),
      };
    }),
  };
}

function handleSignatureHelp(filePath: string, line: number, col: number) {
  const cache = getLanguageService();
  const resolved = resolveFilePath(filePath);
  const offset = getOffset(cache.service, resolved, line, col);

  const sigs = cache.service.getSignatureHelpItems(resolved, offset, { triggerReason: 0 as any });

  if (!sigs) {
    return { found: false, message: 'No signature help at position' };
  }

  return {
    found: true,
    selectedItemIndex: sigs.selectedItemIndex,
    argumentIndex: sigs.argumentIndex,
    argumentCount: sigs.argumentCount,
    items: sigs.items.map((item) => ({
      signature: printSignature(item),
      prefixDisplayParts: item.prefixDisplayParts?.map((p) => p.text).join('') ?? '',
      separator: item.separatorDisplayParts?.map((p) => p.text).join('') ?? ', ',
      parameters: item.parameters.map((p) => ({
        name: p.name,
        displayParts: p.displayParts?.map((dp) => dp.text).join('') ?? '',
        documentation:
          p.documentation?.map((c) => (c.kind === 'text' ? c.text : '')).join('\n') ?? '',
        isOptional: p.isOptional ?? false,
      })),
      documentation:
        item.documentation?.map((c) => (c.kind === 'text' ? c.text : '')).join('\n') ?? '',
    })),
  };
}

function printSignature(item: ts.SignatureHelpItem): string {
  const parts = [...(item.prefixDisplayParts ?? [])];
  for (let i = 0; i < item.parameters.length; i++) {
    if (i > 0) parts.push(...(item.separatorDisplayParts ?? []));
    parts.push(...item.parameters[i].displayParts);
    if (item.parameters[i].isOptional) parts.push({ text: '?', kind: 'punctuation' });
  }
  return parts.map((p) => p.text).join('');
}

function handleSymbolSearch(query: string, maxResults: number) {
  const cache = getLanguageService();
  const program = cache.service.getProgram();

  const navToItems = cache.service.getNavigateToItems(query, maxResults, undefined, undefined);

  if (!navToItems || navToItems.length === 0) {
    return { found: false, symbols: [] };
  }

  return {
    found: true,
    total: navToItems.length,
    truncated: navToItems.length >= maxResults,
    symbols: navToItems.map((item) => {
      // Compute line/col from textSpan.start using source file
      let line = 0,
        col = 0;
      if (program) {
        const sf = program.getSourceFile(item.fileName);
        if (sf) {
          const lc = getLineColFromPosition(sf, item.textSpan.start);
          line = lc.line;
          col = lc.col;
        }
      }
      return {
        name: item.name,
        kind: item.kind,
        kindModifiers: item.kindModifiers ?? '',
        file: item.fileName,
        line,
        col,
        containerName: item.containerName ?? undefined,
        containerKind: item.containerKind ?? undefined,
        matchKind: (item as any).matchKind,
      };
    }),
  };
}

function handleFileSymbols(filePath: string) {
  const cache = getLanguageService();
  const resolved = resolveFilePath(filePath);

  const tree = cache.service.getNavigationTree(resolved);
  if (!tree) {
    return { found: false, message: 'No navigation tree available' };
  }

  const program = cache.service.getProgram();
  const sf = program?.getSourceFile(resolved);

  function getSpanPos(span: ts.TextSpan): {
    line: number;
    col: number;
    endLine: number;
    endCol: number;
  } {
    if (!sf) return { line: 0, col: 0, endLine: 0, endCol: 0 };
    const start = getLineColFromPosition(sf, span.start);
    const end = getLineColFromPosition(sf, span.start + span.length);
    return { line: start.line, col: start.col, endLine: end.line, endCol: end.col };
  }

  function flattenTree(
    node: ts.NavigationTree,
    depth: number = 0,
  ): Array<{
    name: string;
    kind: string;
    kindModifiers: string;
    line: number;
    col: number;
    endLine: number;
    endCol: number;
    depth: number;
    hasChildren: boolean;
  }> {
    const result: Array<{
      name: string;
      kind: string;
      kindModifiers: string;
      line: number;
      col: number;
      endLine: number;
      endCol: number;
      depth: number;
      hasChildren: boolean;
    }> = [];

    const span = node.spans?.[0]
      ? getSpanPos(node.spans[0])
      : { line: 0, col: 0, endLine: 0, endCol: 0 };
    result.push({
      name: node.text,
      kind: node.kind,
      kindModifiers: node.kindModifiers ?? '',
      line: span.line,
      col: span.col,
      endLine: span.endLine,
      endCol: span.endCol,
      depth,
      hasChildren: (node.childItems?.length ?? 0) > 0,
    });

    if (node.childItems && depth < 3) {
      for (const child of node.childItems) {
        result.push(...flattenTree(child, depth + 1));
      }
    }

    return result;
  }

  const symbols = flattenTree(tree).filter((s) => s.depth <= 2); // Limit depth

  return {
    found: symbols.length > 0,
    total: symbols.length,
    file: resolved,
    symbols,
  };
}

// ── MCP Server ───────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'gentle-vanguard-lsp',
  version: '1.0.0',
});

// ── Tool: go_to_definition ───────────────────────────────────────────────────

server.tool(
  'go_to_definition',
  {
    filePath: z.string().describe('Path to the TypeScript file'),
    line: z.number().int().positive().describe('Line number (1-indexed)'),
    col: z.number().int().positive().describe('Column number (1-indexed)'),
  },
  async ({ filePath, line, col }) => {
    try {
      const result = handleGoToDefinition(filePath, line, col);

      if (!result.found) {
        return {
          content: [{ type: 'text', text: `No definition found at ${filePath}:${line}:${col}` }],
        };
      }

      const relFile = relative(ROOT, result.file!);
      const lines = [
        `**Definition**`,
        `**File**: \`${relFile}\``,
        `**Position**: ${result.line}:${result.col} (length: ${result.length})`,
        result.displayString ? `**Type**: \`${result.displayString}\`` : '',
      ];

      log('INFO', 'go_to_definition', { file: relFile, pos: `${result.line}:${result.col}` });

      return {
        content: [{ type: 'text', text: lines.filter(Boolean).join('\n') }],
      };
    } catch (err) {
      log('ERROR', 'go_to_definition failed', { error: String(err) });
      if (err instanceof McpError) throw err;
      throw new McpError(ErrorCode.InternalError, `go_to_definition failed: ${err}`);
    }
  },
);

// ── Tool: find_references ────────────────────────────────────────────────────

server.tool(
  'find_references',
  {
    filePath: z.string().describe('Path to the TypeScript file'),
    line: z.number().int().positive().describe('Line number (1-indexed)'),
    col: z.number().int().positive().describe('Column number (1-indexed)'),
  },
  async ({ filePath, line, col }) => {
    try {
      const result = handleFindReferences(filePath, line, col);

      if (!result.found) {
        return {
          content: [{ type: 'text', text: `No references found at ${filePath}:${line}:${col}` }],
        };
      }

      const lines = [
        `**References**: \`${result.symbolName}\` — ${result.total} total`,
        result.truncated ? `⚠ Truncated to ${DEFAULT_CONFIG.maxReferences}` : '',
        '',
      ];

      for (const ref of result.references!) {
        const relFile = relative(ROOT, ref.file);
        const prefix = ref.isDefinition ? '📌' : '  ';
        lines.push(`${prefix} \`${relFile}:${ref.line}:${ref.col}\` — ${ref.text}`);
      }

      log('INFO', 'find_references', { symbol: result.symbolName, total: result.total });

      return {
        content: [{ type: 'text', text: lines.filter(Boolean).join('\n') }],
      };
    } catch (err) {
      log('ERROR', 'find_references failed', { error: String(err) });
      if (err instanceof McpError) throw err;
      throw new McpError(ErrorCode.InternalError, `find_references failed: ${err}`);
    }
  },
);

// ── Tool: get_hover_info ─────────────────────────────────────────────────────

server.tool(
  'get_hover_info',
  {
    filePath: z.string().describe('Path to the TypeScript file'),
    line: z.number().int().positive().describe('Line number (1-indexed)'),
    col: z.number().int().positive().describe('Column number (1-indexed)'),
  },
  async ({ filePath, line, col }) => {
    try {
      const result = handleHoverInfo(filePath, line, col);

      if (!result.found) {
        return { content: [{ type: 'text', text: `No info at ${filePath}:${line}:${col}` }] };
      }

      const parts: string[] = [];

      if (result.displayString) {
        parts.push(`\`\`\`ts\n${result.displayString}\n\`\`\``);
      }

      if (result.kind) {
        parts.push(
          `**Kind**: ${result.kind}${result.kindModifiers ? ` (${result.kindModifiers})` : ''}`,
        );
      }

      if (result.documentation) {
        parts.push(`\n**Documentation**:\n${result.documentation}`);
      }

      if (result.tags!.length > 0) {
        parts.push(`\n**JSDoc Tags**:\n${result.tags!.join('\n')}`);
      }

      log('INFO', 'get_hover_info', { file: filePath, pos: `${line}:${col}` });

      return {
        content: [{ type: 'text', text: parts.join('\n') || 'No details available' }],
      };
    } catch (err) {
      log('ERROR', 'get_hover_info failed', { error: String(err) });
      if (err instanceof McpError) throw err;
      throw new McpError(ErrorCode.InternalError, `get_hover_info failed: ${err}`);
    }
  },
);

// ── Tool: get_completions ────────────────────────────────────────────────────

server.tool(
  'get_completions',
  {
    filePath: z.string().describe('Path to the TypeScript file'),
    line: z.number().int().positive().describe('Line number (1-indexed)'),
    col: z.number().int().positive().describe('Column number (1-indexed)'),
    prefix: z.string().optional().describe('Optional prefix to filter completions'),
  },
  async ({ filePath, line, col, prefix }) => {
    try {
      const result = handleCompletions(filePath, line, col, prefix ?? '');

      if (!result.found) {
        return {
          content: [{ type: 'text', text: `No completions at ${filePath}:${line}:${col}` }],
        };
      }

      const lines: string[] = [
        `**Completions**: ${result.total} entries at ${filePath}:${line}:${col}`,
        result.isNewIdentifierLocation ? '⚠ New identifier location' : '',
        '',
      ];

      for (const entry of result.entries!) {
        const marker = entry.isRecommended ? '★' : ' ';
        lines.push(
          `${marker} \`${entry.name}\` — ${entry.kind}${entry.kindModifiers ? ` (${entry.kindModifiers})` : ''}`,
        );
      }

      return {
        content: [{ type: 'text', text: lines.filter(Boolean).join('\n') }],
      };
    } catch (err) {
      log('ERROR', 'get_completions failed', { error: String(err) });
      if (err instanceof McpError) throw err;
      throw new McpError(ErrorCode.InternalError, `get_completions failed: ${err}`);
    }
  },
);

// ── Tool: get_diagnostics ────────────────────────────────────────────────────

server.tool(
  'get_diagnostics',
  {
    filePath: z.string().describe('Path to the TypeScript file'),
  },
  async ({ filePath }) => {
    try {
      const result = handleDiagnostics(filePath);

      if (!result.hasDiagnostics) {
        return {
          content: [
            {
              type: 'text',
              text: `✅ No diagnostics for \`${relative(ROOT, resolveFilePath(filePath))}\``,
            },
          ],
        };
      }

      const lines: string[] = [
        `**Diagnostics**: ${result.total} issues in \`${relative(ROOT, resolveFilePath(filePath))}\``,
        result.truncated ? `⚠ Truncated to ${DEFAULT_CONFIG.maxDiagnostics}` : '',
        '',
      ];

      for (const d of result.diagnostics) {
        const icon = d.category === 'error' ? '❌' : d.category === 'warning' ? '⚠️' : '💡';
        lines.push(`${icon} **${d.category.toUpperCase()}** TS${d.code}: ${d.message}`);
        lines.push(`   at ${filePath}:${d.line}:${d.col}`);
        if (d.relatedInformation?.length) {
          for (const r of d.relatedInformation) {
            const relFile = r.file ? relative(ROOT, r.file) : '';
            lines.push(`   → ${relFile}:${r.line} ${r.message}`);
          }
        }
        lines.push('');
      }

      return {
        content: [{ type: 'text', text: lines.filter(Boolean).join('\n').slice(0, 8000) }],
      };
    } catch (err) {
      log('ERROR', 'get_diagnostics failed', { error: String(err) });
      if (err instanceof McpError) throw err;
      throw new McpError(ErrorCode.InternalError, `get_diagnostics failed: ${err}`);
    }
  },
);

// ── Tool: get_signature_help ─────────────────────────────────────────────────

server.tool(
  'get_signature_help',
  {
    filePath: z.string().describe('Path to the TypeScript file'),
    line: z.number().int().positive().describe('Line number (1-indexed)'),
    col: z.number().int().positive().describe('Column number (1-indexed)'),
  },
  async ({ filePath, line, col }) => {
    try {
      const result = handleSignatureHelp(filePath, line, col);

      if (!result.found) {
        return {
          content: [{ type: 'text', text: `No signature help at ${filePath}:${line}:${col}` }],
        };
      }

      const parts: string[] = [
        `**Signature Help** (argument ${result.argumentIndex! + 1} of ${result.argumentCount}, ${result.items!.length} overloads)`,
        '',
      ];

      for (let i = 0; i < result.items!.length; i++) {
        const item = result.items![i];
        const prefix = i === result.selectedItemIndex ? '→ ' : '  ';
        parts.push(`${prefix}\`${item.signature}\``);
        if (item.documentation) {
          parts.push(`   ${item.documentation}`);
        }
        for (const param of item.parameters) {
          const argPrefix =
            item.parameters.indexOf(param) === result.argumentIndex! &&
            i === result.selectedItemIndex
              ? '◀ '
              : '  ';
          parts.push(
            `   ${argPrefix}\`${param.name}: ${param.displayParts}\`${param.isOptional ? ' (optional)' : ''}`,
          );
          if (param.documentation) {
            parts.push(`     ${param.documentation}`);
          }
        }
      }

      return {
        content: [{ type: 'text', text: parts.join('\n') }],
      };
    } catch (err) {
      log('ERROR', 'get_signature_help failed', { error: String(err) });
      if (err instanceof McpError) throw err;
      throw new McpError(ErrorCode.InternalError, `get_signature_help failed: ${err}`);
    }
  },
);

// ── Tool: get_symbol_info ────────────────────────────────────────────────────

server.tool(
  'get_symbol_info',
  {
    query: z.string().min(1).describe('Symbol name to search (partial match, case-insensitive)'),
    maxResults: z.number().int().positive().max(50).optional().describe('Max results (default 20)'),
  },
  async ({ query, maxResults }) => {
    try {
      const limit = maxResults ?? DEFAULT_CONFIG.maxSymbolResults;
      const result = handleSymbolSearch(query, limit);

      if (!result.found) {
        return { content: [{ type: 'text', text: `No symbols found matching "${query}"` }] };
      }

      const lines: string[] = [
        `**Symbol Search**: "${query}" — ${result.total} results`,
        result.truncated ? `⚠ Truncated to ${limit}` : '',
        '',
      ];

      for (const sym of result.symbols) {
        const relFile = relative(ROOT, sym.file);
        const container = sym.containerName ? `${sym.containerName}.` : '';
        lines.push(
          `- \`${container}${sym.name}\` (${sym.kind}) — ${relFile}:${sym.line}:${sym.col}`,
        );
      }

      return {
        content: [{ type: 'text', text: lines.filter(Boolean).join('\n') }],
      };
    } catch (err) {
      log('ERROR', 'get_symbol_info failed', { error: String(err) });
      if (err instanceof McpError) throw err;
      throw new McpError(ErrorCode.InternalError, `get_symbol_info failed: ${err}`);
    }
  },
);

// ── Tool: get_file_symbols ───────────────────────────────────────────────────

server.tool(
  'get_file_symbols',
  {
    filePath: z.string().describe('Path to the TypeScript file'),
  },
  async ({ filePath }) => {
    try {
      const result = handleFileSymbols(filePath);

      if (!result.found) {
        return {
          content: [
            {
              type: 'text',
              text: `No symbols found in \`${relative(ROOT, resolveFilePath(filePath))}\``,
            },
          ],
        };
      }

      const lines: string[] = [
        `**File Symbols**: ${result.total} in \`${relative(ROOT, result.file!)}\``,
        '',
      ];

      for (const sym of result.symbols!) {
        const indent = '  '.repeat(sym.depth);
        const marker = sym.depth === 0 ? '📦' : sym.hasChildren ? '📁' : '📄';
        lines.push(
          `${indent}${marker} \`${sym.name}\` (${sym.kind}) — ${sym.line}:${sym.col} - ${sym.endLine}:${sym.endCol}`,
        );
      }

      return {
        content: [{ type: 'text', text: lines.filter(Boolean).join('\n') }],
      };
    } catch (err) {
      log('ERROR', 'get_file_symbols failed', { error: String(err) });
      if (err instanceof McpError) throw err;
      throw new McpError(ErrorCode.InternalError, `get_file_symbols failed: ${err}`);
    }
  },
);

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Pre-warm LanguageService on startup
  try {
    getLanguageService();
    log('INFO', 'LanguageService pre-warmed');
  } catch (err) {
    log('WARN', 'Could not pre-warm LanguageService', { error: String(err) });
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('INFO', 'MCP LSP Server ready');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
