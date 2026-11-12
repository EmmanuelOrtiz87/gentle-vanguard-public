/**
 * Set 2 - Enterprise / adopción interna del stack (ES).
 *
 * Audiencia: área de negocio y direccion de tecnologia de una empresa grande
 * (referencia: telecom) que quiere llevar la IA a sus equipos de forma
 * gobernada. Objetivo: explicar que es el stack, que controla, como se adopta
 * por dentro y por que conviene adoptarlo como plataforma y no como una
 * herramienta suelta.
 *
 * Regla editorial: no se inventan clientes, certificaciones, auditorias
 * externas ni cifras de SLA. Todo lo afirmado es verificable en el repositorio.
 */

export default {
  id: 'gv-enterprise-es',
  title: 'GentleVanguard - Capa de orquestación para la IA de su empresa',
  subject: 'Presentación enterprise del stack GentleVanguard',
  footer: 'GentleVanguard - Stack v4.3.0',
  theme: 'hybrid',
  hero: 'enterprise',
  slides: [
    {
      layout: 'cover',
      eyebrow: 'Adopción interna de IA - Stack gobernado',
      title: 'Una capa de orquestación\npara la IA de su empresa',
      titleSize: 30,
      titleH: 1.3,
      subtitle:
        'Un stack local-first que convierte asistentes de IA en capacidad gobernada: con roles definidos, presupuesto de tokens, trazabilidad y auditoría.',
      meta: ['Local first', 'Trazable', 'Portable'],
      versión: 'Stack v4.3.0 - Noviembre 2026',
    },

    {
      layout: 'statement',
      eyebrow: 'Quién lo construye',
      title: 'Quien conoce la IA aplicada en empresas grandes ya lo hizo antes',
      body:
        'Emmanuel Ortiz Gutierrez: arquitecto de software, ingeniero de integración de IA y fundador de GentleVanguard. Más de 15 años construyendo y analizando sistemas para empresas: arquitectura de software e integración de IA en DIRECTV Latin America, consultoría técnica en GlobalLogic y Oracle, y análisis, QA y coordinación de equipos de desarrollo.',
      bodyW: 8.4,
      bodySize: 12,
      stats: [
        { value: 'DIRECTV', label: 'Latin America', sub: 'Arquitectura de software e integración de IA' },
        { value: 'GlobalLogic', label: 'Oracle', sub: 'Consultoría técnica para clientes enterprise' },
        { value: 'UNSJ', label: 'Sistemas de Información', sub: 'Licenciatura en Sistemas de Información' },
      ],
    },

    {
      layout: 'figureLayers',
      eyebrow: 'Qué es',
      title: 'El stack no es un chatbot: es la capa que lo gobierna',
      lead: 'Cada capa resuelve una capa de problemas y deja registro de lo que hizo.',
      textW: 3.3,
      items: [
        { icon: 'agent', heading: 'Un roster de agentes', body: '20 agentes con modelo, permisos, pasos y presupuesto asignados.' },
        { icon: 'brain', heading: 'Capacidades', body: '257 skills reutilizables que se invocan por contexto, no por código.' },
        { icon: 'eye', heading: 'Evidencia', body: 'Sesiones, trazas, eventos y auditoría encadenada por hash.' },
        { icon: 'shield', heading: 'Controles', body: 'Políticas fail-closed, escaneo de secretos y trazabilidad de permisos.' },
      ],
      layers: [
        { label: 'Herramientas', body: 'CLI, IDEs y superficies de producto', accent: '06b6d4' },
        { label: 'Agentes', body: 'Perfiles especializados por runtime', accent: '22d3ee' },
        { label: 'Orquestación', body: 'Contexto, ruteo y pasos', accent: '8b5cf6' },
        { label: 'Conocimiento', body: 'Engram, CodeGraph y Graphify', accent: 'c4b5fd' },
        { label: 'Datos operativos', body: 'Nexus / SQLite, separado', accent: 'fbbf24' },
        { label: 'Calidad y entrega', body: 'Gates, revisión y evidencia', accent: '4ade80' },
      ],
    },

    {
      layout: 'layers',
      eyebrow: 'Anatomía',
      title: 'Nueve capas, cada una con un límite explícito',
      lead: 'La estructura es lo que permite auditar, reemplazar o extender una pieza sin romper el resto.',
      labelW: 1.75,
      items: [
        { label: 'Superficies', body: 'Diez perfiles de herramienta auditados (OpenCode, Codex, ZCode, MiniMax Code, Claude Code, Antigravity, Cursor, Cline, Windsurf y VS Code) sobre el mismo workspace.', accent: '06b6d4' },
        { label: 'Orquestación', body: 'Enrutamiento de modelo y agente, escalado de pasos por complejidad y tabla de ruteo aprendible con 17 dominios y overrides.', accent: '22d3ee' },
        { label: 'Agentes', body: '20 definiciones con permisos y límites de pasos; 29 roles mapeados y 30 bindings de modelo por área y criticalidad.', accent: '8b5cf6' },
        { label: 'Capacidades', body: '257 skills indexadas, con 28 críticas bajo contrato verificado en ejecución real.', accent: 'c4b5fd' },
        { label: 'Conocimiento', body: 'Engram (memoria), CodeGraph (índice incremental), graphify (grafo AST determinista) y Nexus (45 tablas, 24 migraciones, WAL).', accent: 'fbbf24' },
        { label: 'Herramientas', body: 'Diez servidores MCP con acceso uniforme, incluidos dos externos bajo circuito con control de falla.', accent: 'f4bb4f' },
        { label: 'Infraestructura', body: 'Watchtower con 35 componentes vigilados, 6 modos de operación y autoheal.', accent: '4ade80' },
        { label: 'Observabilidad', body: 'Dashboard con trazas reales, health API de 7 componentes, exportación OTLP y alertas configurables.', accent: '22d3ee' },
        { label: 'Aplicaciones', body: '29 apps propias que operan sobre el stack y validan la arquitectura en producción.', accent: '06b6d4' },
      ],
    },

    {
      layout: 'metrics',
      eyebrow: 'Escala',
      title: 'No es un prototipo: es un sistema en uso sostenido',
      lead: 'Cifras verificadas contra el repositorio en la versión 4.3.0.',
      cols: 4,
      items: [
        { value: '800+', label: 'Archivos TS en src/', sub: 'Código propio del stack, con módulos por área', accent: '06b6d4' },
        { value: '552+', label: 'Archivos de test', sub: 'Unit, e2e, integración, seguridad y skills', accent: '8b5cf6' },
        { value: '611+', label: 'Scripts npm', sub: 'Cada operación del stack es un comando auditable', accent: 'fbbf24' },
        { value: '35', label: 'Componentes vigilados', sub: 'Health checks por componente, con autoheal', accent: '22d3ee' },
      ],
    },

    {
      layout: 'cards',
      eyebrow: 'Capacidades',
      title: 'Lo que la empresa recibe al instalar el stack',
      cols: 3,
      items: [
        {
          icon: 'users',
          heading: 'Roles, no personas',
          body: '29 roles mapeados con subagentes primarios y de respaldo, disparadores y skills. La IA deja de ser "la herramienta de Fulano" y pasa a ser un rol con estándar.',
          accent: '06b6d4',
        },
        {
          icon: 'money',
          heading: 'Costo bajo control',
          body: 'Presupuesto diario de 10 millones de tokens, 3 millones por sesión y 100 mil por agente, con enrutamiento por costo, latencia y carga.',
          accent: '8b5cf6',
        },
        {
          icon: 'lock',
          heading: 'Permisos explícitos',
          body: 'Permisos por agente, políticas fail-closed, gateway de seguridad MCP, escaneo de secretos y separación entre datos reconstruibles y no reconstruibles.',
          accent: 'fbbf24',
        },
      ],
    },

    {
      layout: 'flow',
      eyebrow: 'Operación',
      title: 'Cómo se ejecuta una tarea de punta a punta',
      lead: 'El loop no cambia entre un proyecto de una semana y uno de seis meses.',
      items: [
        { icon: 'compass', heading: 'Pre-proceso', body: 'Cada turno inyecta contexto, skills y reglas antes de que el modelo responda.' },
        { icon: 'route', heading: 'Enrutamiento', body: 'El router elige modelo y agente según el dominio, la complejidad y el costo.' },
        { icon: 'tools', heading: 'Ejecución', body: 'El agente trabaja con herramientas reales y deja traza de cada paso.' },
        { icon: 'check', heading: 'Verificación', body: 'Los gates y el revisor cierran el ciclo antes de declarar el trabajo terminado.' },
      ],
    },

    {
      layout: 'bullets',
      eyebrow: 'Gobernanza',
      title: 'Lo que impide que esto sea un experimento sin control',
      cols: 2,
      items: [
        { icon: 'shield', heading: '53 quality gates', body: '19 en pre-commit, 2 en commit-msg, 2 en post-commit, 19 registrados en pre-push, 8 en CI, 1 de gobernanza, 1 de despliegue y 1 en runtime. 49 de 53 aplicados de forma estricta; el gate de alertas Dependabot corre en cada push.' },
        { icon: 'search', heading: 'Escaneo de secretos', body: '80 patrones con filtro de entropía opcional y redacción por defecto, integrado al hook y al watchtower. Tres escáneres independientes conviven.' },
        { icon: 'link', heading: 'Auditoría encadenada', body: 'Event sourcing con prevHash y hash SHA-256 por evento. Detecta mutación accidental o edición inconsistente del registro.' },
        { icon: 'file', heading: 'Trazabilidad de suministro', body: 'SBOM generado y validado, procedencia de artefactos y mapeo documentado contra OWASP Top 10 para agentes.' },
        { icon: 'eye', heading: 'Observabilidad real', body: 'Dashboard sin datos simulados: métricas, trazas, alertas y feedback salen de la operación, no de una maqueta.' },
        { icon: 'database', heading: 'Respaldo y recuperación', body: 'Backup diario programado de la base con 14 copias retenidas, más simulacros de recuperación con RTO y RPO medidos.' },
      ],
    },

    {
      layout: 'compare',
      eyebrow: 'La decisión',
      title: 'Adoptar IA herramienta por herramienta, o con una capa de orquestación',
      lead: 'Es la diferencia entre un contrato de software y una capacidad organizacional.',
      left: {
        head: 'Stack gobernado',
        sub: 'La capacidad queda en la empresa',
        icon: 'shield',
        accent: '06b6d4',
        items: [
          { text: 'Un mismo estándar para todos los equipos, definido en el repositorio.' },
          { text: 'Presupuesto, permisos y límites por rol, no por proveedor de herramienta.' },
          { text: 'Evidencia de cada tarea: traza, eventos y auditoría encadenada.' },
          { text: 'Conocimiento del proceso en la base de la empresa, no en la memoria de un chat.' },
          { text: 'Continuidad: el stack se actualiza y se migra con versionado.' },
          { text: 'Funciona con el proveedor de modelos que la empresa elija o con modelos locales.' },
        ],
      },
      right: {
        head: 'Herramienta por herramienta',
        sub: 'Cada equipo improvisa su propio camino',
        icon: 'cross',
        accent: '8b95a8',
        items: [
          { text: 'Cada herramienta con sus propias reglas, sin estándar compartido.', mark: 'warn' },
          { text: 'Costo invisible hasta que aparece la factura.', mark: 'warn' },
          { text: 'Sin registro de qué hizo el modelo ni con qué datos.', mark: 'cross' },
          { text: 'El conocimiento del proceso se pierde con cada conversación.', mark: 'cross' },
          { text: 'Dependencia del proveedor: cambiar de herramienta es rehacer todo.', mark: 'cross' },
          { text: 'Sin camino de actualización: cada versión nueva es un proyecto.', mark: 'cross' },
        ],
      },
    },

    {
      layout: 'table',
      eyebrow: 'Topología',
      title: 'Dónde vive cada parte, y por qué importa',
      lead: 'La operación es local; la exposición es opcional y reversible.',
      headers: ['Capa', 'Residencia', 'Razón de diseño'],
      colW: [2.6, 2.5, 3.7],
      rows: [
        ['Orquestación y agentes', 'Local, en la máquina del equipo', 'El control del proceso no depende de un servicio externo'],
        ['Base operacional (Nexus)', 'SQLite local en WAL', 'Consulta sin latencia de red y con respaldo programable'],
        ['Memoria y conocimiento', 'Local, con sincronización opcional', 'El contexto organizativo no sale de la máquina por defecto'],
        ['Modelos', 'Proveedor o local', 'Cadena de failover: proveedor, luego Ollama, luego LM Studio'],
        ['Aplicaciones', 'Local o nube según el caso', 'Se exponen por URL cuando hace falta, sin cambiar la lógica'],
        ['Auditoría y trazas', 'Archivos locales versionados', 'Se pueden archivar, enviar a un SIEM o retener según política'],
      ],
    },

    {
      layout: 'metrics',
      eyebrow: 'Economía',
      title: 'El costo de la IA, medido y acotado',
      lead: 'El router decide modelo por costo, latencia y carga. Los presupuestos cortan antes de que el gasto se convierta en sorpresa.',
      cols: 4,
      items: [
        { value: '10M', label: 'Tokens por día', sub: 'Presupuesto global con corte blando al 70 por ciento', accent: '06b6d4' },
        { value: '3M', label: 'Tokens por sesión', sub: 'Techo por sesión de trabajo', accent: '8b5cf6' },
        { value: '100k', label: 'Tokens por agente', sub: 'Cada rol tiene su propio límite', accent: 'fbbf24' },
        { value: '3', label: 'Perfiles de routing', sub: 'cheap, balanced y premium, con failover encadenado', accent: '22d3ee' },
      ],
    },

    {
      layout: 'timeline',
      eyebrow: 'Adopción',
      title: 'Cómo se entra sin romper nada',
      lead: 'Cuatro pasos, cada uno reversible y con su propio criterio de éxito.',
      items: [
        { step: '01', heading: 'Auditar', body: 'Revisar herramientas, skills y permisos ya instalados. El audit no garantiza ejecución, pero sí revela la superficie real.' },
        { step: '02', heading: 'Piloto', body: 'Un área, un proceso, un agente. Con presupuesto de tokens y traza activa desde el primer día.' },
        { step: '03', heading: 'Extender', body: 'Promover lo que funcionó a roles formalizados, con permisos y límites por rol.' },
        { step: '04', heading: 'Governar', body: 'Gates, respaldos, auditoría y actualización del stack incorporados a la rutina operativa.' },
      ],
    },

    {
      layout: 'closing',
      title: 'El siguiente paso es un diagnóstico, no un contrato',
      body:
        'Proponemos una sesión de trabajo para auditar cómo está hoy la IA en su organización y qué parte de esta plataforma se puede adoptar sin fricción. Sin costo y sin compromiso de implementación.',
      ctas: [{ label: 'Solicitar el diagnóstico de stack' }, { label: 'Ver la arquitectura completa' }],
      contacts: [
        'WhatsApp: +54 9 264 545-2221',
        'Correo: gentlevanguard@gmail.com',
        'Emmanuel Ortiz Gutierrez - Arquitecto de Software, Ingeniero de Integración de IA',
      ],
      note: 'El stack es open source. La adopción interna se hace sobre el repositorio y las políticas de la propia empresa.',
    },
  ],
};
