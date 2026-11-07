/**
 * Set 3 - Onboarding técnico (ES).
 *
 * Audiencia: perfiles técnicos que se suman al stack o van a operar sobre el.
 * Objetivo: que una persona pueda instalar, arrancar, entender el mapa del
 * repositorio, escribir código con el flujo del proyecto y encontrar lo que
 * necesita, sin depender de otra persona.
 *
 * Regla editorial: los comandos, rutas y conteos son los reales del repositorio.
 */

export default {
  id: 'gv-tecnico-es',
  title: 'GentleVanguard - Onboarding técnico del stack',
  subject: 'Onboarding técnico de GentleVanguard',
  footer: 'GentleVanguard - Stack v4.3.0',
  theme: 'hybrid',
  hero: 'technical',
  slides: [
    {
      layout: 'cover',
      eyebrow: 'Onboarding técnico',
      title: 'Cómo se trabaja\ndentro del stack',
      titleSize: 32,
      titleH: 1.3,
      subtitle:
        'Mapa del repositorio, anatomía de una sesión, agentes, skills, comandos, base operacional y las reglas que sostienen todo lo demás.',
      meta: ['Stack v4.3.0', 'Node 24', 'pnpm 11'],
      versión: 'Guía de incorporación - Noviembre 2026',
    },

    {
      layout: 'agenda',
      eyebrow: 'Recorrido',
      title: 'Lo que vas a recorrer',
      lead: 'Orden recomendado para una primera semana.',
      items: [
        { heading: 'Mapa del repositorio', body: 'Qué vive en cada carpeta y por qué está separada.' },
        { heading: 'Anatomía de una sesión', body: 'Qué pasa entre que llegan tu prompt y el agente responde.' },
        { heading: 'Agentes y skills', body: 'Los 20 agentes del roster y cómo se invocan las capacidades.' },
        { heading: 'Comandos', body: 'Los comandos que se usan todos los días y qué verifican.' },
        { heading: 'Nexus', body: 'La base operacional: 45 tablas, migraciones y respaldo.' },
        { heading: 'Flujo de desarrollo', body: 'Del pedido al commit: ODD, slices, gates y frontera revisada.' },
        { heading: 'Reglas del repo', body: 'Lo que no se negocia y por qué existe.' },
        { heading: 'Dónde buscar', body: 'La ruta más corta a cada tipo de respuesta.' },
      ],
    },

    {
      layout: 'layers',
      eyebrow: 'Mapa',
      title: 'Ocho carpetas, una responsabilidad cada una',
      lead: 'La separación no es estética: es lo que permite que las validaciones sean automáticas.',
      labelW: 1.55,
      items: [
        { label: 'src/', body: 'más de 800 archivos TypeScript. Código del stack por área: orquestación, seguridad, retrieval, datos, tools, quality y ops.', accent: '06b6d4' },
        { label: 'apps/', body: '28 aplicaciones propias que operan sobre el stack y validan la arquitectura en producción.', accent: '8b5cf6' },
        { label: 'skills/', body: '256 capacidades con contrato y frontmatter. Se invocan por descripción de tarea.', accent: 'fbbf24' },
        { label: 'docs/', body: 'Manual de stack por módulos, manual completo, 38 ADRs y registro de decisiones de diseño.', accent: '22d3ee' },
        { label: 'config/', body: 'Fuente única de configuración: router de modelos, mapeo de roles, quality gates, budgets y registro MCP.', accent: '4ade80' },
        { label: 'packages/', body: 'Workspace con el design system oficial y paquetes compartidos que el código importa.', accent: 'c4b5fd' },
        { label: 'tests/', body: 'más de 550 archivos de test: unit, e2e, integración, seguridad, skills, workflows, eval y performance.', accent: 'f4bb4f' },
        { label: 'assets/', body: 'Marca oficial, tipografías self-hosted y diagrama del shell canónico.', accent: '22d3ee' },
      ],
    },

    {
      layout: 'flow',
      eyebrow: 'Sesión',
      title: 'Qué pasa cuando escribís un pedido',
      lead: 'Seis etapas, todas instrumentadas. Ninguna es magia: todas dejan registro.',
      items: [
        { icon: 'rocket', heading: 'Autostart', body: 'Prepara sesión, engram, orquestador de seguridad, codegraph, budgets, watchtower y Nexus.' },
        { icon: 'compass', heading: 'Preproceso', body: 'Inyecta skills, contexto y reglas antes de que el modelo vea el mensaje.' },
        { icon: 'route', heading: 'Router', body: 'Elige modelo por costo, latencia, dominio y criticalidad de la tarea.' },
        { icon: 'agent', heading: 'Agente', body: 'Ejecuta con herramientas reales. Cada paso queda en la traza.' },
        { icon: 'gears', heading: 'Skills', body: 'Invocadas por contexto. Cada skill declara su contrato y su resultado.' },
        { icon: 'database', heading: 'Nexus', body: 'Sesiones, trazas, tokens, eventos y outcomes de skills quedan persistidos.' },
      ],
    },

    {
      layout: 'cards',
      eyebrow: 'Roster',
      title: '20 agentes, cada uno con su perímetro',
      lead: 'Un agente tiene modelo, permisos, límite de pasos, presupuesto y fallback declarados.',
      cols: 4,
      items: [
        {
          icon: 'compass',
          heading: 'Orquestación',
          body: 'orchestrator, session-agent, knowledge-agent y self-diag-agent: el loop y su propio diagnóstico.',
          accent: '06b6d4',
        },
        {
          icon: 'branch',
          heading: 'Ciclo SDD',
          body: 'sdd-explore, sdd-design, sdd-apply y sdd-verify: la vía opt-in para specs de varias sesiónes.',
          accent: '8b5cf6',
        },
        {
          icon: 'tools',
          heading: 'Operación',
          body: 'ops-agent, maintenance-agent, gitflow-agent, premortem-agent y doc-agent: la operación diaria.',
          accent: 'fbbf24',
        },
        {
          icon: 'users',
          heading: 'Áreas',
          body: 'mkt, sales, finance, hr, legal, bus-tele y sia: roles de negocio con permisos propios.',
          accent: '22d3ee',
        },
      ],
    },

    {
      layout: 'bullets',
      eyebrow: 'Capacidades',
      title: 'Skills: la biblioteca que evita reescribir',
      cols: 2,
      items: [
        { icon: 'book', heading: 'Qué son', body: 'Un SKILL.md con frontmatter, descripción y contrato. Se indexan y se enrutan por similitud de tarea, no por que alguien se acuerde del nombre.' },
        { icon: 'search', heading: 'Cómo se invocan', body: 'El router de skills puntúa la tarea contra la descripción de cada capacidad y propone la más cercana.' },
        { icon: 'flask', heading: 'Cómo se validan', body: '24 contratos críticos se prueban en ejecución real. Nexus separa outcomes de producción, evaluación y mantenimiento.' },
        { icon: 'lock', heading: 'Qué no se copia', body: 'Solo 28 skills críticas se propagan a las cinco superficies externas. El resto no se copia para no degradar la metadata del host.' },
        { icon: 'boxes', heading: 'Adoptadas', body: 'Incluye frontend-design, canvas-design, doc-coauthoring, theme-factory y la familia de marketing, con atribución en el frontmatter.' },
        { icon: 'shield', heading: 'Higiene', body: 'Cada skill pasa por lint de estructura, de acentuación y por el escaner de secretos antes de entrar al índice.' },
      ],
    },

    {
      layout: 'table',
      eyebrow: 'Comandos',
      title: 'Los que se usan todos los días',
      lead: 'Cada operación del stack es un comando auditable. No hay acciones ocultas.',
      headers: ['Comando', 'Que hace'],
      colW: [3.6, 5.2],
      rows: [
        ['npm run session:autostart:detached', 'Arranque de sesión en background. Idempotente. ~1,3 segundos.'],
        ['npm run watchtower:health', '35 componentes vigilados; el informe lista el detalle de cada check. PASS esperado.'],
        ['npm run db:health', 'Verificación de Nexus: integridad, WAL, tablas y filas.'],
        ['npm run token:status', 'Presupuesto real: usado, techo y porcentaje.'],
        ['npm run stack:facts', 'Regenera el inventario de hechos del stack y su documentación.'],
        ['npm run stack:facts:check', 'Falla si hay drift estructural respecto del inventario.'],
        ['npm run quality:universal', 'Quality gate universal: intake, plan, build, verify, release, operate, learn.'],
        ['npm run guard:snapshot', 'Respalda untracked y parches sin commit antes de una operación riesgosa.'],
        ['npm run scan:secrets -- --scan', '80 patrones de detección, con entropía opcional y redacción.'],
        ['npm run graphify -- query "..."', 'Consulta al grafo AST determinista del repositorio.'],
        ['npx tsx src/orchestration/recommend-agent.ts --task "..." --topn 3', 'Recomendación de agente para una tarea.'],
        ['npm run upgrade', 'Sincroniza el workspace con lo publicado en origin, con snapshot previo.'],
      ],
    },

    {
      layout: 'figureLayers',
      eyebrow: 'Datos',
      title: 'Nexus: la memoria operacional del stack',
      lead: '45 tablas y 24 migraciones en SQLite con WAL. Todo lo que el stack aprende queda acá.',
      textW: 3.4,
      items: [
        { icon: 'database', heading: 'Qué guarda', body: 'Métricas, sesiones, trazas, eventos, alertas, feedback, cache, uso de skills, tokens y routing.' },
        { icon: 'clock', heading: 'Retención', body: 'Eventos a 30 días, cache a 7 y uso de tokens a 90. Backups diarios con 14 copias retenidas.' },
        { icon: 'eye', heading: 'Consultas', body: 'SQL directo sobre la base, sin capa de reporte que pueda desincronizarse de la verdad.' },
        { icon: 'shield', heading: 'Integridad', body: 'El watchtower vigila tamaño de archivo, WAL, integridad y recuento de filas en cada ciclo de salud.' },
      ],
      layers: [
        { label: 'Engram', body: 'Memoria persistente entre sesiones', accent: '8b5cf6' },
        { label: 'CodeGraph', body: 'Símbolos y relaciones del repositorio', accent: '22d3ee' },
        { label: 'Nexus', body: 'Métricas, eventos y trazas (SQLite)', accent: '06b6d4' },
      ],
    },

    {
      layout: 'metrics',
      eyebrow: 'Calidad',
      title: 'La calidad no se pide: se ejecuta',
      lead: 'El stack corre sus propios controles en cada commit, en cada push y en cada ciclo de salud.',
      cols: 4,
      items: [
        { value: '47', label: 'Quality gates', sub: '43 de 47 aplicados de forma estricta', accent: '06b6d4' },
        { value: '552+', label: 'Archivos de test', sub: 'Unit, e2e, integración, seguridad y skills', accent: '8b5cf6' },
        { value: '21', label: 'Workflows de CI', sub: 'CI, seguridad, release, sync público y etiqueta automática', accent: 'fbbf24' },
        { value: '80', label: 'Patrones de secreto', sub: 'Con entropía opcional y redacción por defecto', accent: '22d3ee' },
      ],
    },

    {
      layout: 'timeline',
      eyebrow: 'Instalación',
      title: 'Del clone a la primera sesión',
      lead: 'Pasos idempotentes: si se corta, se vuelve a correr sin duplicar nada.',
      items: [
        { step: '01', heading: 'Prerrequisitos', body: 'Node 22.18 o superior, pnpm 11 y Git. Verificación estricta con install:doctor.' },
        { step: '02', heading: 'Dependencias', body: 'pnpm install con lockfile congelado. El árbol del workspace se resuelve una vez.' },
        { step: '03', heading: 'Nexus', body: 'Se crea la base SQLite en .runtime y se aplican las migraciones pendientes.' },
        { step: '04', heading: 'Hooks', body: 'lefthook queda instalado con los hooks de commit y push.' },
      ],
    },

    {
      layout: 'table',
      eyebrow: 'Router',
      title: 'El router decide, y deja decidir el código',
      lead: 'La temperatura y el modelo por defecto están bloqueados por política: no se cambian en caliente.',
      headers: ['Criterio', 'Regla vigente'],
      colW: [3.0, 5.8],
      rows: [
        ['Perfiles', 'cheap, balanced y premium. El activo es balanced.'],
        ['Por dominio', 'premium para finanzas, legal y gobernanza; balanced para marketing, ventas, RRHH y telecom; fastCheap para gitflow, ops y session.'],
        ['Escalamiento', 'Sube de nivel por longitud de entrada, cantidad de ítems o preguntas de diseño arquitectónico o seguridad.'],
        ['Failover', 'Cadena opencode, ollama, lm-studio2, con cache de 5 minutos y modelo de respaldo.'],
        ['Circuito', 'Cinco fallas abren el circuito, dos exitosos lo dejan en half-open.'],
        ['Temperatura', 'Bloqueada por defecto. La modificación por comando no está permitida.'],
        ['Auditoría', 'Cada decisión de ruteo queda en un log de 90 días de retención.'],
      ],
    },

    {
      layout: 'bullets',
      eyebrow: 'Reglas',
      title: 'Lo que no se negocia en este repositorio',
      cols: 2,
      items: [
        { icon: 'eye', heading: 'Procesos invisibles', body: 'Todo spawn pasa por runNpxTsx con windowsHide. Cero ventanas de consola. Hay un test de regresión que lo verifica.' },
        { icon: 'shield', heading: 'Guardrail de destrucción', body: 'No se borra ni sobrescribe masivamente sin confirmación explícita. El snapshot de untracked corre antes de cada operación riesgosa.' },
        { icon: 'tools', heading: 'Solo TypeScript y bash', body: 'La lógica del stack va en TS. PS1 y CMD solo en excepciones sancionadas. No se crean scripts nuevos en PowerShell.' },
        { icon: 'file', heading: 'Documentación con orden', body: 'Resumen, contexto, alcance, fuera de alcance, supuestos, solución, operación, datos, seguridad, plan y anexos. Nunca "TBD".' },
        { icon: 'branch', heading: 'Commits por slice', body: 'Trabajo grande: feature-doc antes del primer write, slices de unas 400 lineas y un commit convencional por slice.' },
        { icon: 'link', heading: 'Frontera revisada', body: 'Tras una revisión aceptada, la siguiente arranca desde el delta y no desde el rango completo.' },
      ],
    },

    {
      layout: 'table',
      eyebrow: 'Referencia',
      title: 'Dónde buscar cada tipo de respuesta',
      lead: 'El conocimiento está versionado. No hace falta preguntar.',
      headers: ['Necesito', 'Ir a'],
      colW: [3.6, 5.2],
      rows: [
        ['La regla vigente del stack', 'AGENTS.md en la raiz del repositorio'],
        ['El detalle de un modulo', 'docs/stack-manual-modules.md'],
        ['La arquitectura completa', 'docs/stack-manual-full.md'],
        ['Cifras generadas del stack', 'docs/generated/STACK-FACTS.md'],
        ['Ejemplos de tareas con agentes y skills', 'docs/use-cases/EXAMPLES.md'],
        ['Plantillas de proyecto, propuesta y contrato', 'docs/templates/gv/'],
        ['Cómo está el design system', 'packages/gv-design-system y docs/brand/'],
        ['El libro de presentaciones interactivo', 'docs/presentations/'],
      ],
    },

    {
      layout: 'closing',
      title: 'Tu primer día',
      body:
        'Instalá, arrancá una sesión y pedí el estado de salud del stack. Después elegí un issue chico y dejá que el flujo inline haga el resto: explorar, implementar y verificar en proporción al riesgo.',
      ctas: [{ label: 'Empezar por setup' }, { label: 'Ver el mapa de comandos' }],
      contacts: [
        'Documentación: AGENTS.md y docs/stack-manual-modules.md',
        'Comando de arranque: npm run setup',
        'Estado de salud: npm run watchtower:health',
      ],
      note: 'Ante cualquier duda sobre una regla del repositorio, la respuesta esta en AGENTS.md o en el manual de stack.',
    },
  ],
};
