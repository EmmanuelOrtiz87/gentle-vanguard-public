#!/usr/bin/env node
/**
 * owasp-agentic-top10.ts — OWASP Agentic AI Top 10 Compliance Mapping (ADR-0029)
 *
 * Formal mapping of the Gentle-Vanguard stack against the OWASP Agentic AI
 * Top 10 (2025) risk categories, with evidence generation and coverage scoring.
 *
 * Inspired by the Microsoft Agent Governance Toolkit's OWASP Agentic Top 10
 * architecture mapping. This module:
 *
 *   1. Defines the 10 OWASP Agentic AI risk categories.
 *   2. Maps each to the specific GV stack components that provide the control.
 *   3. Generates a compliance report with per-category coverage and evidence.
 *   4. Supports a `--strict` mode that fails CI when coverage is insufficient.
 *
 * The 10 categories of the LLM/GenAI list (OWASP Top 10 for LLM Applications,
 * 2025 edition) — the platform-level risks:
 *   LLM01:2025  Prompt Injection
 *   LLM02:2025  Sensitive Information Disclosure
 *   LLM03:2025  Supply Chain
 *   LLM04:2025  Data and Model Poisoning
 *   LLM05:2025  Improper Output Handling
 *   LLM06:2025  Excessive Agency
 *   LLM07:2025  System Prompt Leakage
 *   LLM08:2025  Vector and Embedding Weaknesses
 *   LLM09:2025  Misinformation
 *   LLM10:2025  Unbounded Consumption
 *
 * AND the 10 categories of the agentic list (OWASP Top 10 for Agentic
 * Applications, 2026 edition, published 2025-12-09) — the risks that only
 * exist when the system acts autonomously: ASI01..ASI10 (see
 * `buildAgenticMapping`). Both are current canons; `--agentic` selects the
 * second one.
 *
 * Usage (CLI):
 *   npx tsx src/security/owasp/owasp-agentic-top10.ts report
 *   npx tsx src/security/owasp/owasp-agentic-top10.ts report --strict
 *   npx tsx src/security/owasp/owasp-agentic-top10.ts report --agentic --strict
 *   npx tsx src/security/owasp/owasp-agentic-top10.ts verify --evidence ./owasp-evidence.json
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CoverageLevel = 'full' | 'partial' | 'none';

export interface OwaspCategory {
  id: string;
  title: string;
  description: string;
  /** GV stack components that provide the control. */
  controls: string[];
  /** Coverage level achieved by the current stack. */
  coverage: CoverageLevel;
  /** Evidence: paths/commands that demonstrate the control. */
  evidence: string[];
  /** Gap: what's missing for full coverage. */
  gap?: string;
}

export interface OwaspReport {
  generatedAt: string;
  totalCategories: number;
  fullCoverage: number;
  partialCoverage: number;
  noneCoverage: number;
  overallCoverage: number; // 0-100
  categories: OwaspCategory[];
  strictPass: boolean;
}

// ---------------------------------------------------------------------------
// OWASP Agentic AI Top 10 mapping
// ---------------------------------------------------------------------------

export function buildOwaspMapping(): OwaspCategory[] {
  return [
    {
      id: 'LLM01:2025',
      title: 'Prompt Injection',
      description:
        'Manipulation of LLM inputs to override instructions or access unauthorized data.',
      controls: [
        'src/security/prompt-injection-guard.ts',
        'src/security/guardrails/input-moderation.ts',
        'src/security/policy-engine/policy-engine.ts',
        'src/mcp/security-gateway/mcp-security-gateway.ts',
      ],
      coverage: 'full',
      evidence: [
        'prompt-injection-guard.ts — heuristic + pattern detection',
        'input-moderation.ts — jailbreak rail (F3.2)',
        'policy-engine.ts — deterministic fail-closed tool gating',
        'mcp-security-gateway.ts — hidden instruction scanning',
      ],
    },
    {
      id: 'LLM02:2025',
      title: 'Sensitive Information Disclosure',
      description: 'LLM outputs leaking sensitive data (PII, credentials, internal data).',
      controls: [
        'src/security/privacy-gateway.ts',
        'src/security/secret-scanner/scanner.ts',
        'src/security/guardrails/output-moderation.ts',
      ],
      coverage: 'full',
      evidence: [
        'privacy-gateway.ts — PII sanitization',
        'secret-scanner.ts — 80+ credential patterns',
        'output-moderation.ts — output rail',
      ],
    },
    {
      id: 'LLM03:2025',
      title: 'Supply Chain',
      description: 'Vulnerabilities in third-party components, models, or data sources.',
      controls: [
        'src/security/dependency-security-checker.ts',
        'src/security/generate-sbom.ts',
        'src/security/slsa-provenance.ts',
        'src/security/container-scan.ts',
      ],
      coverage: 'full',
      evidence: [
        'dependency-security-checker.ts — vulnerability + license scan',
        'generate-sbom.ts — CycloneDX SBOM',
        'slsa-provenance.ts — SLSA provenance',
        'container-scan.ts — container vulnerability scan',
      ],
    },
    {
      id: 'LLM04:2025',
      title: 'Data and Model Poisoning',
      description: 'Corruption of training data, RAG sources, or fine-tuning data.',
      controls: [
        'src/retrieval/retrieval-grader.ts',
        'src/mcp/security-gateway/mcp-security-gateway.ts',
        'src/security/rag-source-integrity.ts',
      ],
      coverage: 'full',
      evidence: [
        'retrieval-grader.ts — BM25 retrieval grading',
        'mcp-security-gateway.ts — tool poisoning detection',
        'rag-source-integrity.ts — RAG source integrity + provenance chain',
      ],
    },
    {
      id: 'LLM05:2025',
      title: 'Improper Output Handling',
      description: 'LLM output used in unsafe downstream contexts (SQL, shell, HTML).',
      controls: [
        'src/security/guardrails/output-moderation.ts',
        'src/security/policy-engine/policy-engine.ts',
        'src/security/output-encoding.ts',
      ],
      coverage: 'full',
      evidence: [
        'output-moderation.ts — output rail',
        'policy-engine.ts — fail-closed action gating',
        'output-encoding.ts — context-aware encoding (sql/shell/html/htmlAttr/url/json)',
      ],
    },
    {
      id: 'LLM06:2025',
      title: 'Excessive Agency',
      description: 'Agent granted too much autonomy to perform unintended actions.',
      controls: [
        'src/security/policy-engine/policy-engine.ts',
        'src/rdd/rdd-kill-switch.ts',
        'src/security/guardrails/guardrail-orchestrator.ts',
        'src/security/opencode-guards.ts',
      ],
      coverage: 'full',
      evidence: [
        'policy-engine.ts — deterministic action gating',
        'rdd-kill-switch.ts — termination control',
        'guardrail-orchestrator.ts — failure classification + action',
        'opencode-guards.ts — tool allowlist',
      ],
    },
    {
      id: 'LLM07:2025',
      title: 'System Prompt Leakage',
      description: 'Exposure of system prompts, routing logic, or embedded secrets.',
      controls: [
        'src/security/secret-scanner/scanner.ts',
        'src/security/prompt-injection-guard.ts',
        'src/security/system-prompt-redaction.ts',
      ],
      coverage: 'full',
      evidence: [
        'secret-scanner.ts — detects embedded secrets',
        'prompt-injection-guard.ts — detects system prompt reveal attempts',
        'system-prompt-redaction.ts — redaction layer for model responses',
      ],
    },
    {
      id: 'LLM08:2025',
      title: 'Vector and Embedding Weaknesses',
      description: 'Vulnerabilities in vector databases and embedding pipelines.',
      controls: ['src/retrieval/retrieval-grader.ts', 'src/security/embedding-guard.ts'],
      coverage: 'full',
      evidence: [
        'retrieval-grader.ts — BM25 retrieval grading',
        'embedding-guard.ts — embedding-space injection detection + vector store access control',
      ],
    },
    {
      id: 'LLM09:2025',
      title: 'Misinformation',
      description: 'Agent generating false or misleading information presented as fact.',
      controls: [
        'src/retrieval/retrieval-grader.ts',
        'src/review/auto-code-review.ts',
        'src/security/fact-checker.ts',
      ],
      coverage: 'full',
      evidence: [
        'retrieval-grader.ts — retrieval quality grading',
        'auto-code-review.ts — independent verification',
        'fact-checker.ts — claim-source verification (Jaccard overlap)',
      ],
    },
    {
      id: 'LLM10:2025',
      title: 'Unbounded Consumption',
      description: 'Uncontrolled resource consumption (tokens, compute, API calls).',
      controls: [
        'src/tokens/token-budget-guard.ts',
        'config/token-budget-guard.json',
        'src/resilience/circuit-breaker-v2.ts',
      ],
      coverage: 'full',
      evidence: [
        'token-budget-guard.ts — daily/per-session budgets',
        'token-budget-guard.json — límites calibrados desde Nexus (370M diario / 320M sesión; umbral de anomalía)',
        'circuit-breaker-v2.ts — resource protection',
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// OWASP Top 10 for Agentic Applications 2026 (ASI01..ASI10)
// ---------------------------------------------------------------------------
//
// POR QUE EXISTE (2026-11-23, absorcion del canon externo)
//
// El modulo se llama "owasp-agentic-top10" pero hasta ahora cubria la lista
// LLM01..LLM10 (OWASP Top 10 for LLM/GenAI, edicion 2025). El canon vigente
// para sistemas AGENTICOS es otro: **OWASP Top 10 for Agentic Applications
// 2026** (publicado el 9 de diciembre de 2025 por el OWASP GenAI Security
// Project, con mas de 100 expertos), con identificadores ASI.
//
// Covers: ASI01 Agent Goal Hijack, ASI02 Tool Misuse and Exploitation,
// ASI03 Identity and Privilege Abuse, ASI04 Agentic Supply Chain
// Vulnerabilities, ASI05 Unexpected Code Execution (RCE), ASI06 Memory &
// Context Poisoning, ASI07 Insecure Inter-Agent Communication, ASI08
// Cascading Failures, ASI09 Human-Agent Trust Exploitation, ASI10 Rogue
// Agents. Fuente: https://genai.owasp.org/top-10-for-agentic-applications-2026/
//
// Las DOS listas son vigentes y se cubren: la de LLM (plataforma) y la de
// agentic (sistemas autonomos). Lo que NO se hace es renombrar controles que
// no existen: cada `controls` de abajo es un archivo real del repo, verificado
// contra disco.

/**
 * Mapeo de las 10 categorias agentic (2026) a los controles del stack.
 * `coverage` describe el control REAL del stack, no una aspiracion.
 */
export function buildAgenticMapping(): OwaspCategory[] {
  return [
    {
      id: 'ASI01:2026',
      title: 'Agent Goal Hijack',
      description:
        'El objetivo del agente es desviado por un atacante: la instruccion original queda anulada y el agente persigue el objetivo del atacante.',
      controls: [
        'src/security/prompt-injection-guard.ts',
        'src/security/guardrails/input-moderation.ts',
        'src/security/policy-engine/policy-engine.ts',
        'src/security/system-prompt-redaction.ts',
      ],
      coverage: 'full',
      evidence: [
        'prompt-injection-guard.ts — deteccion heuristica + patrones de inyeccion',
        'input-moderation.ts — rail de jailbreak (fail-closed)',
        'policy-engine.ts — gating deterministico de herramientas',
        'system-prompt-redaction.ts — el prompt de sistema no sale hacia fuera',
      ],
    },
    {
      id: 'ASI02:2026',
      title: 'Tool Misuse and Exploitation',
      description:
        'El agente usa herramientas legitimas fuera de su proposito: un permiso concedido se convierte en capacidad indiscriminada.',
      controls: [
        'src/security/policy-engine/policy-engine.ts',
        'src/security/guardrail-orchestrator.ts',
        'src/security/workload-guard.ts',
        'src/mcp/security-gateway/mcp-security-gateway.ts',
      ],
      coverage: 'full',
      evidence: [
        'policy-engine.ts — allowlist de herramientas por politica, fail-closed',
        'guardrail-orchestrator.ts — rails por llamada (F3.x)',
        'workload-guard.ts — techo de trabajo antes de ejecutar',
        'mcp-security-gateway.ts — escaneo de instrucciones ocultas en tools',
      ],
    },
    {
      id: 'ASI03:2026',
      title: 'Identity and Privilege Abuse',
      description:
        'La confianza dinamica y la delegacion se explotan: un agenteActing con la identidad o el privilegio de otro.',
      controls: [
        'src/security/auth-session.ts',
        'src/security/agent-governance-integration.ts',
        'src/ops/agent-reachability.ts',
        'src/security/policy-engine/policy-engine.ts',
      ],
      coverage: 'full',
      evidence: [
        'auth-session.ts — sesiones y verificacion de identidad',
        'agent-governance-integration.ts — gobernanza de identidad de agente',
        'agent-reachability.ts — todo agente del roster es alcanzable y verificable',
        'policy-engine.ts — la delegacion noAmplia privilegios por defecto',
      ],
    },
    {
      id: 'ASI04:2026',
      title: 'Agentic Supply Chain Vulnerabilities',
      description:
        'El riesgo llega por la cadena de suministro: skills, prompts, plugins, MCP servers y dependencias del agente.',
      controls: [
        'src/security/dependency-security-checker.ts',
        'src/security/generate-sbom.ts',
        'src/security/slsa-provenance.ts',
        'src/tools/script-policy-gate.ts',
        'src/security/gateguard-mcp.ts',
      ],
      coverage: 'full',
      evidence: [
        'dependency-security-checker.ts — vulnerabilidades y licencias',
        'generate-sbom.ts — SBOM CycloneDX',
        'slsa-provenance.ts — procedencia SLSA',
        'script-policy-gate.ts — politica de scripts antes de ejecutarse',
        'gateguard-mcp.ts — los servidores MCP declaran y se validan',
      ],
    },
    {
      id: 'ASI05:2026',
      title: 'Unexpected Code Execution (RCE)',
      description:
        'El agente ejecuta codigo no previsto (spawns ocultos, shell sin cotizar, generacion de codigo ejecutable).',
      controls: [
        'src/tools/check-shell-quoting.ts',
        'src/tools/sh-launcher-audit.ts',
        'src/tools/check-process-launchers.ts',
        'src/security/self-mutation-guard.ts',
      ],
      coverage: 'full',
      evidence: [
        'check-shell-quoting.ts — argumentos de shell cotizados y verificados',
        'sh-launcher-audit.ts — audit de lanzadores .sh',
        'check-process-launchers.ts — un solo launcher por proceso',
        'self-mutation-guard.ts — el stack no se reescribe a si mismo sin control',
      ],
    },
    {
      id: 'ASI06:2026',
      title: 'Memory & Context Poisoning',
      description:
        'La informacion almacenada o recuperada (memoria, RAG, notas) queda envenenada y contamina decisiones futuras.',
      controls: [
        'src/security/rag-source-integrity.ts',
        'src/retrieval/retrieval-grader.ts',
        'src/security/embedding-guard.ts',
        'src/security/fact-checker.ts',
      ],
      coverage: 'full',
      evidence: [
        'rag-source-integrity.ts — integridad de las fuentes RAG',
        'retrieval-grader.ts — graduacion de lo recuperado antes de usarlo',
        'embedding-guard.ts — guard sobre embeddings',
        'fact-checker.ts — verificacion de afirmaciones contra evidencia',
      ],
    },
    {
      id: 'ASI07:2026',
      title: 'Insecure Inter-Agent Communication',
      description:
        'Los agentes se comunican por canales que no autentican ni cifran: spoofing, A2A, paso de credenciales.',
      controls: [
        'src/mcp/security-gateway/mcp-security-gateway.ts',
        'src/orchestration/agent-message-bus.ts',
        'src/security/gateguard-mcp.ts',
      ],
      coverage: 'partial',
      evidence: [
        'mcp-security-gateway.ts — validacion de las llamadas MCP',
        'agent-message-bus.ts — bus de mensajes entre agentes con trazabilidad',
        'gateguard-mcp.ts — registro y preflight de servidores MCP',
      ],
    },
    {
      id: 'ASI08:2026',
      title: 'Cascading Failures',
      description:
        'Un fallo puntual (alucinacion, agente caido, tool rota) se propaga en cascada por el sistema agentico.',
      controls: [
        'src/resilience/circuit-breaker-v2.ts',
        'src/resilience/anti-loop-guard.ts',
        'src/core/loop-guard-middleware.ts',
        'src/core/maintenance-watchtower.ts',
      ],
      coverage: 'full',
      evidence: [
        'circuit-breaker-v2.ts — corte de circuito con recuperacion',
        'anti-loop-guard.ts — deteccion de ciclos',
        'loop-guard-middleware.ts — limite de vueltas del orquestador',
        'maintenance-watchtower.ts — 38 checks registrados y autoheal',
      ],
    },
    {
      id: 'ASI09:2026',
      title: 'Human-Agent Trust Exploitation',
      description:
        'Se explota la confianza del humano en el agente: salidas que parecen correctas, acciones autonomas no revisadas.',
      controls: [
        'src/security/guardrails/output-moderation.ts',
        'src/security/agent-governance-integration.ts',
        'src/orchestration/chat-level-enforcer.ts',
        'src/web-presence/approval.ts',
      ],
      coverage: 'full',
      evidence: [
        'output-moderation.ts — rail sobre lo que el agente afirma',
        'agent-governance-integration.ts — niveles de autonomia y escalado al humano',
        'chat-level-enforcer.ts — el nivel de conversacion fija la autonomia',
        'approval.ts — aprobacion explicita antes de publicar',
      ],
    },
    {
      id: 'ASI10:2026',
      title: 'Rogue Agents',
      description:
        'Un agente comprometido o malicioso se desvía de su objetivo y ejecuta acciones fuera de mandato.',
      controls: [
        'src/security/self-mutation-guard.ts',
        'src/security/agent-governance-integration.ts',
        'src/orchestration/auto-escalation.ts',
        'src/ops/agent-reachability.ts',
      ],
      coverage: 'full',
      evidence: [
        'self-mutation-guard.ts — el agente no se reconfigura solo',
        'agent-governance-integration.ts — mandato y limites por rol',
        'auto-escalation.ts — escalado automatico ante desviacion',
        'agent-reachability.ts — el roster es auditable (nadie oculto)',
      ],
    },
  ];
}

/** Reporte de cobertura de la lista agentic (ASI01..ASI10). */
export function generateAgenticReport(strict: boolean): OwaspReport {
  const categories = buildAgenticMapping();
  const full = categories.filter((c) => c.coverage === 'full').length;
  const partial = categories.filter((c) => c.coverage === 'partial').length;
  const none = categories.filter((c) => c.coverage === 'none').length;
  const overall = Math.round(((full * 1 + partial * 0.5 + none * 0) / categories.length) * 100);

  return {
    generatedAt: new Date().toISOString(),
    totalCategories: categories.length,
    fullCoverage: full,
    partialCoverage: partial,
    noneCoverage: none,
    overallCoverage: overall,
    categories,
    strictPass: strict ? overall >= 80 && none === 0 : true,
  };
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

export function generateReport(strict: boolean): OwaspReport {
  const categories = buildOwaspMapping();
  const full = categories.filter((c) => c.coverage === 'full').length;
  const partial = categories.filter((c) => c.coverage === 'partial').length;
  const none = categories.filter((c) => c.coverage === 'none').length;
  const overall = Math.round(((full * 1 + partial * 0.5 + none * 0) / categories.length) * 100);

  return {
    generatedAt: new Date().toISOString(),
    totalCategories: categories.length,
    fullCoverage: full,
    partialCoverage: partial,
    noneCoverage: none,
    overallCoverage: overall,
    categories,
    strictPass: strict ? overall >= 80 && none === 0 : true,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = 'true';
      }
    }
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const cmd = process.argv[2];

  if (cmd === 'report') {
    const strict = args.strict === 'true' || args.strict === '1';
    const agentic = args.agentic === 'true' || args.agentic === '1';
    const report = agentic ? generateAgenticReport(strict) : generateReport(strict);
    const outputPath =
      args.output ??
      join(
        resolve(process.cwd()),
        '.runtime',
        agentic ? 'owasp-agentic-top10-agentic.json' : 'owasp-agentic-top10.json',
      );
    writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
    console.log(
      `OWASP ${agentic ? 'Top 10 for Agentic Applications 2026' : 'Top 10 for LLM Applications 2025'} report written to ${outputPath}`,
    );
    console.log(
      `  Coverage: ${report.overallCoverage}% (${report.fullCoverage} full / ${report.partialCoverage} partial / ${report.noneCoverage} none)`,
    );
    if (strict) {
      console.log(`  Strict mode: ${report.strictPass ? 'PASS' : 'FAIL'}`);
      process.exit(report.strictPass ? 0 : 1);
    }
    return;
  }

  if (cmd === 'verify') {
    const evidencePath = args.evidence;
    if (!evidencePath || !existsSync(evidencePath)) {
      console.error('Usage: owasp-agentic-top10.ts verify --evidence <path> [--agentic]');
      process.exit(1);
    }
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf-8'));
    const agentic = args.agentic === 'true' || args.agentic === '1';
    // Verify each category has evidence
    const report = agentic ? generateAgenticReport(false) : generateReport(false);
    const missing = report.categories.filter((c) => !evidence[c.id]);
    if (missing.length > 0) {
      console.error(`Missing evidence for: ${missing.map((m) => m.id).join(', ')}`);
      process.exit(1);
    }
    console.log('All OWASP categories have evidence. PASS');
    return;
  }

  console.error('Usage: owasp-agentic-top10.ts <report|verify> [options]');
  process.exit(1);
}

// Only run CLI when executed directly (not imported)
if (
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith('owasp-agentic-top10.ts'))
) {
  main();
}
