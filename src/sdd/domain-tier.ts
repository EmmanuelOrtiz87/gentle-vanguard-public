#!/usr/bin/env node
/**
 * Domain Tier — M6 quality-tier resolver for business agents.
 *
 * Reads config/model-router.json `domainTiering` section and resolves the
 * quality tier (premium | balanced | fastCheap) for a given domain, along
 * with its temperature and hallucination guard. Formalizes the per-domain
 * risk policy: finance/legal/gov are correctness-critical (premium), while
 * creative/analytical domains sit at balanced and deterministic governance
 * at fastCheap.
 *
 * Usage:
 *   npx tsx src/sdd/domain-tier.ts --domain finance     # { tier: 'premium', ... }
 *   npx tsx src/sdd/domain-tier.ts --list               # all tiers
 *   npx tsx src/sdd/domain-tier.ts --agent finance-agent # resolve from agent name
 *
 * Import:
 *   import { getDomainTier, resolveAgentTier } from './domain-tier.js';
 */

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

const ROOT = resolve(process.cwd());
const MODEL_ROUTER = join(ROOT, 'config', 'model-router.json');

export interface DomainTierConfig {
  description?: string;
  tiers: Record<
    string,
    {
      domains: string[];
      temperature: number;
      hallucinationGuard: string;
      rationale?: string;
    }
  >;
  defaultTier: string;
}

interface ResolvedTier {
  tier: string;
  temperature: number;
  hallucinationGuard: string;
  rationale?: string;
}

/**
 * Load the domainTiering section from config/model-router.json.
 * Falls back to a safe default (balanced, 0.3, medium) if missing.
 */
export function loadDomainTiering(): DomainTierConfig | null {
  try {
    if (!existsSync(MODEL_ROUTER)) return null;
    const raw = JSON.parse(readFileSync(MODEL_ROUTER, 'utf-8')) as {
      domainTiering?: DomainTierConfig;
    };
    return raw.domainTiering || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the tier for a domain (e.g. 'finance', 'mkt', 'gitflow').
 * Falls back to defaultTier when no tier lists the domain.
 */
export function getDomainTier(domain: string): ResolvedTier {
  const cfg = loadDomainTiering();
  if (!cfg) {
    return { tier: 'balanced', temperature: 0.3, hallucinationGuard: 'medium' };
  }

  const key = domain.toLowerCase();
  for (const [tierName, tier] of Object.entries(cfg.tiers)) {
    if (tier.domains.some((d) => d.toLowerCase() === key)) {
      return {
        tier: tierName,
        temperature: tier.temperature,
        hallucinationGuard: tier.hallucinationGuard,
        rationale: tier.rationale,
      };
    }
  }

  const fallback = cfg.tiers[cfg.defaultTier];
  return {
    tier: cfg.defaultTier,
    temperature: fallback?.temperature ?? 0.3,
    hallucinationGuard: fallback?.hallucinationGuard ?? 'medium',
    rationale: fallback?.rationale,
  };
}

/**
 * Resolve tier from an agent id (e.g. 'finance-agent' -> 'finance').
 * Strips a trailing '-agent' suffix and resolves the base domain name.
 */
export function resolveAgentTier(agentId: string): ResolvedTier {
  const base = agentId.replace(/-agent$/, '').toLowerCase();
  return getDomainTier(base);
}

function parseArgs(argv: string[]): { domain: string; agent: string; list: boolean } {
  const args = { domain: '', agent: '', list: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--domain' && argv[i + 1]) args.domain = argv[++i];
    else if (argv[i] === '--agent' && argv[i + 1]) args.agent = argv[++i];
    else if (argv[i] === '--list') args.list = true;
  }
  return args;
}

function main(): void {
  const { domain, agent, list } = parseArgs(process.argv);

  if (list) {
    const cfg = loadDomainTiering();
    if (!cfg) {
      console.log('No domainTiering section in config/model-router.json');
      return;
    }
    console.log('=== Domain Tiers (M6) ===');
    console.log(`Default tier: ${cfg.defaultTier}`);
    for (const [tierName, tier] of Object.entries(cfg.tiers)) {
      console.log(`\n[${tierName}] temp=${tier.temperature} guard=${tier.hallucinationGuard}`);
      console.log(`  domains: ${tier.domains.join(', ')}`);
      if (tier.rationale) console.log(`  why: ${tier.rationale}`);
    }
    return;
  }

  if (agent) {
    console.log(JSON.stringify({ agent, ...resolveAgentTier(agent) }, null, 2));
    return;
  }

  if (domain) {
    console.log(JSON.stringify({ domain, ...getDomainTier(domain) }, null, 2));
    return;
  }

  console.log('Usage: --domain <domain> | --agent <agent-id> | --list');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
