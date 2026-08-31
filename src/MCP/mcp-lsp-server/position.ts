import * as ts from 'typescript';
import { resolve, dirname, isAbsolute } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
export const ROOT = resolve(dirname(__filename), '../..');

export function resolveFilePath(filePath: string): string {
  if (isAbsolute(filePath)) return normalizePath(filePath);
  return normalizePath(resolve(ROOT, filePath));
}

export function normalizePath(p: string): string {
  return p.replace(/[/\\]/g, '\\');
}

export function getOffset(
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

export function getLineColFromPosition(
  sf: ts.SourceFile,
  pos: number,
): { line: number; col: number } {
  const lc = sf.getLineAndCharacterOfPosition(pos);
  return { line: lc.line + 1, col: lc.character + 1 };
}

export function basename(p: string): string {
  return p.split(/[/\\]/).pop() || p;
}

export function getQuickInfoDisplayString(qi: ts.QuickInfo): string {
  if (qi.displayParts) {
    return qi.displayParts.map((p) => p.text).join('');
  }
  return '';
}
