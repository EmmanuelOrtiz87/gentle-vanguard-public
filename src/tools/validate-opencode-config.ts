#!/usr/bin/env node
/**
 * Validate opencode.json for unrecognized properties and structural integrity.
 * TS migration of scripts/utilities/config/validate-opencode-config.ps1
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

const VALID_PROPS = new Set([
  '$schema',
  'agent',
  'attachment',
  'autoshare',
  'autoupdate',
  'command',
  'compaction',
  'default_agent',
  'disabled_providers',
  'enabled_providers',
  'enterprise',
  'experimental',
  'formatter',
  'instructions',
  'layout',
  'logLevel',
  'lsp',
  'mcp',
  'mode',
  'model',
  'name', // OpenCode no lo reconoce pero permite
  'description', // OpenCode no lo reconoce pero permite
  'permission',
  'plugin',
  'provider',
  'reference',
  'references',
  'server',
  'share',
  'shell',
  'skills',
  'small_model',
  'snapshot',
  'tools',
  'tool_output',
  'username',
  'watcher',
]);

// Additional structural validation rules
function validateAgents(agents: unknown): string[] {
  const errors: string[] = [];

  if (!agents || typeof agents !== 'object') {
    errors.push('Invalid agents structure');
    return errors;
  }

  // Check for proper agent structure
  for (const [agentName, agentConfig] of Object.entries(agents)) {
    if (typeof agentConfig !== 'object' || agentConfig === null) {
      errors.push(`Agent ${agentName} has invalid configuration structure`);
      continue;
    }

    // Required properties for each agent
    const requiredProps = ['mode', 'model'];
    for (const prop of requiredProps) {
      if (!(prop in agentConfig)) {
        errors.push(`Agent ${agentName} missing required property: ${prop}`);
      }
    }

    // Validate agent modes
    if ('mode' in agentConfig) {
      const validModes = ['primary', 'subagent'];
      const modeValue = (agentConfig as Record<string, unknown>).mode;
      if (typeof modeValue === 'string' && !validModes.includes(modeValue)) {
        errors.push(`Agent ${agentName} has invalid mode: ${modeValue}`);
      }
    }

    // Validate steps if present
    if ('steps' in agentConfig && typeof agentConfig.steps !== 'number') {
      errors.push(`Agent ${agentName} steps must be a number`);
    }
  }

  return errors;
}

// Validate stack-critical configurations
function validateStackCritical(config: Record<string, unknown>): string[] {
  const errors: string[] = [];

  // Check if we have a centralized OR agent-based configuration
  const hasCentralizedConfig = 'compaction' in config || 'model' in config || 'tools' in config;
  const hasAgentConfig = 'agent' in config && config.agent && typeof config.agent === 'object';

  if (!hasCentralizedConfig && !hasAgentConfig) {
    errors.push(
      'CRITICAL: No valid OpenCode configuration found - missing both centralized and agent configs',
    );
    return errors;
  }

  // 1. Validate centralized configurations if present
  if ('compaction' in config) {
    if (config.compaction && typeof config.compaction === 'object') {
      const compaction = config.compaction as Record<string, unknown>;
      if (compaction.auto !== true) {
        errors.push('WARN: compaction.auto should be true for token optimization');
      }
      // keep.tokens is optional in latest OpenCode but recommended
    }
  } else if (hasAgentConfig) {
    // Check if any agent has proper compaction settings
    errors.push('INFO: Centralized compaction missing, using agent-level compaction');
  }

  // 2. Ensure model is set somewhere
  if (!('model' in config)) {
    // Check if any agent has model configured
    if (hasAgentConfig) {
      const agents = config.agent as Record<string, unknown>;
      let hasModel = false;
      for (const agentConfig of Object.values(agents)) {
        if (agentConfig && typeof agentConfig === 'object') {
          const agent = agentConfig as Record<string, unknown>;
          if ('model' in agent) {
            hasModel = true;
            break;
          }
        }
      }
      if (!hasModel) {
        errors.push('CRITICAL: No model configured in any agent');
      }
    } else {
      errors.push('CRITICAL: model property missing - required for stack operation');
    }
  }

  // 3. Ensure tools are enabled for automation
  if ('tools' in config && config.tools && typeof config.tools === 'object') {
    const tools = config.tools as Record<string, unknown>;
    // Verify essential tools are enabled for Gabriel's workflow
    const essentialTools = ['bash', 'readFile', 'writeFile', 'editFile', 'listFiles'];
    for (const tool of essentialTools) {
      if (typeof tools[tool] !== 'boolean') {
        errors.push(`WARN: tools.${tool} should be explicitly set (true/false)`);
      } else if (tools[tool] !== true) {
        errors.push(`CRITICAL: tools.${tool} must be true for Gabriel's automation pipeline`);
      }
    }
  } else if (hasAgentConfig) {
    // Agent-based tools configuration may be in permission blocks
    errors.push('INFO: Centralized tools config missing, using agent-level permissions');
  }

  // 4. Check for critical Gabriel-specific configurations
  if (hasAgentConfig) {
    const agents = config.agent as Record<string, unknown>;

    // Must have orchestrator agent
    if (!('orchestrator' in agents)) {
      errors.push('CRITICAL: orchestrator agent missing - required for Gentle-Vanguard stack');
    } else {
      const orchestrator = agents.orchestrator as Record<string, unknown>;

      // Check orchestrator has minimum required properties
      if (!('model' in orchestrator)) {
        errors.push('CRITICAL: orchestrator.model missing');
      }
      if (!('steps' in orchestrator) || typeof orchestrator.steps !== 'number') {
        errors.push('CRITICAL: orchestrator.steps missing or invalid');
      }
      if (!('mode' in orchestrator) || orchestrator.mode !== 'primary') {
        errors.push('CRITICAL: orchestrator must have mode:primary');
      }
    }

    // Must have key subagents for SDD workflow
    const requiredSubagents = ['sdd-explore', 'sdd-design', 'sdd-apply', 'sdd-verify'];
    for (const agentName of requiredSubagents) {
      if (!(agentName in agents)) {
        errors.push(`WARN: ${agentName} missing - SDD workflow incomplete`);
      }
    }
  }

  // 5. Check watcher configuration for performance
  if ('watcher' in config) {
    if (config.watcher && typeof config.watcher === 'object') {
      const watcher = config.watcher as Record<string, unknown>;
      if (!('ignore' in watcher) || !Array.isArray(watcher.ignore)) {
        errors.push('WARN: watcher.ignore missing - performance may be impacted');
      }
    }
  }

  return errors;
}

function validateMCP(mcp: unknown): string[] {
  const errors: string[] = [];

  if (!mcp || typeof mcp !== 'object') {
    return ['Invalid MCP structure'];
  }

  for (const [name, service] of Object.entries(mcp)) {
    if (typeof service !== 'object' || service === null) {
      errors.push(`MCP service ${name} has invalid configuration`);
      continue;
    }

    // Required properties for MCP services
    const requiredProps = ['type'];
    for (const prop of requiredProps) {
      if (!(prop in service)) {
        errors.push(`MCP service ${name} missing required property: ${prop}`);
      }
    }

    // Validate service types
    if ('type' in service) {
      const validTypes = ['local', 'stdio'];
      const typeValue = (service as Record<string, unknown>).type;
      if (typeof typeValue === 'string' && !validTypes.includes(typeValue)) {
        errors.push(`MCP service ${name} has invalid type: ${typeValue}`);
      }
    }
  }

  return errors;
}

function validatePermissions(permissions: unknown): string[] {
  const errors: string[] = [];

  if (!permissions || typeof permissions !== 'object') {
    return ['Invalid permissions structure'];
  }

  // Validate permission structure - allow flexible nested structures
  for (const [perm, value] of Object.entries(permissions)) {
    // Skip validation of complex permission structures like bash and task
    // These can have nested objects with wildcard patterns
    if (perm === 'bash' || perm === 'task') {
      continue;
    }

    // For simple permissions, ensure they're valid
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      // If it's an object but not one we specifically allow, check if it has valid sub-properties
      const validSimpleProps = ['websearch', 'webfetch', 'task', 'read', 'glob', 'grep'];
      if (!validSimpleProps.some((p) => p in value)) {
        // Allow more complex structures for now, we'll trust the config structure
        // We're mainly validating top-level structural errors
        continue;
      }
    }
  }

  return errors;
}

interface ProviderDef {
  npm?: string;
  options?: { apiKey?: string; headers?: Record<string, string> };
  models?: Record<string, { npm?: string } & Record<string, unknown>>;
}

/**
 * Validate provider configuration against known SDK anti-patterns.
 *
 * Anti-patterns detected (learned from opencode.json 2026-09-06 incident):
 *  - npm override on a model that differs from the provider's npm.
 *    The OpenAI SDK and OpenAI-compatible SDK build different request payloads.
 *    Mixing them in the same provider causes "Internal server error" with no useful code.
 *    See: muse-spark-1.2-contributor-free in opencode-zen-A/B (the override `npm: "@ai-sdk/openai"`
 *    while parent used `@ai-sdk/openai-compatible`).
 *  - Model name suffix `-contributor-free` (or any variant of `contributor-free`) on a
 *    provider whose parent npm is `openai-compatible`. This is a smell, not a hard rule.
 *  - Empty apiKey in provider.options AND no auth.json entry. Means provider will reject
 *    every request silently.
 */
function validateProviders(
  providers: Record<string, ProviderDef> | undefined,
  disabled: string[] | undefined,
): string[] {
  const errors: string[] = [];
  if (!providers) return errors;

  const disabledSet = new Set(disabled || []);

  for (const [id, p] of Object.entries(providers)) {
    if (disabledSet.has(id)) continue;
    if (!p) continue;

    const parentNpm = p.npm;

    if (p.models) {
      for (const [modelId, modelDef] of Object.entries(p.models)) {
        if (!modelDef || typeof modelDef !== 'object') continue;

        // Anti-pattern 1: model-level npm override that differs from provider npm
        if (modelDef.npm && modelDef.npm !== parentNpm) {
          errors.push(
            `WARN: provider.${id}.models.${modelId}.npm = "${modelDef.npm}" differs from parent npm "${parentNpm}". ` +
            `Mixing @ai-sdk/openai and @ai-sdk/openai-compatible in the same provider causes "Internal server error" ` +
            `with no useful diagnostic. Remove the override or remove the model.`,
          );
        }

        // Anti-pattern 2: contributor-free models on openai-compatible parents are
        // historically a smell. Not a hard rule but worth flagging.
        if (
          parentNpm === '@ai-sdk/openai-compatible' &&
          /contributor-free$/.test(modelId)
        ) {
          errors.push(
            `INFO: provider.${id}.models.${modelId} matches "contributor-free" pattern under an openai-compatible parent. ` +
            `If you see "Internal server error" on this model, the model is broken by config, not by upstream.`,
          );
        }
      }
    }

    // Anti-pattern 3: provider has no usable auth (no apiKey in options, no auth.json lookup here)
    if (!p.options?.apiKey) {
      const headers = p.options?.headers || {};
      const hasAuthHeader = Boolean(
        headers.Authorization || headers.authorization ||
        headers['x-api-key'] || headers['X-Api-Key'],
      );
      if (!hasAuthHeader) {
        // Note: we can't check auth.json here without a path; just flag if there's clearly no auth source in config.
        errors.push(
          `INFO: provider.${id} has no apiKey, no Authorization header, no x-api-key header. ` +
          `It must have an entry in auth.json (managed by opencode auth login or oc-keyring).`,
        );
      }
    }
  }

  return errors;
}

function main(): void {
  const args = process.argv.slice(2);
  const configPath = resolve(
    args.includes('--config') ? args[args.indexOf('--config') + 1] : 'opencode.json',
  );
  const fix = args.includes('--fix') || args.includes('-Fix');

  // Handle timeout if specified
  const timeoutIndex = args.indexOf('--timeout');
  if (timeoutIndex !== -1 && timeoutIndex + 1 < args.length) {
    const timeoutMs = parseInt(args[timeoutIndex + 1], 10);
    if (timeoutMs > 0) {
      setTimeout(() => {
        console.error('ERROR: Validation timeout exceeded');
        process.exit(2);
      }, timeoutMs);
    }
  }

  if (!existsSync(configPath)) {
    console.error(`ERROR: ${configPath} not found`);
    process.exit(1);
  }

  const raw = readFileSync(configPath, 'utf-8');
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    console.error('ERROR: opencode.json is not valid JSON');
    console.error(error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }

  // Check top-level properties
  const unknown = Object.keys(config).filter((k) => !VALID_PROPS.has(k));

  // Collect errors
  const errors: string[] = [];

  if (unknown.length > 0) {
    console.log(`FAIL: opencode.json contiene propiedades NO reconocidas por OpenCode:`);
    for (const u of unknown) {
      console.log(`  - ${u}`);
    }
    console.log('');
    console.log('OpenCode rechaza propiedades desconocidas al iniciar. Mover a config/ separado.');
    errors.push('Unrecognized top-level properties');
  }

  // Validate agents structure if present
  if ('agent' in config) {
    const agentErrors = validateAgents(config.agent);
    errors.push(...agentErrors);
    if (agentErrors.length > 0) {
      console.log('Agent validation errors:');
      for (const error of agentErrors) {
        console.log(`  - ${error}`);
      }
    }
  }

  // Validate MCP structure if present
  if ('mcp' in config) {
    const mcpErrors = validateMCP(config.mcp);
    errors.push(...mcpErrors);
    if (mcpErrors.length > 0) {
      console.log('MCP validation errors:');
      for (const error of mcpErrors) {
        console.log(`  - ${error}`);
      }
    }
  }

  // Validate permissions if present
  if ('permission' in config) {
    const permErrors = validatePermissions(config.permission);
    errors.push(...permErrors);
    if (permErrors.length > 0) {
      console.log('Permission validation errors:');
      for (const error of permErrors) {
        console.log(`  - ${error}`);
      }
    }
  }

  // Validate provider SDK anti-patterns (npm overrides, missing auth, etc.)
  if ('provider' in config) {
    const providers = config.provider as Record<string, ProviderDef>;
    const disabled = (config.disabled_providers as string[] | undefined) || [];
    const providerErrors = validateProviders(providers, disabled);
    // Only push WARN/ERROR to errors (INFO is informational, doesn't fail validation)
    const blockingErrors = providerErrors.filter((e) => !e.startsWith('INFO:'));
    errors.push(...blockingErrors);
    if (providerErrors.length > 0) {
      console.log('Provider validation:');
      for (const error of providerErrors) {
        const tag = error.startsWith('WARN:') ? '⚠️ ' : error.startsWith('INFO:') ? 'ℹ️  ' : '❌ ';
        console.log(`  ${tag}${error}`);
      }
    }
  }

  // Validate stack-critical configurations
  const stackErrors = validateStackCritical(config);
  errors.push(...stackErrors);
  if (stackErrors.length > 0) {
    console.log('\n🚨 STACK-CRITICAL VALIDATION ERRORS 🚨');
    console.log('The following issues would break Gentle-Vanguard stack operation:');
    for (const error of stackErrors) {
      console.log(`  - ${error}`);
    }
    console.log('\n⚠️  DO NOT commit these changes - they will break the stack!');
  }

  if (errors.length > 0) {
    if (fix) {
      console.log('Attempting to fix configuration...');

      // Only fix unknown properties, NOT stack-critical errors
      if (unknown.length > 0 && stackErrors.length === 0) {
        // Basic cleanup: remove lines with unknown properties
        const lines = raw.split('\n');
        const filtered = lines.filter((line) => {
          const trimmed = line.trim();
          return !unknown.some((u) => trimmed.startsWith(`"${u}"`));
        });

        writeFileSync(configPath, filtered.join('\n'), 'utf-8');
        console.log(`FIXED: Removed unknown properties from ${configPath}`);
        console.log('Verification required - please review the changes carefully.');
      } else {
        if (stackErrors.length > 0) {
          console.log('🚨 CANNOT AUTO-FIX: Stack-critical errors detected');
          console.log('   These issues require manual review:');
          for (const error of stackErrors.filter((e) => e.startsWith('CRITICAL:'))) {
            console.log(`   ${error}`);
          }
        } else {
          console.log('No fixable issues found.');
        }
      }
    } else {
      console.log('\n🚨 Configuration validation incomplete. Stack may break.');
      console.log('   Fix issues before committing to prevent operational failures.');
    }

    process.exit(1);
  } else {
    // Check for stack-critical configurations even if no errors
    const stackErrors = validateStackCritical(config);
    const criticalErrors = stackErrors.filter((e) => e.startsWith('CRITICAL:'));

    if (criticalErrors.length > 0) {
      console.log(
        '\n🚨 STACK-CRITICAL VALIDATION ERRORS (structure ok, but critical config missing) 🚨',
      );
      for (const error of criticalErrors) {
        console.log(`  - ${error}`);
      }
      console.log('\n⚠️  Stack will not operate correctly without these configurations.');
      process.exit(1);
    } else if (stackErrors.length > 0) {
      console.log('\n⚠️  Stack warnings (functionality may be suboptimal):');
      for (const error of stackErrors) {
        console.log(`  - ${error}`);
      }
      console.log(
        'PASS: opencode.json contiene solo propiedades válidas y tiene estructura correcta',
      );
      process.exit(0);
    } else {
      console.log(
        '✅ PASS: opencode.json es válido para OpenCode y contiene todas las configuraciones críticas para Gentle-Vanguard',
      );
      process.exit(0);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
