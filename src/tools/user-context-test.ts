#!/usr/bin/env node
/**
 * Test básico para verificar que los módulos cargan correctamente
 */

// Verify modules load correctly
import './user-operating-context.js';
import './decisions-log.js';
import { getDomainTemplate, listDomainTemplates } from '../sdd/domain-templates.js';

console.log('✅ User Operating Context module loaded');
console.log('✅ Decisions Log module loaded');
console.log('✅ Domain Templates module loaded');

// Test basic functions work
console.log('\n📊 Testing functions:');

try {
  const domains = listDomainTemplates();
  console.log(`  ✅ listDomainTemplates(): ${domains.length} domains found`);

  const devCopilot = getDomainTemplate('developer-copilot');
  console.log(`  ✅ getDomainTemplate('developer-copilot'): ${devCopilot?.name ?? 'NOT FOUND'}`);

  console.log('\n🎉 All modules loaded successfully!');
} catch (error) {
  console.error('❌ Error loading modules:', error);
  process.exit(1);
}
