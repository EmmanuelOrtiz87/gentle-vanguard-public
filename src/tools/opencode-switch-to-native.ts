#!/usr/bin/env npx tsx
/**
 * Script para cambiar todos los agentes de opencode.json al modelo nativo
 * opencode/deepseek-v4-flash-free
 */

import { readFileSync, writeFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { join } from 'path';

const ROOT = process.cwd();
const OPENCODE_PATH = join(ROOT, 'opencode.json');

interface AgentConfig {
  description: string;
  mode: string;
  model?: string;
  provider?: string;
  litellm_settings?: Record<string, unknown>;
  steps?: number;
  [key: string]: unknown;
}

interface OpencodeConfig {
  agent: Record<string, AgentConfig>;
  [key: string]: unknown;
}

function main(): void {
  console.log('=== Switching opencode.json to native model ===');

  try {
    const content = readFileSync(OPENCODE_PATH, 'utf-8');
    const config: OpencodeConfig = JSON.parse(content);

    let updatedCount = 0;
    const agents = Object.keys(config.agent);

    for (const agentName of agents) {
      const agentConfig = config.agent[agentName];

      // Solo cambiar modelos que no sean el nativo
      if (agentConfig.model && agentConfig.model !== 'opencode/deepseek-v4-flash-free') {
        console.log(`  ${agentName}: ${agentConfig.model} → opencode/deepseek-v4-flash-free`);
        agentConfig.model = 'opencode/deepseek-v4-flash-free';
        agentConfig.provider = 'opencode';

        // Asegurar litellm_settings apropiados
        if (!agentConfig.litellm_settings) {
          agentConfig.litellm_settings = {};
        }
        (agentConfig.litellm_settings as Record<string, boolean>).drop_params = true;

        updatedCount++;
      }
    }

    // Guardar cambios
    writeFileSync(OPENCODE_PATH, JSON.stringify(config, null, 2), 'utf-8');

    console.log(`\n✅ Actualizados ${updatedCount}/${agents.length} agentes`);
    console.log('📊 Modelo nativo: opencode/deepseek-v4-flash-free');
    console.log('🏷️  Provider: opencode');
    console.log(
      '\n⚠️  IMPORTANTE: Reinicia cualquier sesión de opencode para que los cambios surtan efecto',
    );
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Ejecutar si se llama directamente
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
