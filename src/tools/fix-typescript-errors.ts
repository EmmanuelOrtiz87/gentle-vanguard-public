#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(process.cwd());

function log(msg: string): void {
  console.log(msg);
}

function step(num: number, label: string): void {
  log(`${num}. Corrigiendo ${label}...`);
}

function ok(label: string): void {
  log(`   ✅ ${label} corregido`);
}

function fixDependencySecurityChecker(): void {
  step(1, 'dependency-security-checker.ts');
  const fp = path.join(ROOT, 'src', 'dependency-security-checker.ts');
  if (!fs.existsSync(fp)) {
    log('   ⚠️  File not found, skipping');
    return;
  }
  let content = fs.readFileSync(fp, 'utf-8');
  content = content.replace(/import \{ readFileSync \} from 'fs';\n?/g, '');
  content = content.replace(/import \{ join \} from 'path';\n?/g, '');
  fs.writeFileSync(fp, content, 'utf-8');
  ok('dependency-security-checker.ts');
}

function fixSecurityInitializer(): void {
  step(2, 'security-initializer.ts');
  const fp = path.join(ROOT, 'src', 'security', 'security-initializer.ts');
  if (!fs.existsSync(fp)) {
    log('   ⚠️  File not found, skipping');
    return;
  }
  let content = fs.readFileSync(fp, 'utf-8');
  content = content.replace(
    /import \{ auditLogger \} from '\.\.\/src\/audit-logger-enhanced';\n?/g,
    '',
  );
  fs.writeFileSync(fp, content, 'utf-8');
  ok('security-initializer.ts');
}

function fixIntegrationValidator(): void {
  step(3, 'integration-validator.ts');
  const fp = path.join(ROOT, 'src', 'integration-validator.ts');
  if (!fs.existsSync(fp)) {
    log('   ⚠️  File not found, skipping');
    return;
  }
  const lines = fs.readFileSync(fp, 'utf-8').split('\n');
  const newLines: string[] = [];
  for (const line of lines) {
    if (/result\.suggestions/.test(line)) {
      if (/Consider adding security/.test(line)) {
        newLines.push(
          "          result.suggestions.push('Consider adding security considerations to SKILL.md');",
        );
      } else if (/Consider documenting/.test(line)) {
        newLines.push(
          "          result.suggestions.push('Consider documenting integration points in SKILL.md');",
        );
      } else {
        newLines.push(line);
      }
    } else {
      newLines.push(line);
    }
  }
  fs.writeFileSync(fp, newLines.join('\n'), 'utf-8');
  ok('integration-validator.ts');
}

log('=== Corrigiendo errores TypeScript ===');
fixDependencySecurityChecker();
fixSecurityInitializer();
fixIntegrationValidator();
log('\n=== Corrección completada ===');
log("Ejecuta 'npm run typecheck' para verificar que los errores se han resuelto");
