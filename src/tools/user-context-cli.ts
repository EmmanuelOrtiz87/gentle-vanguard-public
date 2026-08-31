#!/usr/bin/env node
/**
 * User Context CLI — Punto de entrada unificado para User Operating Context
 *
 * Combina:
 * - User Operating Context (Sugerencia 1): objetivos, preferencias, bloqueos
 * - Decisions Log (Sugerencia 2): decisiones, acuerdos, revisiones
 * - Domain Templates (Sugerencia 5): plantillas especializadas
 *
 * Usage:
 *   npx tsx src/tools/user-context-cli.ts <command> [args]
 *   npm run user:context -- <command> [args]
 */

import {
  loadContext,
  createObjective,
  listObjectives,
  updateObjectiveProgress,
  blockObjective,
  deferObjective,
  addDoNotRepeat,
  setCurrentFocus,
  updatePreferences,
  getContextSummary,
  generateWeeklyReport,
  type ObjectiveTimeframe,
  type ObjectiveStatus,
} from './user-operating-context.js';

import {
  logDecision,
  searchDecisions,
  getDecisionById,
  scheduleReview,
  completeReview,
  createAgreement,
  listAgreements,
  getPendingReviews,
  getOverdueReviews,
  generateDecisionsReport,
  type DecisionType,
  type AgreementTrigger,
} from './decisions-log.js';

import {
  getDomainTemplate,
  listDomainTemplates,
  getDomainsBySkill,
  type DomainId,
} from '../sdd/domain-templates.js';

// ─── CLI Commands ─────────────────────────────────────────────────────────

const commands: Record<string, (args: string[]) => Promise<void> | void> = {
  // User Context: Objectives
  'objective-create': async (args) => {
    const params = parseArgs(args, ['title', 'desc', 'description', 'timeframe', 'priority']);
    if (!params.title || !params.desc || !params.timeframe) {
      console.error('Error: --title, --desc/--description, --timeframe required');
      process.exit(1);
    }
    const tags = params.tags?.split(',') ?? [];
    const criteria = params.criteria?.split('|') ?? [];
    await createObjective(
      params.title,
      params.desc,
      params.timeframe as ObjectiveTimeframe,
      parseInt(params.priority ?? '5', 10),
      tags,
      criteria,
    );
  },

  'objective-list': (args) => {
    const params = parseArgs(args, ['status', 'timeframe']);
    const objectives = listObjectives(
      params.status as ObjectiveStatus | undefined,
      params.timeframe as ObjectiveTimeframe | undefined,
    );
    console.table(
      objectives.map((o) => ({
        id: o.id,
        title: o.title.length > 40 ? o.title.slice(0, 40) + '...' : o.title,
        status: o.status,
        priority: o.priority,
        progress: `${o.progress}%`,
        timeframe: o.timeframe,
      })),
    );
  },

  'objective-progress': async (args) => {
    const params = parseArgs(args, ['id', 'percent']);
    if (!params.id) {
      console.error('Error: --id required');
      process.exit(1);
    }
    await updateObjectiveProgress(params.id, parseInt(params.percent ?? '0', 10));
  },

  'objective-block': async (args) => {
    const params = parseArgs(args, ['id', 'reason', 'blocker']);
    if (!params.id || !params.reason || !params.blocker) {
      console.error('Error: --id, --reason, --blocker required');
      process.exit(1);
    }
    await blockObjective(params.id, params.reason, params.blocker);
  },

  'objective-defer': async (args) => {
    const params = parseArgs(args, ['id', 'until', 'reason']);
    if (!params.id || !params.until || !params.reason) {
      console.error('Error: --id, --until, --reason required');
      process.exit(1);
    }
    await deferObjective(params.id, params.until, params.reason);
  },

  'objective-focus': async (args) => {
    const params = parseArgs(args, ['id']);
    await setCurrentFocus(params.id ?? null);
  },

  // User Context: Preferences
  'preferences-show': () => {
    const context = loadContext();
    console.log(JSON.stringify(context.preferences, null, 2));
  },

  'preferences-update': async (args) => {
    const params = parseArgs(args, ['risk', 'autonomy', 'style', 'language']);
    const updates: Record<string, unknown> = {};
    if (params.risk) updates.riskTolerance = params.risk;
    if (params.autonomy) updates.preferredAutonomy = params.autonomy;
    if (params.style) updates.communicationStyle = params.style;
    if (params.language) updates.preferredLanguage = params.language;
    await updatePreferences(updates);
  },

  // User Context: Patterns & Do Not Repeat
  'do-not-repeat': async (args) => {
    const pattern = args.join(' ');
    if (!pattern) {
      console.error('Error: pattern text required');
      process.exit(1);
    }
    await addDoNotRepeat(pattern);
  },

  // Decisions: Management
  'decision-log': async (args) => {
    const params = parseArgs(args, [
      'title',
      'description',
      'type',
      'rationale',
      'context',
      'review',
    ]);
    if (!params.title || !params.description || !params.rationale || !params.context) {
      console.error('Error: --title, --description, --rationale, --context required');
      process.exit(1);
    }
    const reviewInDays = params.review ? parseInt(params.review, 10) : undefined;
    await logDecision({
      title: params.title,
      description: params.description,
      type: (params.type ?? 'technical') as DecisionType,
      rationale: params.rationale,
      context: params.context,
      alternatives: [],
      selectedAlternativeIndex: 0,
      stakeholders: [],
      consequences: [],
      reversible: true,
      reviewInDays,
      tags: [],
    });
  },

  'decision-search': (args) => {
    const params = parseArgs(args, ['query', 'type']);
    const results = searchDecisions(params.query ?? '', params.type as DecisionType | undefined);
    console.table(
      results.map((d) => ({
        id: d.id,
        title: d.title.length > 40 ? d.title.slice(0, 40) + '...' : d.title,
        type: d.type,
        status: d.status,
        created: d.createdAt.slice(0, 10),
      })),
    );
  },

  'decision-get': (args) => {
    const params = parseArgs(args, ['id']);
    const decision = getDecisionById(params.id ?? '');
    if (decision) {
      console.log(JSON.stringify(decision, null, 2));
    } else {
      console.error(`Decision ${params.id} not found`);
      process.exit(1);
    }
  },

  // Decisions: Reviews
  'review-schedule': async (args) => {
    const params = parseArgs(args, ['id', 'days']);
    await scheduleReview(params.id ?? '', parseInt(params.days ?? '30', 10));
  },

  'review-complete': async (args) => {
    const params = parseArgs(args, ['id', 'outcome', 'notes']);
    await completeReview(
      params.id ?? '',
      (params.outcome ?? 'confirmed') as 'confirmed' | 'revised' | 'reverted',
      params.notes ?? '',
    );
  },

  'reviews-pending': () => {
    const reviews = getPendingReviews();
    console.table(reviews);
  },

  'reviews-overdue': () => {
    const reviews = getOverdueReviews();
    console.table(reviews);
  },

  // Agreements
  'agreement-create': async (args) => {
    const params = parseArgs(args, [
      'title',
      'description',
      'trigger',
      'condition',
      'action',
      'action-type',
    ]);
    if (
      !params.title ||
      !params.description ||
      !params.trigger ||
      !params.condition ||
      !params.action
    ) {
      console.error('Error: --title, --description, --trigger, --condition, --action required');
      process.exit(1);
    }
    await createAgreement({
      title: params.title,
      description: params.description,
      triggerType: params.trigger as AgreementTrigger,
      triggerCondition: params.condition,
      action: params.action,
      actionType: (params['action-type'] ?? 'suggest') as
        'suggest' | 'execute' | 'escalate' | 'log_only',
    });
  },

  'agreement-list': (args) => {
    const includeInactive = args.includes('--include-inactive');
    const agreements = listAgreements(!includeInactive);
    console.table(agreements);
  },

  // Domain Templates
  'domain-list': () => {
    const domains = listDomainTemplates();
    console.table(
      domains.map((d) => ({
        id: d.id,
        name: d.name,
        icon: d.icon,
        target: d.targetUser.slice(0, 30) + '...',
        skills: d.skills.length,
      })),
    );
  },

  'domain-get': (args) => {
    const params = parseArgs(args, ['id']);
    const domain = getDomainTemplate(params.id as DomainId);
    if (domain) {
      console.log(JSON.stringify(domain, null, 2));
    } else {
      console.error(`Domain ${params.id} not found`);
      console.log(`Available domains: ${Object.keys(listDomainTemplates()).join(', ')}`);
      process.exit(1);
    }
  },

  'domain-by-skill': (args) => {
    const params = parseArgs(args, ['skill']);
    const domains = getDomainsBySkill(params.skill ?? '');
    console.log(`Domains supporting "${params.skill}":`);
    console.table(domains.map((d) => ({ id: d.id, name: d.name, icon: d.icon })));
  },

  // Reports & Summary
  'report-weekly': () => {
    console.log(generateWeeklyReport());
  },

  'report-decisions': () => {
    console.log(generateDecisionsReport());
  },

  summary: () => {
    const summary = getContextSummary();
    console.log('=== User Context Summary ===');
    console.log(summary);
  },

  help: printHelp,
};

// ─── Utility Functions ─────────────────────────────────────────────────────

function parseArgs(args: string[], expected: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      if (expected.includes(key)) {
        result[key] = args[i + 1] ?? '';
        i++;
      }
    }
  }
  return result;
}

function printHelp() {
  console.log(`
╔════════════════════════════════════════════════════════════════╗
║          USER CONTEXT CLI — Gestión de Contexto y Decisions    ║
╚════════════════════════════════════════════════════════════════╝

USER CONTEXT (Objectivos y Preferencias)
────────────────────────────────────────────────────────────────
  objective-create --title "..." --description "..." --timeframe weekly|monthly|quarterly --priority 1-10 [--tags a,b,c] [--criteria "...","..."]
  objective-list [--status active|blocked|deferred|completed] [--timeframe weekly|monthly|quarterly]
  objective-progress --id <id> --percent 0-100
  objective-block --id <id> --reason "..." --blocker "..."
  objective-defer --id <id> --until YYYY-MM-DD --reason "..."
  objective-focus --id <id>|clear
  
  preferences-show
  preferences-update [--risk conservative|moderate|aggressive] [--autonomy observe|suggest|assist|autopilot] [--style direct|detailed|concise] [--language es|en]
  
  do-not-repeat "..."     Añade patrón a "no repetir"

DECISIONS LOG (Bitácora de Decisiones)
────────────────────────────────────────────────────────────────
  decision-log --title "..." --description "..." --type technical|product|process|architecture|preference --rationale "..." --context "..." [--review 30]
  decision-search "<query>" [--type technical|product|process|architecture|preference]
  decision-get --id <id>
  decision-supersede --id <old-id> --with "..." --reason "..."
  
  review-schedule --id <id> --days <n>
  review-complete --id <id> --outcome confirmed|revised|reverted --notes "..."
  reviews-pending
  reviews-overdue
  
  agreement-create --title "..." --description "..." --trigger manual|scheduled|event_based|metric_threshold --condition "..." --action "..." [--action-type suggest|execute|escalate|log_only]
  agreement-list [--include-inactive]

DOMAIN TEMPLATES (Plantillas Especializadas)
────────────────────────────────────────────────────────────────
  domain-list
  domain-get --id <domain-id>
  domain-by-skill --skill <skill-name>

REPORTS
────────────────────────────────────────────────────────────────
  report-weekly
  report-decisions
  summary

EXAMPLES
────────────────────────────────────────────────────────────────
  npx tsx src/tools/user-context-cli.ts objective-create --title "Mejorar documentación" --description "Actualizar guía de contribución" --timeframe monthly --priority 7 --tags docs,community
  npx tsx src/tools/user-context-cli.ts decision-log --title "Usar TypeScript over JavaScript" --description "Migración completa" --type architecture --rationale "Type safety reduces bugs" --context "Team decided" --review 90
  npx tsx src/tools/user-context-cli.ts domain-get --id developer-copilot
`);
}

// ─── Main Entry Point ─────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  const handler = commands[command];
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    console.log(`\nUse 'help' for available commands`);
    process.exit(1);
  }

  try {
    await handler(commandArgs);
  } catch (error) {
    console.error(`Error executing ${command}:`, error);
    process.exit(1);
  }
}

if (process.argv[1]) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

// Re-export for programmatic use
export { commands };
