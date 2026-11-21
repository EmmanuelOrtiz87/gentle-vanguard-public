#!/usr/bin/env node
/**
 * Recommend Agent — Auto-reassignment bridge for the orchestrator.
 *
 * Consults the adaptive routing table (.session/routing/routing-table.json),
 * built by src/orchestration/adaptive-router.ts from historical execution data, and returns
 * the best agent for a task domain. Enables AUTOMATIC reassignment based on
 * learned performance instead of static/manual routing.
 *
 * Usage:
 *   npx tsx src/orchestration/recommend-agent.ts --domain "code-review"
 *   npx tsx src/orchestration/recommend-agent.ts --task "fix broken ps1 references" --topn 3
 *   npx tsx src/orchestration/recommend-agent.ts --refresh        # rebuild routing table first
 *   npx tsx src/orchestration/recommend-agent.ts --fallback-check # verify fallback logic
 *
 * Output (JSON): { domain, recommended, confidence, alternatives[], source }
 */

import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { runNpxTsxSync } from '../core/run-command.js';
import { DatabaseManager, DEFAULT_TENANT_ID } from '../database/nexus//manager.js';
import { classifyRisk } from '../rdd/risk-classifier.js';
import { editorialIntent } from './editorial-intent.js';
import { migrationIntent } from './migration-intent.js';
import type { MigrationIntent } from './migration-intent.js';

const ROOT = resolve(process.cwd());
const ROUTING_TABLE = join(ROOT, '.session', 'routing', 'routing-table.json');
const STATIC_MAP: Record<string, string[]> = {
  'code-review': ['sdd-verify', 'gov-agent', 'sdd-apply'],
  'code-apply': ['sdd-apply', 'sdd-design', 'sdd-verify'],
  requirements: ['sdd-explore', 'session-agent', 'knowledge-agent'],
  architecture: ['sdd-design', 'sdd-explore', 'premortem-agent'],
  testing: ['sdd-verify', 'sdd-apply', 'self-diag-agent'],
  // E2E real (NORM-E2E-001): el helper nativo ejecuta el smoke con evidencia.
  e2e: ['e2e-agent', 'sdd-verify', 'self-diag-agent'],
  docs: ['doc-agent', 'technical-writer', 'knowledge-agent'],
  ops: ['ops-agent', 'maintenance-agent', 'self-diag-agent'],
  security: ['gov-agent', 'legal-agent', 'premortem-agent'],
  governance: ['gov-agent', 'legal-agent', 'doc-agent'],
  session: ['session-agent', 'maintenance-agent', 'sdd-verify'],
  // Business domains (native agents — cold-start map)
  marketing: ['mkt-agent', 'sales-agent', 'bus-tele-agent'],
  design: ['mkt-agent', 'doc-agent', 'sdd-design'], // visual/decks/brand → deliverable producers
  sales: ['sales-agent', 'mkt-agent', 'finance-agent'],
  finance: ['finance-agent', 'bus-tele-agent', 'sales-agent'],
  legal: ['legal-agent', 'gov-agent', 'doc-agent'],
  hr: ['hr-agent', 'finance-agent', 'legal-agent'],
  'business-telemetry': ['bus-tele-agent', 'finance-agent', 'sia-agent'],
  gitflow: ['gitflow-agent', 'ops-agent', 'self-diag-agent'],
  sia: ['sia-agent', 'knowledge-agent', 'session-agent'],
  general: ['sdd-apply', 'explore', 'general'],
};

interface RoutingTable {
  domainEntries?: Array<{
    domain: string;
    bestAgent: string;
    alternatives?: Array<{ agentId: string; successRate: number }>;
    confidence: number;
    lastRouted?: string | null;
  }>;
  overrides?: Array<{
    domainPattern: string;
    targetAgent: string;
    confidence: number;
    appliedAt?: string;
  }>;
}

export interface NexusRoutingSource {
  getEnabledRoutingRules(tenantId: string): Array<{
    pattern: string;
    target: string;
    priority: number;
    hitCount: number;
    successRate: number;
  }>;
}

/**
 * Agentes que el delegador puede resolver de verdad (config/agents.json).
 * ADR-0034: skill names y agent names viven en namespaces separados — una regla
 * de Nexus cuyo target no es un agente registrado (p. ej. un nombre de skill
 * sembrado por datos viejos) NO es un routing válido y se ignora. Caché de una
 * lectura: el registro no cambia dentro de un proceso.
 */
let registeredAgentCache: Set<string> | null | undefined;
/** null = sin canon en el entorno (fixtures/cwd temporal): no se filtra — no se
 *  puede enforzar un canon que no existe. */
function registeredAgents(): Set<string> | null {
  if (registeredAgentCache !== undefined) return registeredAgentCache;
  try {
    const raw = readFileSync(join(process.cwd(), 'config', 'agents.json'), 'utf-8');
    const config = JSON.parse(raw) as { agents?: Record<string, unknown> };
    registeredAgentCache = new Set(Object.keys(config.agents ?? {}));
  } catch {
    registeredAgentCache = null;
  }
  return registeredAgentCache;
}

function isRoutableTarget(canon: Set<string> | null | undefined, target: string): boolean {
  return canon === null || canon === undefined || canon.has(target);
}

function loadRoutingTable(): RoutingTable | null {
  try {
    if (!existsSync(ROUTING_TABLE)) return null;
    return JSON.parse(readFileSync(ROUTING_TABLE, 'utf-8')) as RoutingTable;
  } catch {
    return null;
  }
}

/**
 * Escape regex special chars in a keyword.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Keyword matching with false-positive protection.
 * - Keywords <= 3 chars match as WHOLE WORDS only (prevents 'pr' matching
 *   "product", or 'doc' matching "docker").
 * - Longer keywords match as substring OR whole word (covers stems like
 *   "analy" -> analyze/analysis and full words like "campaign").
 */
/**
 * Quita diacríticos (GB-20261120): el owner trabaja en español y las keywords
 * del mapa son ASCII — "métricas" sin de-acento no contiene 'metric', y el
 * routing caía a general. Se aplica a tareas Y keywords ('diseñ'→'disen'
 * matchea 'disenar' de-acentuada).
 */
function deaccent(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

function taskHasKeyword(normalized: string, kw: string): boolean {
  const key = deaccent(kw.toLowerCase());
  if (key.length <= 3) {
    return new RegExp(`\\b${escapeRegExp(key)}\\b`).test(normalized);
  }
  return normalized.includes(key) || new RegExp(`\\b${escapeRegExp(key)}\\b`).test(normalized);
}

function matchDomain(task: string, domainHint: string): string {
  const normalized = deaccent(task.toLowerCase());
  // ORDER IS CRITICAL: business keywords come FIRST because they are more
  // specific than generic engineering verbs. Without this, "review this
  // contract" hits 'review'→code-review before 'contract'→legal, and
  // "analyze conversion metrics" hits 'analy'→requirements before
  // 'metric'→business-telemetry.
  const pairs: Array<[string, string]> = [
    // ── Tech compounds (van PRIMEROS: 'pipeline' solo es ventas, pero
    // 'ci/cd pipeline' es infraestructura — sin este bloque, "configurar
    // CI/CD pipeline" caía en sales por precedencia de orden) ──────────────
    ['ci/cd', 'ops'],
    ['deployment pipeline', 'ops'],
    ['pipeline de despliegue', 'ops'],
    ['pipeline de ci', 'ops'],
    // ES (GB-20261120): revisión de código es más específica que 'pull'/'merge'
    // → gitflow; sin esto, "revisar el código de este pull request" caía en gitflow.
    ['revisar el codigo', 'code-review'],
    ['revision de codigo', 'code-review'],
    ['revisar codigo', 'code-review'],
    // ── Business domains (native agents, highest specificity) ──────────────
    // marketing
    ['campaign', 'marketing'],
    ['marketing', 'marketing'],
    ['social media', 'marketing'],
    ['landing', 'marketing'],
    ['content', 'marketing'],
    ['blog', 'marketing'],
    ['advertis', 'marketing'],
    ['seo', 'marketing'],
    ['brand', 'marketing'],
    // sales
    ['pipeline', 'sales'],
    ['prospect', 'sales'],
    ['quote', 'sales'],
    ['sales', 'sales'],
    ['deal', 'sales'],
    ['lead generation', 'sales'],
    ['propuesta comercial', 'sales'],
    ['cotizacion', 'sales'],
    // finance
    ['revenue', 'finance'],
    ['forecast', 'finance'],
    ['financ', 'finance'],
    ['budget', 'finance'],
    ['margin', 'finance'],
    ['churn', 'finance'],
    ['investor', 'finance'],
    ['costs', 'finance'],
    ['pricing', 'finance'],
    ['expense', 'finance'],
    // legal
    ['gdpr', 'legal'],
    ['legal', 'legal'],
    ['contract', 'legal'],
    ['contrato', 'legal'],
    ['clausula', 'legal'],
    ['firmar', 'legal'],
    ['liability', 'legal'],
    ['compliance', 'governance'],
    ['regulation', 'legal'],
    // hr
    ['hire', 'hr'],
    ['hiring', 'hr'],
    ['recruit', 'hr'],
    ['job', 'hr'],
    ['interview', 'hr'],
    ['candidate', 'hr'],
    ['onboarding', 'hr'],
    ['entrevista', 'hr'],
    ['candidato', 'hr'],
    ['contratacion', 'hr'],
    // business-telemetry
    ['metric', 'business-telemetry'],
    ['metrica', 'business-telemetry'],
    ['indicador', 'business-telemetry'],
    ['telemetry', 'business-telemetry'],
    ['analytics', 'business-telemetry'],
    ['kpi', 'business-telemetry'],
    ['conversion', 'business-telemetry'],
    ['business intelligence', 'business-telemetry'],
    // gitflow
    ['branch', 'gitflow'],
    ['commit', 'gitflow'],
    ['pull', 'gitflow'],
    ['merge', 'gitflow'],
    ['rebase', 'gitflow'],
    ['pr ', 'gitflow'],
    ['git', 'gitflow'],
    ['ramas', 'gitflow'],
    // sia
    ['iteration', 'sia'],
    ['score', 'sia'],
    ['refine', 'sia'],
    ['leccion', 'sia'],
    // ── Absorbed cybersecurity domains (ADR-010, high specificity) ───────────
    // Compliance & risk frameworks → governance
    ['nist', 'governance'],
    ['iso 27001', 'governance'],
    ['cmmc', 'governance'],
    ['cyber risk', 'governance'],
    ['risk assessment', 'governance'],
    ['mitre', 'governance'],
    ['c2pa', 'governance'],
    ['provenance', 'governance'],
    // AI/LLM security → security
    ['prompt injection', 'security'],
    ['llm security', 'security'],
    ['jailbreak', 'security'],
    ['garak', 'security'],
    ['promptfoo', 'security'],
    ['guardrail', 'security'],
    ['rag injection', 'security'],
    ['system prompt', 'security'],
    ['mcp server', 'security'],
    ['tool poisoning', 'security'],
    ['agentic', 'security'],
    // Supply chain / SBOM / secrets → security
    ['sbom', 'security'],
    ['supply chain', 'security'],
    ['dependency confusion', 'security'],
    ['secret', 'security'],
    ['secrets', 'security'],
    ['gitleaks', 'security'],
    ['api key', 'security'],
    // API security → security (before generic 'secur')
    ['api security', 'security'],
    ['owasp', 'security'],
    ['websocket', 'security'],
    ['api inventory', 'security'],
    // ── Engineering domains (generic verbs, lower specificity) ──────────────
    // Engineering quality (sdd-apply) — BEFORE 'test' so "debug the failing
    // test" routes to code-apply, not testing.
    ['debug', 'code-apply'],
    ['bug', 'code-apply'],
    ['performance', 'code-apply'],
    ['review', 'code-review'],
    ['refactor', 'code-apply'],
    ['implement', 'code-apply'],
    // Requirements ANTES de 'feature': "explorar requisitos de un feature"
    // es BA, no dev (el orden es la precedencia — bug real del routing).
    ['requirement', 'requirements'],
    ['requisito', 'requirements'],
    ['explora', 'requirements'],
    ['analy', 'requirements'],
    ['architect', 'architecture'],
    ['arquitectur', 'architecture'],
    ['design', 'architecture'],
    ['diseñ', 'architecture'],
    // ── E2E real (NORM-E2E-001): más específico que 'test' genérico — va antes
    // para que "run e2e de gv-agenda" no caiga en testing/sdd-verify ──────────
    ['e2e', 'e2e'],
    ['end-to-end', 'e2e'],
    ['smoke', 'e2e'],
    ['validacion real', 'e2e'],
    ['homologacion de app', 'e2e'],
    ['test', 'testing'],
    ['prueba', 'testing'],
    ['feature', 'code-apply'],
    ['document', 'docs'],
    ['docs', 'docs'],
    ['readme', 'docs'],
    ['deploy', 'ops'],
    ['despleg', 'ops'],
    ['docker', 'ops'],
    ['infra', 'ops'],
    ['secur', 'security'],
    ['seguridad', 'security'],
    ['audit', 'governance'],
    ['session', 'session'],
    ['roadmap', 'requirements'],
  ];
  if (domainHint) return domainHint;
  for (const [kw, domain] of pairs) {
    if (taskHasKeyword(normalized, kw)) return domain;
  }
  return 'general';
}

/**
 * Resumen de la intent de migración que viaja en la recomendación.
 * El orquestador lo usa para saber qué preguntar antes de delegar.
 */
function migrationSummary(intent: MigrationIntent): Record<string, unknown> {
  return {
    operation: intent.operation,
    area: intent.area,
    client: intent.client,
    system: intent.system,
    missing: intent.missing,
    nextQuestion: intent.nextQuestion,
  };
}

function recommend(
  task: string,
  domainHint: string,
  topN: number,
  options: {
    tenantId?: string;
    nexus?: NexusRoutingSource;
    /** Canon explícito de agentes (tests inyectan sus targets sintéticos; el
     *  default lee config/agents.json — ADR-0034). */
    registeredAgents?: Set<string>;
  } = {},
): unknown {
  const normalizedTask = deaccent(task.toLowerCase());
  const editorial = editorialIntent(task);
  const migration = migrationIntent(task);
  // La migración documental ES una ruta editorial. Si el pedido además es una
  // intención editorial (synthesis, draft, ...), gana la editorial: el routing
  // actual no cambia. Solo cuando no hay intención editorial gana la
  // migración, marcada como tal para que el orquestador pregunte lo que falte.
  if (!domainHint && migration && !editorial) {
    return {
      domain: 'editorial',
      recommended: 'editorial-agent',
      confidence: 1,
      alternatives: [],
      source: 'migration-intent',
      migration: migrationSummary(migration),
    };
  }
  if (!domainHint && editorial) {
    return {
      domain: 'editorial',
      recommended: 'editorial-agent',
      confidence: 1,
      alternatives: [],
      source: 'editorial-intent',
    };
  }
  const domain = matchDomain(task, domainHint);
  const tenantId = options.tenantId ?? process.env.GENTLE_VANGUARD_TENANT_ID ?? DEFAULT_TENANT_ID;
  try {
    const nexus = options.nexus ?? DatabaseManager.getInstance();
    const rules = nexus
      .getEnabledRoutingRules(tenantId)
      .filter((rule) =>
        isRoutableTarget(options.registeredAgents ?? registeredAgents(), rule.target),
      )
      .filter(
        (rule) =>
          taskHasKeyword(normalizedTask, rule.pattern.toLowerCase()) ||
          taskHasKeyword(domain.toLowerCase(), rule.pattern.toLowerCase()),
      )
      .sort(
        (a, b) =>
          b.priority - a.priority || b.successRate - a.successRate || b.hitCount - a.hitCount,
      );
    const rule = rules[0];
    if (rule) {
      return {
        domain,
        recommended: rule.target,
        confidence: Math.max(0.3, Math.min(1, rule.successRate / 100)),
        alternatives: rules.slice(1, topN).map((candidate) => candidate.target),
        source: 'nexus',
      };
    }
  } catch {
    // Nexus is an optional runtime source; preserve the legacy fallbacks.
  }
  const table = loadRoutingTable();

  // Decay del aprendizaje (GB-20261120, evals de orquestación): una entrada
  // aprendida SOLO aplica con evidencia fresca (<= decayDays). Medido: las
  // entradas de skills de septiembre (60+ días, confianza 0.9 congelada)
  // sobrescribían el mapa canónico en 9 de 22 casos del dataset de evals.
  // El decay ya estaba declarado (adaptive-router config decayDays: 14); faltaba
  // enforcearlo en el camino de consulta.
  const DECAY_DAYS = 14;
  const isFresh = (iso: string | null | undefined): boolean => {
    if (!iso) return false;
    const ts = Date.parse(iso);
    return Number.isFinite(ts) && Date.now() - ts <= DECAY_DAYS * 86_400_000;
  };

  // 1. Check overrides (highest priority — learned/high-priority routing).
  //    Overrides are matched against the FULL task text, not the derived
  //    domain, so "gdpr compliance audit" hits the gdpr→legal override even
  //    though matchDomain() would classify it as governance.
  if (table?.overrides) {
    for (const o of table.overrides) {
      if (!isFresh(o.appliedAt)) continue; // decay: evidencia vencida no rutea
      if (!isRoutableTarget(options.registeredAgents ?? registeredAgents(), o.targetAgent))
        continue; // ADR-0034: skill-name no rutéa
      const pattern = o.domainPattern.toLowerCase();
      if (
        taskHasKeyword(normalizedTask, pattern) ||
        taskHasKeyword(domain.toLowerCase(), pattern)
      ) {
        return {
          domain,
          recommended: o.targetAgent,
          confidence: o.confidence,
          alternatives: [],
          source: 'override',
        };
      }
    }
  }

  // 2. Check domain entries (learned performance) — solo con evidencia fresca.
  if (table?.domainEntries) {
    const entry = table.domainEntries.find(
      (d) => d.domain.toLowerCase() === domain.toLowerCase() && isFresh(d.lastRouted),
    );
    if (entry && entry.bestAgent) {
      return {
        domain,
        recommended: entry.bestAgent,
        confidence: entry.confidence,
        alternatives: (entry.alternatives || []).map((a) => a.agentId).slice(0, topN - 1),
        source: 'routing-table',
      };
    }
  }

  // 3. Fallback: static map (cold start)
  const candidates = STATIC_MAP[domain] || STATIC_MAP.general;
  return {
    domain,
    recommended: candidates[0],
    confidence: 0.3,
    alternatives: candidates.slice(1, topN),
    source: 'static-fallback',
  };
}

function parseArgs(argv: string[]): {
  task: string;
  domain: string;
  topN: number;
  refresh: boolean;
  riskAware: boolean;
} {
  const args = { task: '', domain: '', topN: 3, refresh: false, riskAware: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--task' && argv[i + 1]) args.task = argv[++i];
    else if (argv[i] === '--domain' && argv[i + 1]) args.domain = argv[++i];
    else if (argv[i] === '--topn' && argv[i + 1]) args.topN = Number(argv[++i]);
    else if (argv[i] === '--refresh') args.refresh = true;
    else if (argv[i] === '--risk-aware') args.riskAware = true;
  }
  return args;
}

/**
 * Risk-aware delegation (absorbido de Gentle-AI v2.7.0 "risk-aware delegation").
 * Clasifica el riesgo del diff actual y decide cuánta verificación merece la
 * tarea delegada:
 *   - low      → delegación directa, sin verificación extra
 *   - standard → 1 lens (sdd-verify)
 *   - high     → 4R review (rdd-4r-review)
 * Solo aplica a dominios de código (code-apply, code-review, testing).
 */
function riskAwareVerification(domain: string): {
  riskTier: string;
  riskScore: number;
  verification: string;
  rationale: string;
} | null {
  const codeDomains = ['code-apply', 'code-review', 'testing', 'general'];
  if (!codeDomains.includes(domain)) return null;
  try {
    const c = classifyRisk(false);
    const tier = c.tier;
    const verification =
      tier === 'high' ? 'rdd-4r-review' : tier === 'standard' ? 'sdd-verify' : 'none';
    return {
      riskTier: tier,
      riskScore: c.score,
      verification,
      rationale: c.rationale,
    };
  } catch {
    return null;
  }
}

function main(): void {
  const { task, domain, topN, refresh, riskAware } = parseArgs(process.argv);

  if (refresh) {
    try {
      runNpxTsxSync('src/orchestration/adaptive-router.ts', ['--build', '--quiet'], {
        cwd: ROOT,
        stdio: 'pipe',
        timeout: 30000,
      });
    } catch {
      // refresh failure is non-blocking
    }
  }

  const result = recommend(task, domain, topN) as Record<string, unknown>;
  if (riskAware) {
    const rv = riskAwareVerification(String(result.domain ?? domain));
    if (rv) {
      result.risk = rv;
    }
  }
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export { recommend };
