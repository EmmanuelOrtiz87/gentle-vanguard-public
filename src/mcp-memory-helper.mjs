#!/usr/bin/env node
/**
 * MCP Memory Knowledge Graph Helper
 * Populates entities and relations into the knowledge graph.
 * Usage: node src/mcp-memory-helper.mjs
 */
const { spawn } = await import('child_process');

async function callTool(toolName, args) {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn('cmd', ['/c', 'npx', '-y', '@modelcontextprotocol/server-memory@latest'], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    let output = '';
    proc.stdout.on('data', (d) => output += d.toString());
    proc.stderr.on('data', () => {});
    proc.on('close', (code) => resolvePromise(output));
    proc.on('error', reject);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: toolName, arguments: args } }) + '\n');
    proc.stdin.end();
    setTimeout(() => { proc.kill(); resolvePromise(output); }, 3000);
  });
}

const entities = [
  { name: 'Gentle-Vanguard', entityType: 'Project', observations: ['AI-powered dev platform', 'TypeScript strict mode', '108 PS1 scripts', 'React/Vite dashboard', '5 MCP servers', '19/19 tests'] },
  { name: 'Dashboard', entityType: 'Component', observations: ['24 components', '22 metric cards', '10 sections', 'WS port 8080', 'i18n en/es/pt-BR', 'Heatmaps + LiveChart'] },
  { name: 'MCP Infrastructure', entityType: 'Infrastructure', observations: ['5 servers: codegraph, engram, chrome-devtools, filesystem, memory', 'knowledge graph', 'browser testing', 'workspace navigation'] },
  { name: 'Main Stack', entityType: 'Technology', observations: ['pnpm v11.15.1', 'TypeScript 6.0.3', 'ESLint v10 flat config', 'Node.js v24', 'GitHub Actions CI/CD 5 jobs', 'Watchtower 73/78'] },
  { name: 'Orchestrator', entityType: 'Agent', observations: ['Coordinates specialized subagents', 'Session lifecycle management', 'Token budget enforcement', 'Karpathy guidelines'] },
  { name: 'Session Pipeline', entityType: 'Process', observations: ['53-step session pipeline', 'Autostart with 32 steps', 'Scoring, checkpoint, audit', 'Lazy background execution'] },
];

async function main() {
  console.log('=== MCP Memory Knowledge Graph ===\n');

  // 1. Create all entities at once
  console.log('Creating entities...');
  const r1 = await callTool('create_entities', { entities });
  console.log(' ', r1.slice(0, 200));

  // 2. Create relations  
  console.log('\nCreating relations...');
  const relations = [
    { from: 'Dashboard', to: 'Gentle-Vanguard', relationType: 'part_of' },
    { from: 'MCP Infrastructure', to: 'Gentle-Vanguard', relationType: 'part_of' },
    { from: 'Main Stack', to: 'Gentle-Vanguard', relationType: 'supports' },
    { from: 'Orchestrator', to: 'Gentle-Vanguard', relationType: 'part_of' },
    { from: 'Session Pipeline', to: 'Gentle-Vanguard', relationType: 'part_of' },
    { from: 'Dashboard', to: 'MCP Infrastructure', relationType: 'uses' },
    { from: 'Orchestrator', to: 'Session Pipeline', relationType: 'manages' },
    { from: 'MCP Infrastructure', to: 'Main Stack', relationType: 'runs_on' },
  ];
  const r2 = await callTool('add_relations', { relations });
  console.log(' ', r2.slice(0, 200));

  // If add_relations doesn't exist, try create_relations
  if (r2.includes('not found')) {
    console.log('   Trying create_relations...');
    const r2b = await callTool('create_relations', { relations });
    console.log(' ', r2b.slice(0, 200));
  }

  console.log('\n=== Knowledge Graph Populated ===');
}

main().catch(console.error);
