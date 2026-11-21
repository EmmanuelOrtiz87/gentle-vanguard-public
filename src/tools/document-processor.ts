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

async function processPdfFile(filePath: string, options: ProcessOptions): Promise<DocumentResult> {
  const extracted = extractWithPython(filePath, 'pdf', options);
  if (extracted.success || options.ocr || options.pages) return extracted;
  const fallback = runSync('pdftotext', ['-layout', filePath, '-'], {
    timeout: 30_000,
    maxBuffer: 50 * 1024 * 1024,
  });
  if (fallback.status !== 0 || !fallback.stdout.trim()) return extracted;
  return {
    source: filePath,
    format: 'pdf',
    success: true,
    text: fallback.stdout,
    metadata: { wordCount: fallback.stdout.trim().split(/\s+/).length },
    warnings: [
      'Extracción alternativa con pdftotext. Revisar páginas sin texto, tablas y orden de lectura.',
      ...(options.ocr || options.pages ? ['OCR y selección de páginas no implementados.'] : []),
    ],
  };
}

async function processDocxFile(filePath: string): Promise<DocumentResult> {
  return extractWithPython(filePath, 'docx');
}

function extractWithPython(
  filePath: string,
  format: 'pdf' | 'docx',
  options?: ProcessOptions,
): DocumentResult {
  const program =
    format === 'pdf'
      ? String.raw`
import json, sys
from pypdf import PdfReader
reader = PdfReader(sys.argv[1])
selection = json.loads(sys.argv[2])
indices = selection if selection is not None else list(range(1, len(reader.pages) + 1))
if not indices or any(i < 1 or i > len(reader.pages) for i in indices):
    raise ValueError("Invalid PDF page selection")
pages = [(i, reader.pages[i - 1].extract_text() or "") for i in indices]
ocr_pages = []
ocr_failed = False
if sys.argv[3] == "true" and any(not p.strip() for _, p in pages):
    try:
        import fitz
        from rapidocr import RapidOCR
        engine = RapidOCR()
        with fitz.open(sys.argv[1]) as document:
            for index, (i, text) in enumerate(pages):
                if not text.strip():
                    image = document[i - 1].get_pixmap(dpi=180, alpha=False)
                    result = engine(image.tobytes("png"))
                    if result.txts:
                        pages[index] = (i, "\n".join(result.txts))
                        ocr_pages.append(i)
    except Exception:
        ocr_failed = True
print(json.dumps({"text": "\n\n".join(f"[Página {i}]\n{p}" for i, p in pages),
                  "missing": [i for i, p in pages if not p.strip()],
                  "readable": any(p.strip() for _, p in pages), "ocrPages": ocr_pages, "ocrFailed": ocr_failed}))
`
      : String.raw`
import json, sys
from docx import Document
document = Document(sys.argv[1])
paragraphs = ["".join(p.xpath(".//w:t/text()")) for p in document.element.body.xpath(".//w:p")]
print(json.dumps({"text": "\n".join(paragraphs), "readable": any(p.strip() for p in paragraphs)}))
`;
  const result = runSync(
    'python',
    ['-c', program, filePath, JSON.stringify(options?.pages ?? null), String(!!options?.ocr)],
    {
      timeout: options?.ocr ? 120_000 : 30_000,
      maxBuffer: 50 * 1024 * 1024,
    },
  );
  const base = { source: filePath, format };
  if (result.status !== 0 || result.error) {
    return {
      ...base,
      success: false,
      errors: [
        `No se pudo extraer ${format}. Requiere Python con ${format === 'pdf' ? 'pypdf' : 'python-docx'} y un archivo legible.`,
      ],
    };
  }
  const data = JSON.parse(result.stdout) as {
    text: string;
    readable: boolean;
    missing?: number[];
    ocrPages?: number[];
    ocrFailed?: boolean;
  };
  const warnings =
    format === 'docx'
      ? [
          'Extracción de texto del cuerpo. Revisar estructura de tablas, encabezados, notas e imágenes en el original.',
        ]
      : ['Extracción de capa textual. Revisar tablas, imágenes y orden de lectura en el original.'];
  if (data.missing?.length)
    warnings.push(`Páginas sin texto extraíble: ${data.missing.join(', ')}.`);
  if (data.ocrPages?.length)
    warnings.push(
      `OCR en páginas ${data.ocrPages.join(', ')}. Cotejar texto y cifras con la imagen.`,
    );
  if (data.ocrFailed)
    warnings.push('OCR falló. Verificá PyMuPDF, RapidOCR y las páginas pendientes.');
  return {
    ...base,
    success: data.readable,
    text: data.readable ? data.text : undefined,
    warnings,
    errors: data.readable ? undefined : ['El archivo no contiene texto extraíble.'],
    metadata: { wordCount: data.text.trim().split(/\s+/).filter(Boolean).length },
  };
}

// ─── Extractive preview ─────────────────────────────────────────────────

function generateSummary(text: string, maxLength: number = 500): string {
  if (text.length <= maxLength) return text;
  if (maxLength <= 0) return '';
  const excerpt = text.slice(0, maxLength - 1).trimEnd();
  return excerpt + '…';
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
  const result = await cmdExtract(filePath, options);

  if (!result.success || !result.text) {
    return result;
  }

  const summary = generateSummary(result.text, options.maxLength);

  return {
    ...result,
    text: summary,
    warnings: [
      ...(result.warnings ?? []),
      'Vista previa literal; puede omitir información del final.',
    ],
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
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
