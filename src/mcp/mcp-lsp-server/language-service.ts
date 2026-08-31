import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import * as ts from 'typescript';
import { existsSync, readFileSync } from 'fs';
import { resolve, join, dirname, isAbsolute } from 'path';
import { ROOT, basename } from './position.js';
import { log as createLogger } from '../../utils/logger.js';
const logger = createLogger('MCP-MCP-LSP-SERVER-LANGUAGE-SERVICE');

// ── Configuration ────────────────────────────────────────────────────────────

export interface LspConfig {
  tsconfigPath: string;
  maxReferences: number;
  maxDiagnostics: number;
  maxCompletions: number;
  maxSymbolResults: number;
}

export const DEFAULT_CONFIG: LspConfig = {
  tsconfigPath: join(ROOT, 'tsconfig.json'),
  maxReferences: 50,
  maxDiagnostics: 100,
  maxCompletions: 30,
  maxSymbolResults: 20,
};

// ── Logging ──────────────────────────────────────────────────────────────────

export function log(
  level: 'INFO' | 'WARN' | 'ERROR',
  msg: string,
  meta?: Record<string, unknown>,
): void {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
  logger.error(`[${timestamp}] [${level}] [mcp-lsp] ${msg}${metaStr}`);
}

// ── TypeScript LanguageService ───────────────────────────────────────────────

export interface LsCache {
  service: ts.LanguageService;
  host: ts.LanguageServiceHost;
  configPath: string;
  fileNames: string[];
}

let _lsCache: LsCache | null = null;

export function getProgramFiles(configPath: string): {
  fileNames: string[];
  options: ts.CompilerOptions;
} {
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

export function getLanguageService(configPath?: string): LsCache {
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
