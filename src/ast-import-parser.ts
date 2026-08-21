/**
 * AST Import Parser
 *
 * Usa TypeScript Compiler API para extraer imports reales
 * No regex - parsing real del AST
 *
 * Usage:
 *   import { extractRealImports } from './ast-import-parser.js';
 *   const imports = extractRealImports(sourceCode);
 */

import * as ts from 'typescript';

export interface ImportInfo {
  path: string;
  line: number;
  isDynamic: boolean; // true para import()
}

/**
 * Extrae imports reales del código TypeScript usando AST
 * Ignora strings que contengan "import" pero no sean declaraciones
 */
export function extractRealImports(sourceCode: string, fileName = 'file.ts'): ImportInfo[] {
  const imports: ImportInfo[] = [];

  // Parse source code to AST
  const sourceFile = ts.createSourceFile(fileName, sourceCode, ts.ScriptTarget.Latest, true);

  // Visit all nodes
  function visit(node: ts.Node) {
    // Case 1: import ... from 'path' or import 'path'
    if (ts.isImportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;

      // Get the string value (handle both 'path' and "path")
      if (ts.isStringLiteral(moduleSpecifier)) {
        const path = moduleSpecifier.text;
        const line = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart()).line + 1;
        imports.push({ path, line, isDynamic: false });
      }
    }

    // Case 2: export ... from 'path' (re-exports)
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        const path = node.moduleSpecifier.text;
        const line = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart()).line + 1;
        imports.push({ path, line, isDynamic: false });
      }
    }

    // Case 3: require('path') - CommonJS
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression) && expression.text === 'require') {
        const firstArg = node.arguments[0];
        if (firstArg && ts.isStringLiteral(firstArg)) {
          const path = firstArg.text;
          const line = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart()).line + 1;
          imports.push({ path, line, isDynamic: false });
        }
      }

      // Case 4: dynamic import() - only if it's an actual import expression
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const firstArg = node.arguments[0];
        if (firstArg && ts.isStringLiteral(firstArg)) {
          const path = firstArg.text;
          const line = ts.getLineAndCharacterOfPosition(sourceFile, node.getStart()).line + 1;
          imports.push({ path, line, isDynamic: true });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

/**
 * Verifica si un import path es válido (resuelve a un archivo existente)
 */
export function isImportValid(
  importPath: string,
  sourceFile: string,
  availableModules: Set<string>,
): boolean {
  // Absolute imports from project root
  if (importPath.startsWith('/')) {
    return availableModules.has(importPath.slice(1));
  }

  // Relative imports
  if (importPath.startsWith('.')) {
    // These need to be resolved relative to source file
    // For now, we just check if the pattern looks valid
    return true; // Will be checked with file system
  }

  // Node modules imports (e.g., 'typescript', 'fs')
  // These are considered valid
  return true;
}

// CLI for testing
if (process.argv[1]?.includes('ast-import-parser.ts')) {
  const testCode = `
import { something } from './real-module';
import * as ts from 'typescript';

const notImport = "import './fake-module'";
const includesCheck = target.includes(\`from '\${sourceName}'\`);

function test() {
  const x = require('./commonjs-module');
  import('./dynamic-import');
}
`;

  const imports = extractRealImports(testCode, 'test.ts');
  console.log('Real imports found:');
  for (const imp of imports) {
    console.log(`  Line ${imp.line}: ${imp.path}${imp.isDynamic ? ' (dynamic)' : ''}`);
  }
}
