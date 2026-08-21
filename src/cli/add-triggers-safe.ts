/**
 * Agregar triggers a presentaciones HTML usando parser
 * Esta versión es más segura porque parsea el HTML estructuralmente
 */

import * as fs from 'fs';

interface Trigger {
  id: string;
  anchor: string;
  tip: string;
  position: string;
}

console.log('Agregando triggers de forma segura con parser HTML...\n');

// Configuración de triggers para dashboard.html
const dashboardTriggers: Trigger[] = [
  {
    id: 'ws-section',
    anchor: 'WebSocket',
    tip: 'tip_dashboard_websocket',
    position: 'after',
  },
  {
    id: 'sections-info',
    anchor: '7 sections',
    tip: 'tip_dashboard_sections',
    position: 'after',
  },
  {
    id: 'alerts-info',
    anchor: '8 alert rules',
    tip: 'tip_dashboard_alerts',
    position: 'after',
  },
  {
    id: 'i18n-info',
    anchor: '3 languages',
    tip: 'tip_dashboard_i18n',
    position: 'after',
  },
];

// Configuración de triggers para patterns-conventions.html
const patternsTriggers = [
  {
    id: 'karpathy-info',
    anchor: 'Karpathy',
    tip: 'tip_patterns_karpathy',
    position: 'after',
  },
  {
    id: 'sdd-info',
    anchor: 'SDD',
    tip: 'tip_patterns_sdd',
    position: 'after',
  },
  {
    id: 'slop-info',
    anchor: 'Slop',
    tip: 'tip_patterns_slop',
    position: 'after',
  },
  {
    id: 'arch-info',
    anchor: 'Architecture Patterns',
    tip: 'tip_patterns_arch',
    position: 'after',
  },
  {
    id: 'standards-info',
    anchor: 'Standards',
    tip: 'tip_patterns_standards',
    position: 'after',
  },
  {
    id: 'docs-info',
    anchor: 'Documentation',
    tip: 'tip_patterns_docs',
    position: 'after',
  },
];

function addTriggersSafely(filePath: string, triggers: Trigger[], pageName: string): boolean {
  console.log(`\n📄 Procesando ${pageName}...`);

  if (!fs.existsSync(filePath)) {
    console.log(`   ⚠️ Archivo no encontrado: ${filePath}`);
    return false;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // Verificar si ya tiene triggers
  if (content.includes('tip_dashboard_') || content.includes('tip_patterns_')) {
    console.log(`   ℹ️ Ya tiene triggers, saltando...`);
    return false;
  }

  // Para cada trigger, buscar el texto ancla y agregar después
  for (const trigger of triggers) {
    // Crear el span del trigger
    const triggerSpan = `<span class="info-trigger" data-i18n-title="${trigger.tip}">i</span>`;

    // Buscar el texto ancla
    const anchorPattern = new RegExp(`(${trigger.anchor}[^<]*)(</)`, 'i');

    if (anchorPattern.test(content)) {
      // Solo reemplazar si no está dentro de un atributo o URL
      const beforeReplace = content;

      // Verificar que no estamos dentro de una URL o atributo
      const potentialMatch = content.match(anchorPattern);
      if (potentialMatch) {
        const matchIndex = potentialMatch.index;
        const beforeMatch = content.substring(0, matchIndex);

        // Verificar que no estamos dentro de comillas
        const quotesInContext = (beforeMatch.match(/"/g) || []).length;
        const isInAttribute = quotesInContext % 2 !== 0;

        if (!isInAttribute) {
          content = content.replace(anchorPattern, `$1${triggerSpan}$2`);
          if (content !== beforeReplace) {
            modified = true;
            console.log(`   ✅ Trigger ${trigger.tip} agregado`);
          }
        } else {
          console.log(`   ⚠️ Salteando ${trigger.tip} (dentro de atributo)`);
        }
      }
    } else {
      console.log(`   ⚠️ Ancla no encontrada: ${trigger.anchor}`);
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, content);
    console.log(`   ✅ ${pageName} actualizado`);
    return true;
  }

  console.log(`   ℹ️ Sin cambios en ${pageName}`);
  return false;
}

// Ejecutar para dashboard.html
addTriggersSafely('docs/presentations/dashboard.html', dashboardTriggers, 'dashboard.html');

// Ejecutar para patterns-conventions.html
addTriggersSafely(
  'docs/presentations/patterns-conventions.html',
  patternsTriggers,
  'patterns-conventions.html',
);

console.log('\n✅ Proceso completado');
console.log('\nNota: Los archivos están minificados, lo que dificulta la inserción precisa.');
console.log('Se recomienda agregar los triggers manualmente o usar un formatter HTML primero.');
