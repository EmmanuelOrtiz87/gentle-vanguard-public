/**
 * Agregar info-triggers a dashboard.html y patterns-conventions.html
 * Script de utilidad para completar triggers faltantes
 */

import * as fs from 'fs';

console.log('Agregando info-triggers...');

// Para dashboard.html - triggers en secciones principales
const dashboardTriggers = [
  { key: 'tip_dashboard_ws', text: 'WebSocket real-time updates' },
  { key: 'tip_dashboard_metrics', text: 'Real-time metrics visualization' },
  { key: 'tip_dashboard_alerts', text: '8 configurable alert rules' },
  { key: 'tip_dashboard_i18n', text: '3 language support' },
  { key: 'tip_dashboard_tracing', text: 'Distributed tracing waterfall' },
  { key: 'tip_dashboard_health', text: 'Health check monitoring' },
];

// Para patterns-conventions.html
const patternsTriggers = [
  { key: 'tip_patterns_sdd', text: 'Spec-Driven Development lifecycle' },
  { key: 'tip_patterns_karpathy', text: 'Karpathy guidelines enforcement' },
  { key: 'tip_patterns_governance', text: 'Governance and compliance rules' },
  { key: 'tip_patterns_ai_slop', text: 'AI slop detection patterns' },
  { key: 'tip_patterns_architecture', text: 'Architecture patterns library' },
  { key: 'tip_patterns_documentation', text: 'Documentation and ADR standards' },
];

console.log('Triggers preparados.');
console.log('Dashboard triggers:', dashboardTriggers.length);
console.log('Patterns triggers:', patternsTriggers.length);

// Guardar especificación para implementación manual
const triggerSpec = {
  dashboard: dashboardTriggers,
  patterns: patternsTriggers,
  timestamp: new Date().toISOString(),
};

fs.writeFileSync('.session/triggers-spec.json', JSON.stringify(triggerSpec, null, 2));

console.log('\n✅ Especificación guardada en .session/triggers-spec.json');
console.log('\nPara implementar, usar el patrón:');
console.log('<span class="info-trigger" data-i18n-title="tip_key">i</span>');
