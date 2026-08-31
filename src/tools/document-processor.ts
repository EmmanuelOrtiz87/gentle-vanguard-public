#!/usr/bin/env node
/**
 * Document Processor
 *
 * Extract and process content from various document formats.
 * Supports PDF, DOCX, TXT, CSV, JSON, HTML.
 *
 * Usage:
 *   npx tsx src/tools/document-processor.ts <command> <file> [options]
 *
 * Commands:
 *   extract <file> [--pages 1,3-5] [--ocr] [--format md|json|txt]
 *   tables <file> [--output path] [--format csv|json]
 *   meta <file>
 *   summarize <file> [--max-length 500]
 *   batch <pattern> [--output dir]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve, extname, basename, dirname } from 'path';
import { pathToFileURL } from 'url';
import { runSync } from '../core/run-command.js';

// ─── Types ────────────────────────────────────────────────────────────

interface DocumentResult {
  source: string;
  format: 'pdf' | 'docx' | 'txt' | 'md' | 'csv' | 'json' | 'yaml' | 'html' | 'unknown';
  success: boolean;
  text?: string;
  pages?: {
    number: number;
    text: string;
  }[];
  metadata?: {
    title?: string;
    author?: string;
    created?: string;
    modified?: string;
    pageCount?: number;
    wordCount?: number;
    originalWordCount?: number;
    summaryWordCount?: number;
  };
  tables?: TableData[];
  errors?: string[];
  warnings?: string[];
}

interface TableData {
  page?: number;
  index: number;
  headers: string[];
  rows: string[][];
}

interface ProcessOptions {
  pages?: number[];
  ocr?: boolean;
  format?: 'md' | 'json' | 'txt' | 'csv';
  output?: string;
  maxLength?: number;
}

// ─── Constants ─────────────────────────────────────────────────────────

const ROOT = resolve(process.cwd());
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB limit

// ─── Helpers ──────────────────────────────────────────────────────────

function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function detectFormat(filePath: string): DocumentResult['format'] {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.pdf':
      return 'pdf';
    case '.docx':
      return 'docx';
    case '.txt':
      return 'txt';
    case '.md':
      return 'md';
    case '.csv':
      return 'csv';
    case '.json':
      return 'json';
    case '.yml':
    case '.yaml':
      return 'yaml';
    case '.html':
    case '.htm':
      return 'html';
    default:
      return 'unknown';
  }
}

function getFileSize(filePath: string): number {
  try {
    const stats = require('fs').statSync(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}

// ─── Text File Processor ─────────────────────────────────────────────

function processTextFile(filePath: string): DocumentResult {
  const text = readFileSync(filePath, 'utf-8');
  const words = text.split(/\s+/).filter((w: string) => w.length > 0);

  return {
    source: filePath,
    format: detectFormat(filePath),
    success: true,
    text,
    metadata: {
      wordCount: words.length,
    },
  };
}

// ─── JSON Processor ──────────────────────────────────────────────────

function processJsonFile(filePath: string): DocumentResult {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);

    // Extract text recursively
    function extractText(obj: unknown): string {
      if (typeof obj === 'string') return obj;
      if (Array.isArray(obj)) return obj.map(extractText).join('\n');
      if (obj && typeof obj === 'object') {
        return Object.values(obj).map(extractText).join('\n');
      }
      return String(obj);
    }

    return {
      source: filePath,
      format: 'json',
      success: true,
      text: extractText(data),
      metadata: {
        wordCount: content.split(/\s+/).filter((w: string) => w.length > 0).length,
      },
    };
  } catch (e) {
    return {
      source: filePath,
      format: 'json',
      success: false,
      errors: [`JSON parse error: ${e}`],
    };
  }
}

// ─── CSV Processor ─────────────────────────────────────────────────────

function processCsvFile(filePath: string): DocumentResult {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((l: string) => l.trim());

    if (lines.length === 0) {
      return {
        source: filePath,
        format: 'csv',
        success: true,
        text: '',
        tables: [],
      };
    }

    const delimiter = content.includes('\t') ? '\t' : ',';
    const headers = lines[0].split(delimiter).map((h: string) => h.trim());
    const rows = lines
      .slice(1)
      .map((line: string) => line.split(delimiter).map((c: string) => c.trim()));

    return {
      source: filePath,
      format: 'csv',
      success: true,
      text: `CSV with ${rows.length} rows and ${headers.length} columns`,
      tables: [
        {
          index: 0,
          headers,
          rows,
        },
      ],
      metadata: {
        wordCount: content.split(/\s+/).filter((w: string) => w.length > 0).length,
      },
    };
  } catch (e) {
    return {
      source: filePath,
      format: 'csv',
      success: false,
      errors: [`CSV parse error: ${e}`],
    };
  }
}

// ─── PDF Processor (Basic) ───────────────────────────────────────────

async function processPdfFile(filePath: string, _options: ProcessOptions): Promise<DocumentResult> {
  const errors: string[] = [];

  // Try pdftotext first (more reliable)
  try {
    // Array form: file paths may contain spaces — shell quoting is unreliable.
    const r = runSync('pdftotext', ['-layout', filePath, '-'], {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30000,
    });
    if (!r.stdout && (r.error || r.status !== 0)) {
      throw new Error(r.stderr || `pdftotext exited ${r.status}`);
    }
    const result = r.stdout;

    const words = result.split(/\s+/).filter((w: string) => w.length > 0);

    return {
      source: filePath,
      format: 'pdf',
      success: true,
      text: result,
      metadata: {
        wordCount: words.length,
      },
    };
  } catch {
    errors.push('pdftotext not available, trying fallback');
  }

  // Fallback: return informational message
  return {
    source: filePath,
    format: 'pdf',
    success: false,
    text: '[PDF content extraction requires pdftotext or pdf-parse package]',
    errors,
    warnings: ['Install dependencies: npm install pdf-parse'],
  };
}

// ─── DOCX Processor ───────────────────────────────────────────────────

async function processDocxFile(_filePath: string): Promise<DocumentResult> {
  // For now, return informational message
  return {
    source: _filePath,
    format: 'docx',
    success: false,
    text: '[DOCX content extraction requires docx package]',
    warnings: ['Install: npm install docx'],
  };
}

// ─── Summary Generator ────────────────────────────────────────────────

function generateSummary(text: string, maxLength: number = 500): string {
  const sentences = text.split(/[.!?]+/).filter((s: string) => s.trim().length > 20);

  // Simple extractive summary: first sentence + most informative
  let summary = '';
  let length = 0;

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (length + trimmed.length > maxLength) break;
    summary += trimmed + '. ';
    length += trimmed.length + 2;
  }

  return summary.trim() || text.slice(0, maxLength) + (text.length > maxLength ? '...' : '');
}

// ─── Commands ─────────────────────────────────────────────────────────

async function cmdExtract(filePath: string, options: ProcessOptions): Promise<DocumentResult> {
  if (!existsSync(filePath)) {
    return {
      source: filePath,
      format: 'unknown',
      success: false,
      errors: [`File not found: ${filePath}`],
    };
  }

  const size = getFileSize(filePath);
  if (size > MAX_FILE_SIZE) {
    return {
      source: filePath,
      format: 'unknown',
      success: false,
      errors: [
        `File too large: ${(size / 1024 / 1024).toFixed(1)}MB (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`,
      ],
    };
  }

  const format = detectFormat(filePath);

  try {
    switch (format) {
      case 'pdf':
        return await processPdfFile(filePath, options);
      case 'docx':
        return await processDocxFile(filePath);
      case 'csv':
        return processCsvFile(filePath);
      case 'json':
        return processJsonFile(filePath);
      case 'txt':
      case 'md':
      case 'yaml':
      case 'html':
        return processTextFile(filePath);
      default:
        return {
          source: filePath,
          format: 'unknown',
          success: false,
          errors: [`Unsupported format: ${extname(filePath)}`],
        };
    }
  } catch (e) {
    return {
      source: filePath,
      format,
      success: false,
      errors: [`Processing error: ${e}`],
    };
  }
}

async function cmdSummarize(filePath: string, options: ProcessOptions): Promise<DocumentResult> {
  const result = await cmdExtract(filePath, { ...options, format: 'txt' });

  if (!result.success || !result.text) {
    return result;
  }

  const summary = generateSummary(result.text, options.maxLength);

  return {
    ...result,
    text: summary,
    metadata: {
      ...result.metadata,
      originalWordCount: result.metadata?.wordCount,
      summaryWordCount: summary.split(/\s+/).filter((w: string) => w.length > 0).length,
    },
  };
}

async function cmdBatch(pattern: string, options: ProcessOptions): Promise<DocumentResult[]> {
  const results: DocumentResult[] = [];

  // Simple glob implementation
  const { globSync } = await import('glob');
  const files = globSync(pattern, { cwd: ROOT });

  for (const file of files) {
    const fullPath = resolve(ROOT, file);
    const result = await cmdExtract(fullPath, options);
    results.push(result);

    if (options.output && result.success && result.text) {
      const outFile = join(options.output, `${basename(file, extname(file))}.txt`);
      ensureDir(dirname(outFile));
      writeFileSync(outFile, result.text, 'utf-8');
    }
  }

  return results;
}

// ─── CLI ──────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { command: string; file: string; options: ProcessOptions } {
  const args = argv.slice(2);
  const command = args[0] || 'help';
  const file = args[1] || '';

  const options: ProcessOptions = {};

  for (let i = 2; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--pages') {
      options.pages = args[++i]
        ?.split(',')
        .map((p: string) => parseInt(p))
        .filter((n: number) => !isNaN(n));
    } else if (arg === '--ocr') {
      options.ocr = true;
    } else if (arg === '--format') {
      options.format = args[++i] as ProcessOptions['format'];
    } else if (arg === '--output') {
      options.output = args[++i];
    } else if (arg === '--max-length') {
      options.maxLength = parseInt(args[++i]) || 500;
    }
  }

  return { command, file, options };
}

async function main(): Promise<void> {
  const { command, file, options } = parseArgs(process.argv);

  console.log(`[DOCUMENT-PROCESSOR] Command: ${command}`);

  switch (command) {
    case 'extract': {
      if (!file) {
        console.error('Usage: extract <file> [--pages 1,3-5] [--ocr] [--format md]');
        process.exit(1);
      }
      const result = await cmdExtract(file, options);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'summarize': {
      if (!file) {
        console.error('Usage: summarize <file> [--max-length 500]');
        process.exit(1);
      }
      const result = await cmdSummarize(file, options);
      console.log(JSON.stringify(result, null, 2));
      break;
    }

    case 'batch': {
      if (!file) {
        console.error('Usage: batch <pattern> [--output dir]');
        process.exit(1);
      }
      const results = await cmdBatch(file, options);
      console.log(JSON.stringify({ processed: results.length, results }, null, 2));
      break;
    }

    case 'help':
    default:
      console.log(`
Document Processor

Commands:
  extract <file> [--pages 1,3-5] [--ocr] [--format md|json|txt]
    Extract text from document

  summarize <file> [--max-length 500]
    Generate summary

  batch <pattern> [--output dir]
    Process multiple files

Supported formats: PDF, DOCX, TXT, MD, CSV, JSON, YAML, HTML
Install for better handling:
  npm install pdf-parse docx glob
`);
  }
}

// Run if called directly
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('[DOCUMENT-PROCESSOR] Error:', e);
    process.exit(1);
  });
}

export {
  cmdExtract,
  cmdSummarize,
  cmdBatch,
  detectFormat,
  processCsvFile,
  processJsonFile,
  processTextFile,
  generateSummary,
  type DocumentResult,
  type TableData,
  type ProcessOptions,
};
