/**
 * Domain Templates — Plantillas especializadas por dominio (Sugerencia 5)
 *
 * 8 dominios principales:
 * 1. Developer Copilot
 * 2. Architect Assistant  
 * 3. Research Assistant
 * 4. Personal Ops
 * 5. Business Ops
 * 6. Content/Docs Assistant
 * 7. Learning Coach
 * 8. Incident Commander
 *
 * Cada plantilla incluye:
 * - Skills específicas del dominio
 * - Reglas y constraints
 * - Conectores habituales (Calendar, Email, Notion, etc.)
 * - Hooks para eventos comunes
 * - Autonomy levels recomendados
 * - Model profiles por fase SDD
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export type DomainId =
  | 'developer-copilot'
  | 'architect-assistant'
  | 'research-assistant'
  | 'personal-ops'
  | 'business-ops'
  | 'content-assistant'
  | 'learning-coach'
  | 'incident-commander';

export interface DomainConnector {
  name: string;
  enabled: boolean;
  config?: Record<string, unknown>;
  required?: boolean;
}

export interface DomainHook {
  event: string;
  action: string;
  priority: number;
}

export interface DomainAutonomyConfig {
  defaultMode: 'observe' | 'suggest' | 'assist' | 'autopilot';
  allowedModes: ('observe' | 'suggest' | 'assist' | 'autopilot' | 'guardian')[];
  escalationTriggers: string[];
}

export interface DomainSDDConfig {
  BA: {
    temperature: number;
    hallucinationGuard: 'strict' | 'moderate' | 'lenient';
    steps: number;
  };
  SAD: {
    temperature: number;
    hallucinationGuard: 'strict' | 'moderate' | 'lenient';
    steps: number;
  };
  DEV: {
    temperature: number;
    hallucinationGuard: 'strict' | 'moderate' | 'lenient';
    steps: number;
  };
  QA: {
    temperature: number;
    hallucinationGuard: 'strict' | 'moderate' | 'lenient';
    steps: number;
  };
}

export interface DomainTemplate {
  id: DomainId;
  name: string;
  description: string;
  icon: string;
  color: string;
  targetUser: string;
  primaryGoal: string;
  skills: string[];
  rules: string[];
  connectors: DomainConnector[];
  hooks: DomainHook[];
  autonomy: DomainAutonomyConfig;
  sdd: DomainSDDConfig;
  metrics: string[];
  suggestedPrompts: string[];
}

// ─── Domain Definitions ───────────────────────────────────────────────────

export const domainTemplates: Record<DomainId, DomainTemplate> = {
  'developer-copilot': {
    id: 'developer-copilot',
    name: 'Developer Copilot',
    description:
      'Asistente especializado en desarrollo de software, code review, debugging y arquitectura técnica',
    icon: '💻',
    color: '#3B82F6',
    targetUser: 'Ingenieros de software, desarrolladores, tech leads',
    primaryGoal: 'Acelerar el desarrollo manteniendo calidad y buenas prácticas',
    skills: [
      'debugging-and-error-recovery',
      'test-driven-development',
      'code-review-and-quality',
      'ci-cd-and-automation',
      'api-and-interface-design',
      'performance-optimization',
      'security-and-hardening',
    ],
    rules: [
      'Siempre ejecutar typecheck antes de dar por terminado el código',
      'Nunca modificar package.json sin confirmación explícita',
      'Mantener compatibilidad hacia atrás para APIs públicas',
      'Seguir convenciones de nomenclatura del proyecto',
    ],
    connectors: [
      { name: 'GitHub', enabled: false, required: false, config: {} },
      { name: 'GitLab', enabled: false, required: false, config: {} },
      { name: 'Linear', enabled: false, required: false, config: {} },
      { name: 'Jira', enabled: false, required: false, config: {} },
      { name: 'Slack', enabled: false, required: false, config: {} },
    ],
    hooks: [
      { event: 'git:commit', action: 'run-pre-commit-checks', priority: 1 },
      { event: 'git:push', action: 'run-ci-pipeline', priority: 2 },
      { event: 'test:fail', action: 'suggest-debug-approach', priority: 1 },
    ],
    autonomy: {
      defaultMode: 'assist',
      allowedModes: ['observe', 'suggest', 'assist', 'guardian'],
      escalationTriggers: [
        'modificación de archivos de configuración críticos',
        'cambios en base de datos',
        'deployment a producción',
      ],
    },
    sdd: {
      BA: { temperature: 0.5, hallucinationGuard: 'strict', steps: 38 },
      SAD: { temperature: 0.3, hallucinationGuard: 'strict', steps: 30 },
      DEV: { temperature: 0.1, hallucinationGuard: 'strict', steps: 52 },
      QA: { temperature: 0.2, hallucinationGuard: 'strict', steps: 36 },
    },
    metrics: [
      'lines-of-code-changed',
      'test-coverage',
      'build-time',
      'typecheck-errors',
      'lint-warnings',
    ],
    suggestedPrompts: [
      'Refactoriza este código para mejorar legibilidad',
      'Crea tests unitarios para esta función',
      'Revisa este PR por posibles bugs de seguridad',
      'Optimiza el rendimiento de esta query de base de datos',
    ],
  },

  'architect-assistant': {
    id: 'architect-assistant',
    name: 'Architect Assistant',
    description:
      'Asistente para diseño de sistemas, evaluación de arquitectura, ADRs y decisiones técnicas de alto nivel',
    icon: '🏗️',
    color: '#8B5CF6',
    targetUser: 'Arquitectos de software, CTOs, tech leads senior',
    primaryGoal: 'Diseñar sistemas escalables, mantenibles y alineados con objetivos de negocio',
    skills: [
      'api-and-interface-design',
      'documentation-and-adrs',
      'planning-and-task-breakdown',
      'doubt-driven-development',
      'deprecation-and-migration',
      'performance-optimization',
      'security-and-hardening',
    ],
    rules: [
      'Todo ADR debe incluir alternativas evaluadas',
      'Las decisiones de arquitectura requieren reconcimiento de al menos 2 alternativas',
      'Documentar trade-offs explícitamente',
      'Revisar ADRs cada 6 meses para obsolescencia',
    ],
    connectors: [
      { name: 'Confluence', enabled: false, required: false, config: {} },
      { name: 'Notion', enabled: false, required: false, config: {} },
      { name: 'GitHub', enabled: false, required: false, config: {} },
      { name: 'Miro', enabled: false, required: false, config: {} },
      { name: 'Lucidchart', enabled: false, required: false, config: {} },
    ],
    hooks: [
      { event: 'adr:created', action: 'schedule-architecture-review', priority: 1 },
      { event: 'system:degraded', action: 'trigger-architecture-analysis', priority: 1 },
    ],
    autonomy: {
      defaultMode: 'suggest',
      allowedModes: ['observe', 'suggest', 'assist', 'guardian'],
      escalationTriggers: [
        'cambios que afectan múltiples servicios',
        'modificación de contratos de API públicos',
        'decisiones que impactan compliance',
      ],
    },
    sdd: {
      BA: { temperature: 0.4, hallucinationGuard: 'strict', steps: 40 },
      SAD: { temperature: 0.2, hallucinationGuard: 'strict', steps: 45 },
      DEV: { temperature: 0.2, hallucinationGuard: 'moderate', steps: 40 },
      QA: { temperature: 0.3, hallucinationGuard: 'moderate', steps: 35 },
    },
    metrics: [
      'adrs-created',
      'architecture-reviews-completed',
      'technical-debt-items-identified',
      'system-coupling-score',
    ],
    suggestedPrompts: [
      'Diseña la arquitectura para un sistema de notificaciones en tiempo real',
      'Evalúa los trade-offs de microservicios vs monolito para este caso',
      'Crea un ADR para la decisión de base de datos',
      'Revisa esta arquitectura en busca de cuellos de botella',
    ],
  },

  'research-assistant': {
    id: 'research-assistant',
    name: 'Research Assistant',
    description:
      'Asistente para investigación, análisis de tendencias, recolección de información y síntesis de conocimiento',
    icon: '🔬',
    color: '#10B981',
    targetUser: 'Investigadores, product managers, analistas, desarrolladores',
    primaryGoal: 'Recolectar, sintetizar y presentar información relevante de manera efectiva',
    skills: [
      'web-research',
      'document-processor',
      'data-analyst',
      'cognitive-doc-design',
      'technical-writer',
    ],
    rules: [
      'Citar fuentes explícitamente',
      'Distinguir entre hechos verificados y opiniones',
      'Incluir fecha de última actualización de la información',
      'Presentar múltiples perspectivas cuando existan',
    ],
    connectors: [
      { name: 'Notion', enabled: false, required: false, config: {} },
      { name: 'Airtable', enabled: false, required: false, config: {} },
      { name: 'Zotero', enabled: false, required: false, config: {} },
      { name: 'Google Scholar', enabled: false, required: false, config: {} },
    ],
    hooks: [
      { event: 'research:completed', action: 'store-in-knowledge-base', priority: 1 },
      { event: 'trend:detected', action: 'notify-stakeholders', priority: 2 },
    ],
    autonomy: {
      defaultMode: 'suggest',
      allowedModes: ['observe', 'suggest', 'assist'],
      escalationTriggers: ['investigación con implicaciones legales', 'datos sensibles'],
    },
    sdd: {
      BA: { temperature: 0.6, hallucinationGuard: 'moderate', steps: 45 },
      SAD: { temperature: 0.4, hallucinationGuard: 'moderate', steps: 35 },
      DEV: { temperature: 0.3, hallucinationGuard: 'moderate', steps: 35 },
      QA: { temperature: 0.4, hallucinationGuard: 'strict', steps: 30 },
    },
    metrics: [
      'sources-consulted',
      'research-hours',
      'synthesis-quality-score',
      'knowledge-base-entries-created',
    ],
    suggestedPrompts: [
      'Investiga las últimas tendencias en arquitectura de microservicios',
      'Resume este paper de investigación en 3 párrafos',
      'Analiza competidores en el mercado de herramientas DevOps',
      'Crea un reporte de inteligencia competitiva',
    ],
  },

  'personal-ops': {
    id: 'personal-ops',
    name: 'Personal Ops',
    description:
      'Asistente para organización personal, recordatorios, seguimiento de tareas y gestión de información',
    icon: '📋',
    color: '#F59E0B',
    targetUser:
      'Profesionales, freelancers, managers, cualquiera que necesite organización personal',
    primaryGoal: 'Mantener organizada la vida diaria y reducir la carga cognitiva',
    skills: [
      'planning-and-task-breakdown',
      'incremental-implementation',
      'document-processor',
      'technical-writer',
    ],
    rules: [
      'Respetar preferencias de notificación del usuario',
      'Nunca comprometerse con terceros sin confirmación',
      'Proteger información personal sensible',
      'Priorizar según energía y contexto del usuario',
    ],
    connectors: [
      { name: 'Calendar', enabled: false, required: false, config: {} },
      { name: 'Email', enabled: false, required: false, config: {} },
      { name: 'Notion', enabled: false, required: false, config: {} },
      { name: 'Todoist', enabled: false, required: false, config: {} },
      { name: 'Slack', enabled: false, required: false, config: {} },
    ],
    hooks: [
      { event: 'task:due-soon', action: 'send-reminder', priority: 1 },
      { event: 'meeting:upcoming', action: 'prepare-context', priority: 2 },
      { event: 'document:received', action: 'process-and-summarize', priority: 1 },
    ],
    autonomy: {
      defaultMode: 'assist',
      allowedModes: ['observe', 'suggest', 'assist', 'autopilot'],
      escalationTriggers: ['decisiones con impacto financiero', 'comunicaciones formales'],
    },
    sdd: {
      BA: { temperature: 0.5, hallucinationGuard: 'moderate', steps: 30 },
      SAD: { temperature: 0.4, hallucinationGuard: 'moderate', steps: 25 },
      DEV: { temperature: 0.3, hallucinationGuard: 'moderate', steps: 30 },
      QA: { temperature: 0.4, hallucinationGuard: 'moderate', steps: 25 },
    },
    metrics: ['tasks-completed', 'reminders-sent', 'documents-processed', 'time-saved-estimated'],
    suggestedPrompts: [
      'Organiza mis tareas pendientes por prioridad',
      'Resume este documento y extrae las acciones clave',
      'Prepara un resumen para mi reunión de mañana',
      'Crea un sistema de seguimiento para mis proyectos personales',
    ],
  },

  'business-ops': {
    id: 'business-ops',
    name: 'Business Ops',
    description:
      'Asistente para operaciones de negocio, análisis financiero, reportes y gestión administrativa',
    icon: '📊',
    color: '#EF4444',
    targetUser: 'COOs, managers de operaciones, analistas de negocio, founders',
    primaryGoal: 'Optimizar operaciones y proporcionar visibilidad del negocio',
    skills: [
      'data-analyst',
      'finance-financial-analyst',
      'marketing-content-writer',
      'planning-and-task-breakdown',
      'documentation-and-adrs',
    ],
    rules: [
      'Validar datos antes de generar reportes',
      'Verificar cálculos financieros críticos',
      'Mantener confidencialidad de información financiera',
      'Incluir contexto y anomalías en reportes',
    ],
    connectors: [
      { name: 'Airtable', enabled: false, required: false, config: {} },
      { name: 'Notion', enabled: false, required: false, config: {} },
      { name: 'Stripe', enabled: false, required: false, config: {} },
      { name: 'QuickBooks', enabled: false, required: false, config: {} },
      { name: 'Salesforce', enabled: false, required: false, config: {} },
    ],
    hooks: [
      { event: 'metric:threshold-breach', action: 'alert-stakeholders', priority: 1 },
      { event: 'report:due', action: 'generate-and-distribute', priority: 1 },
      { event: 'invoice:received', action: 'validate-and-process', priority: 2 },
    ],
    autonomy: {
      defaultMode: 'suggest',
      allowedModes: ['observe', 'suggest', 'assist', 'guardian'],
      escalationTriggers: [
        'transacciones financieras',
        'proyecciones compartidas con inversores',
        'cambios en contratos',
      ],
    },
    sdd: {
      BA: { temperature: 0.4, hallucinationGuard: 'strict', steps: 38 },
      SAD: { temperature: 0.3, hallucinationGuard: 'strict', steps: 35 },
      DEV: { temperature: 0.2, hallucinationGuard: 'strict', steps: 35 },
      QA: { temperature: 0.3, hallucinationGuard: 'strict', steps: 30 },
    },
    metrics: [
      'reports-generated',
      'analysis-accuracy',
      'operational-efficiency-score',
      'cost-savings-identified',
    ],
    suggestedPrompts: [
      'Analiza nuestro funnel de conversión y sugiere mejoras',
      'Crea un dashboard de métricas clave de negocio',
      'Genera un reporte de análisis de churn',
      'Optimiza nuestro proceso de onboarding de clientes',
    ],
  },

  'content-assistant': {
    id: 'content-assistant',
    name: 'Content/Docs Assistant',
    description: 'Asistente para creación, edición y gestión de documentación técnica y contenido',
    icon: '📝',
    color: '#6366F1',
    targetUser: 'Technical writers, developer advocates, product managers',
    primaryGoal: 'Crear documentación clara, precisa y útil de manera eficiente',
    skills: [
      'technical-writer',
      'cognitive-doc-design',
      'documentation-and-adrs',
      'api-and-interface-design',
      'code-simplification',
    ],
    rules: [
      'Mantener consistencia de estilo y terminología',
      'Incluir ejemplos de código funcionales',
      'Verificar que los enlaces no estén rotos',
      'Actualizar índices y navegación',
    ],
    connectors: [
      { name: 'Notion', enabled: false, required: false, config: {} },
      { name: 'Confluence', enabled: false, required: false, config: {} },
      { name: 'GitHub', enabled: false, required: false, config: {} },
      { name: 'ReadMe', enabled: false, required: false, config: {} },
      { name: 'Docusaurus', enabled: false, required: false, config: {} },
    ],
    hooks: [
      { event: 'feature:released', action: 'update-documentation', priority: 1 },
      { event: 'api:changed', action: 'flag-breaking-changes', priority: 1 },
      { event: 'doc:stale-detected', action: 'schedule-update', priority: 2 },
    ],
    autonomy: {
      defaultMode: 'assist',
      allowedModes: ['observe', 'suggest', 'assist'],
      escalationTriggers: ['publicación de documentación oficial', 'cambios en branding'],
    },
    sdd: {
      BA: { temperature: 0.5, hallucinationGuard: 'moderate', steps: 30 },
      SAD: { temperature: 0.4, hallucinationGuard: 'moderate', steps: 25 },
      DEV: { temperature: 0.3, hallucinationGuard: 'moderate', steps: 35 },
      QA: { temperature: 0.4, hallucinationGuard: 'moderate', steps: 30 },
    },
    metrics: [
      'docs-pages-created',
      'docs-updated',
      'readability-score',
      'user-satisfaction-with-docs',
    ],
    suggestedPrompts: [
      'Crea la documentación de API para este endpoint',
      'Revisa y mejora esta guía de contribución',
      'Genera ejemplos de código para esta función',
      'Reestructura este README para mejor claridad',
    ],
  },

  'learning-coach': {
    id: 'learning-coach',
    name: 'Learning Coach',
    description:
      'Asistente para creación de planes de aprendizaje, análisis de gaps de conocimiento y evaluación',
    icon: '🎓',
    color: '#EC4899',
    targetUser: 'Estudiantes, profesionales en desarrollo, equipos de aprendizaje',
    primaryGoal: 'Facilitar el aprendizaje efectivo y continuo',
    skills: [
      'planning-and-task-breakdown',
      'incremental-implementation',
      'cognitive-doc-design',
      'technical-writer',
    ],
    rules: [
      'Adaptar el ritmo al nivel del aprendiz',
      'Incluir evaluaciones formatativas',
      'Proporcionar retroalimentación constructiva',
      'Conectar conceptos con casos reales',
    ],
    connectors: [
      { name: 'LMS', enabled: false, required: false, config: {} },
      { name: 'Notion', enabled: false, required: false, config: {} },
      { name: 'Coursera', enabled: false, required: false, config: {} },
      { name: 'LinkedIn Learning', enabled: false, required: false, config: {} },
    ],
    hooks: [
      { event: 'learning:milestone-achieved', action: 'celebrate-progress', priority: 1 },
      { event: 'learning:struggling', action: 'suggest-adaptation', priority: 1 },
      { event: 'assessment:completed', action: 'analyze-gaps', priority: 1 },
    ],
    autonomy: {
      defaultMode: 'assist',
      allowedModes: ['observe', 'suggest', 'assist'],
      escalationTriggers: ['evaluaciones finales', 'certificaciones oficiales'],
    },
    sdd: {
      BA: { temperature: 0.6, hallucinationGuard: 'moderate', steps: 32 },
      SAD: { temperature: 0.5, hallucinationGuard: 'moderate', steps: 28 },
      DEV: { temperature: 0.4, hallucinationGuard: 'moderate', steps: 30 },
      QA: { temperature: 0.5, hallucinationGuard: 'strict', steps: 28 },
    },
    metrics: [
      'learning-hours',
      'assessments-completed',
      'knowledge-retention-score',
      'learner-engagement',
    ],
    suggestedPrompts: [
      'Crea un plan de aprendizaje de 3 meses para TypeScript avanzado',
      'Evalúa mi comprensión de arquitectura de microservicios',
      'Diseña un curso introductorio para nuevos desarrolladores',
      'Identifica gaps de conocimiento en mi equipo',
    ],
  },

  'incident-commander': {
    id: 'incident-commander',
    name: 'Incident Commander',
    description: 'Asistente para gestión de incidentes, comunicación durante crisis y post-mortems',
    icon: '🚨',
    color: '#DC2626',
    targetUser: 'SREs, on-call engineers, managers de incidentes',
    primaryGoal: 'Minimizar el impacto de incidentes y prevenir recurrencias',
    skills: [
      'debugging-and-error-recovery',
      'planning-and-task-breakdown',
      'incremental-implementation',
      'doubt-driven-development',
    ],
    rules: [
      'Priorizar mitigación sobre diagnóstico completo',
      'Comunicar progreso cada 15 minutos',
      'Documentar timeline en tiempo real',
      'Facilitar post-mortem sin culpas',
    ],
    connectors: [
      { name: 'PagerDuty', enabled: false, required: false, config: {} },
      { name: 'Slack', enabled: false, required: true, config: {} },
      { name: 'DataDog', enabled: false, required: false, config: {} },
      { name: 'Grafana', enabled: false, required: false, config: {} },
      { name: 'Jira', enabled: false, required: false, config: {} },
    ],
    hooks: [
      { event: 'alert:critical', action: 'initiate-incident-response', priority: 1 },
      { event: 'incident:mitigated', action: 'schedule-post-mortem', priority: 1 },
      { event: 'incident:escalated', action: 'notify-leadership', priority: 1 },
    ],
    autonomy: {
      defaultMode: 'assist',
      allowedModes: ['observe', 'suggest', 'assist', 'autopilot'],
      escalationTriggers: [
        'escalamiento a producción',
        'posible pérdida de datos',
        'incidente de seguridad',
      ],
    },
    sdd: {
      BA: { temperature: 0.3, hallucinationGuard: 'strict', steps: 25 },
      SAD: { temperature: 0.2, hallucinationGuard: 'strict', steps: 30 },
      DEV: { temperature: 0.1, hallucinationGuard: 'strict', steps: 35 },
      QA: { temperature: 0.1, hallucinationGuard: 'strict', steps: 30 },
    },
    metrics: ['mttr', 'mtbf', 'incident-severity-distribution', 'post-mortem-completion'],
    suggestedPrompts: [
      'Inicia respuesta a incidente: latencia de API está degradada',
      'Crea un runbook para este tipo de fallo',
      'Facilita un post-mortem de este incidente',
      'Analiza tendencias de disponibilidad de los últimos 3 meses',
    ],
  },
};

// ─── Utility Functions ─────────────────────────────────────────────────────

export function getDomainTemplate(id: DomainId): DomainTemplate | undefined {
  return domainTemplates[id];
}

export function listDomainTemplates(): DomainTemplate[] {
  return Object.values(domainTemplates);
}

export function getDomainsBySkill(skill: string): DomainTemplate[] {
  return Object.values(domainTemplates).filter((d) => d.skills.includes(skill));
}

export function getDefaultDomain(): DomainTemplate {
  return domainTemplates['developer-copilot'];
}

// Re-export all
export default domainTemplates;
