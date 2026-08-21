#!/usr/bin/env node
/**
 * Token Session Comparator
 * 
 * Compara tokens de la sesión actual vs sesiones anteriores
 * para verificar si las optimizaciones funcionan.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║        COMPARACIÓN DE TOKENS - GENTLE VANGUARD                 ║');
console.log('╚════════════════════════════════════════════════════════════════╝');
console.log();

// Detectar fuente de datos
const POSSIBLE_LOCATIONS = [
  join(homedir(), '.local', 'share', 'opencode', 'opencode.db'),
  join(process.cwd(), '.runtime', 'gentle-vanguard.db'),
  join(process.cwd(), 'reports', 'stack-live-observability-latest.json'),
];

console.log('Buscando fuentes de datos:');
for (const loc of POSSIBLE_LOCATIONS) {
  const exists = existsSync(loc);
  console.log(`  ${exists ? '✓' : '✗'} ${loc}`);
}
console.log();

// Leer reporte de observability si existe
const reportPath = join(process.cwd(), 'reports', 'stack-live-observability-latest.json');
if (existsSync(reportPath)) {
  try {
    const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
    
    console.log('=== REPORTE DE OBSERVABILIDAD ═══');
    console.log(`Sesión actual: ${report.session?.id || 'N/A'}`);
    console.log(`Tiempo activo: ${report.session?.elapsed || 'N/A'}`);
    console.log();
    
    if (report.tokenMetrics) {
      const t = report.tokenMetrics;
      console.log('┌─ MÉTRICAS DE TOKENS ──────────────────────┐');
      console.log(`│ Input:          ${t.input?.toString().padStart(15) || '0'} │`);
      console.log(`│ Output:         ${t.output?.toString().padStart(15) || '0'} │`);
      console.log(`│ Cache Read:      ${t.cacheRead?.toString().padStart(15) || '0'} │`);
      console.log(`│ Total:          ${(t.input + t.output).toString().padStart(15)} │`);
      console.log('└───────────────────────────────────────────┘');
      console.log();
      
      // Estimar costo (aproximado)
      const estimatedCost = ((t.input || 0) * 0.000001) + ((t.output || 0) * 0.000002);
      console.log(`Costo estimado: $${estimatedCost.toFixed(4)}`);
    }
  } catch (err) {
    console.log(`Error leyendo reporte: ${err}`);
  }
}

// Leer datos de Nexus
const nexusPath = join(process.cwd(), '.runtime', 'gentle-vanguard.db');
if (existsSync(nexusPath)) {
  try {
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(nexusPath, { readonly: true });
    
    console.log();
    console.log('=== DATOS HISTÓRICOS (NEXUS) ═══');
    console.log();
    
    // Últimas 10 sesiones
    console.log('─ Últimas 10 sesiones ─');
    const recent = db.prepare(`
      SELECT 
        substr(session_id, 1, 20) as session_id,
        SUM(input_tokens) + SUM(output_tokens) as total,
        SUM(input_tokens) as input,
        SUM(output_tokens) as output,
        COUNT(*) as transactions,
        date(MAX(created_at)) as date
      FROM token_transactions 
      GROUP BY session_id
      ORDER BY MAX(created_at) DESC
      LIMIT 10
    `).all() as any[];
    
    if (recent.length > 0) {
      console.log('Session                Total      Input      Output  TXNs  Date');
      console.log('─'.repeat(80));
      recent.forEach((r: any) => {
        console.log(
          `${(r.session_id).padEnd(20)} ` +
          `${(r.total || 0).toLocaleString().padStart(10)} ` +
          `${(r.input || 0).toLocaleString().padStart(10)} ` +
          `${(r.output || 0).toLocaleString().padStart(10)} ` +
          `${(r.transactions || 0).toString().padStart(4)} ` +
          `${r.date}`
        );
      });
      
      // Calcular promedio
      const avgTokens = recent.reduce((sum, r) => sum + (r.total || 0), 0) / recent.length;
      const avgInput = recent.reduce((sum, r) => sum + (r.input || 0), 0) / recent.length;
      
      console.log('─'.repeat(80));
      console.log(`Promedio últimas 10: ${Math.round(avgTokens).toLocaleString()} tokens`);
      console.log(`Promedio input:      ${Math.round(avgInput).toLocaleString()} tokens`);
    } else {
      console.log('  No hay datos en token_transactions');
    }
    
    // Top sesiones de siempre
    console.log();
    console.log('─ Sesiones más pesadas (historial completo) ─');
    const heaviest = db.prepare(`
      SELECT 
        substr(session_id, 1, 20) as session_id,
        SUM(input_tokens) + SUM(output_tokens) as total,
        SUM(input_tokens) as input,
        SUM(output_tokens) as output,
        COUNT(*) as transactions,
        date(MAX(created_at)) as date
      FROM token_transactions 
      GROUP BY session_id
      ORDER BY total DESC
      LIMIT 5
    `).all() as any[];
    
    if (heaviest.length > 0) {
      console.log('Session                Total      Input      Output  TXNs');
      console.log('─'.repeat(80));
      heaviest.forEach((r: any) => {
        console.log(
          `${(r.session_id).padEnd(20)} ` +
          `${(r.total || 0).toLocaleString().padStart(10)} ` +
          `${(r.input || 0).toLocaleString().padStart(10)} ` +
          `${(r.output || 0).toLocaleString().padStart(10)} ` +
          `${(r.transactions || 0).toString().padStart(4)}` +
          ` ${r.date ? '(' + r.date + ')' : ''}`
        );
      });
    }
    
    // Totales históricos
    const totals = db.prepare(`
      SELECT 
        COUNT(DISTINCT session_id) as sessions,
        SUM(input_tokens) as total_input,
        SUM(output_tokens) as total_output,
        SUM(cache_read_tokens) as total_cache_read,
        COUNT(*) as transactions
      FROM token_transactions
    `).get() as any;
    
    console.log();
    console.log('=== TOTALES HISTÓRICOS ═══');
    console.log(`Total sesiones:      ${totals.sessions}`);
    console.log(`Total transacciones: ${totals.transactions}`);
    console.log(`Total tokens:        ${(totals.total_input + totals.total_output).toLocaleString()}`);
    console.log(`  - Input:           ${(totals.total_input).toLocaleString()}`);
    console.log(`  - Output:          ${(totals.total_output).toLocaleString()}`);
    console.log(`  - Cache Read:      ${(totals.total_cache_read || 0).toLocaleString()}`);
    
    db.close();
  } catch (err) {
    console.log(`Error leyendo Nexus: ${err}`);
  }
}

console.log();
console.log('═══════════════════════════════════════════════════════════════');
console.log('💡 NOTA: Los datos pueden venir de múltiples fuentes');
console.log('   - Nexus DB (.runtime/gentle-vanguard.db)');
console.log('   - OpenCode DB (~/.local/share/opencode/opencode.db)');
console.log('   - Reporte de observabilidad');
console.log('═══════════════════════════════════════════════════════════════');
