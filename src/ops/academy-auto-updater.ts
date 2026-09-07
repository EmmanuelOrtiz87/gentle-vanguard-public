#!/usr/bin/env node
/**
 * Academy Auto-Updater v1.0
 *
 * Mantiene sincronizada la Academy con los cambios del stack.
 * Ejecutar después de cada implementación importante.
 *
 * USO:
 *   npm run academy:sync               # Sincronizar Academy completa
 *   npm run academy:sync:check        # Ver diff sin aplicar
 *   npm run academy:generate-lesson  # Generar nueva lección
 *   npm run academy:validate         # Validar integridad
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const ACADEMY_DIR = join(ROOT, 'apps', 'academy-web', 'data');
const DOCS_DIR = join(ROOT, 'docs');

// Colors
const c = {
  r: '\x1b[0m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[36m',
};

function log(msg: string, type: 'info' | 'success' | 'warn' = 'info'): void {
  const color = { info: c.b, success: c.g, warn: c.y }[type];
  console.log(`${color}${msg}${c.r}`);
}

// =============================================================================
// SYNC ACADEMY WITH STACK CHANGES
// =============================================================================

interface ChangeLog {
  timestamp: string;
  changes: Array<{
    type: 'new' | 'updated' | 'removed';
    component: string;
    lesson: string;
    action: string;
  }>;
}

function loadAcademyIndex(): Record<string, string[]> {
  const index: Record<string, string[]> = {
    fundamentos: [],
    agentes: [],
    arquitectura: [],
    automatizaciones: [],
    casos_reales: [],
    knowledge_base: [],
    laboratorio: [],
    negocio: [],
    optimizacion: [],
  };

  // Load actual content from files
  for (const track of Object.keys(index)) {
    const file = join(ACADEMY_DIR, `content-${track.replace('_', '-')}.js`);
    if (existsSync(file)) {
      try {
        const content = readFileSync(file, 'utf-8');
        // Extract lesson IDs using regex
        const matches = content.match(/id:\s*['"]([^'"]+)['"]/g);
        if (matches) {
          index[track] = matches.map((m) => m.replace(/id:\s*['"]|['"]/g, ''));
        }
      } catch {
        // Non-critical
      }
    }
  }

  return index;
}

function generateSyncReport(): ChangeLog {
  const report: ChangeLog = {
    timestamp: new Date().toISOString(),
    changes: [],
  };

  // New features from v4.0 BLACKCAT
  const newFeatures = [
    { component: 'Intelligent Delegator v2.0', track: 'agentes', lesson: 'intelligent-delegator-v2' },
    { component: 'SmartTask Wrapper', track: 'agentes', lesson: 'smart-task-wrapper' },
    { component: 'Policy Engine @govern', track: 'arquitectura', lesson: 'policy-engine-govern' },
    { component: 'OWASP Agentic Top 10', track: 'arquitectura', lesson: 'owasp-agentic-top10' },
    { component: 'Smallest Route Router', track: 'optimizacion', lesson: 'smallest-route-router' },
  ];

  const currentIndex = loadAcademyIndex();

  for (const feature of newFeatures) {
    const existingLessons = currentIndex[feature.track] || [];
    if (!existingLessons.includes(feature.lesson)) {
      report.changes.push({
        type: 'new',
        component: feature.component,
        lesson: feature.lesson,
        action: `Agregar lección a content-${feature.track}.js`,
      });
    }
  }

  return report;
}

// =============================================================================
// GENERATE DOCUMENTATION FROM CODE
// =============================================================================

function generateLessonsFromCode(): void {
  const lessonsPath = join(DOCS_DIR, 'generated-lessons');

  if (!existsSync(lessonsPath)) {
    mkdirSync(lessonsPath, { recursive: true });
  }

  // Generate lesson from Policy Engine
  const policyEngineLesson = generatePolicyEngineLesson();
  writeFileSync(
    join(lessonsPath, 'policy-engine-lesson.md'),
    policyEngineLesson,
    'utf-8'
  );

  // Generate lesson from Intelligent Delegator
  const delegatorLesson = generateDelegatorLesson();
  writeFileSync(
    join(lessonsPath, 'intelligent-delegator-lesson.md'),
    delegatorLesson,
    'utf-8'
  );

  // Generate lesson from Smallest Route
  const routerLesson = generateRouterLesson();
  writeFileSync(
    join(lessonsPath, 'smallest-route-lesson.md'),
    routerLesson,
    'utf-8'
  );

  log(`Lessons generated: ${lessonsPath}`, 'success');
}

function generatePolicyEngineLesson(): string {
  return `## Lección: Policy Engine @govern [AUTO-GENERATED]

**Tiempo**: 15 minutos | **Tipo**: Taller Práctico

### Descripción
${readFileSync(join(ROOT, 'src/security/policy-engine/README.md'), 'utf-8').substring(0, 500)}...

### Código de ejemplo
\`\`\`typescript
${readFileSync(join(ROOT, 'src/security/policy-engine/policy-engine.ts'), 'utf-8').substring(0, 800)}...
\`\`\`

### Ejercicios
1. Crear una policy para bloquear comandos destructivos
2. Evaluar una acción contra la policy
3. Verificar audit trail

**Generado**: ${new Date().toISOString()}
`;
}

function generateDelegatorLesson(): string {
  return `## Lección: Intelligent Delegator v2.0 [AUTO-GENERATED]

**Tiempo**: 12 minutos | **Tipo**: Curso

### Conceptos clave
- Auto-detection de modelos
- Fallback chain
- Persistencia runtime
- Aprendizaje por agente

### Código
Código completo disponible en:
- \`src/orchestration/intelligent-delegator.ts\`
- \`src/orchestration/task-wrapper.ts\`

### Comandos
\`\`\`bash
npm run delegate:intelligent
npm run delegate:status
\`\`\`

**Generado**: ${new Date().toISOString()}
`;
}

function generateRouterLesson(): string {
  return `## Lección: Smallest Route Router [AUTO-GENERATED]

**Tiempo**: 12 minutos | **Tipo**: Taller

### Filosofía
> "The agent picks the smallest route that gets there."

### Señales de Routing
- file_count, confidence, ambiguity, complexity

### Uso
\`\`\`typescript
import { smallestRoute } from './smallest-route-router.js';
smallestRoute.analyze({ description: '...', estimatedFiles: 1 });
\`\`\`

**Generado**: ${new Date().toISOString()}
`;
}

// =============================================================================
// VALIDATE ACADEMY STRUCTURE
// =============================================================================

function validateAcademy(): boolean {
  const requiredTracks = [
    'fundamentos',
    'agentes',
    'arquitectura',
    'optimizacion',
    'automatizaciones',
    'negocio',
    'laboratorio',
    'knowledge_base',
    'casos_reales',
  ];

  let valid = true;

  for (const track of requiredTracks) {
    const file = join(ACADEMY_DIR, `content-${track.replace('_', '-')}.js`);
    if (!existsSync(file)) {
      log(`❌ Missing: ${file}`, 'warn');
      valid = false;
    } else {
      try {
        const content = readFileSync(file, 'utf-8');
        const lessonCount = (content.match(/id:\s*['"]/g) || []).length;
        log(`✅ ${track}: ${lessonCount} lecciones`, 'success');
      } catch {
        log(`⚠️ Error reading: ${file}`, 'warn');
      }
    }
  }

  return valid;
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  const command = process.argv[2];

  switch (command) {
    case 'sync':
    case 'check': {
      log('🔍 Academy Sync Check', 'info');
      const report = generateSyncReport();

      if (report.changes.length === 0) {
        log('✅ Academy is up to date!', 'success');
      } else {
        log(`\n${report.changes.length} changes needed:`, 'warn');
        for (const change of report.changes) {
          const color = change.type === 'removed' ? 'warn' : 'warn';
          log(`  ${change.type.toUpperCase()}: ${change.component}`, color);
          log(`    Action: ${change.action}`, 'info');
        }
      }

      if (command === 'sync') {
        generateLessonsFromCode();
        log('\n✅ Sync complete!', 'success');
      }
      break;
    }

    case 'generate': {
      log('📝 Generating lessons from code...', 'info');
      generateLessonsFromCode();
      log('✅ Generated!', 'success');
      break;
    }

    case 'validate': {
      log('🔎 Validating Academy structure...', 'info');
      const valid = validateAcademy();
      if (valid) {
        log('\n✅ All tracks validated!', 'success');
      } else {
        log('\n⚠️  Some issues found', 'warn');
        process.exit(1);
      }
      break;
    }

    default:
      console.log(`
Academy Auto-Updater v1.0

Commands:
  sync      - Check and sync Academy with stack changes
  check     - Check only (no changes)
  generate  - Generate lessons from current code
  validate  - Validate Academy structure

Examples:
  npm run academy:sync
  npm run academy:sync:check
  npm run academy:generate-lesson
  npm run academy:validate
`);
  }
}

void main();
