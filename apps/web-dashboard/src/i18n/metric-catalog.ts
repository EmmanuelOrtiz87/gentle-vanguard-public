export type Locale = 'en' | 'es' | 'pt-BR';

export interface MetricInfo {
  label: string;
  description: string;
  what: string;
  how: string;
}

export const TRANSLATIONS: Record<Locale, Record<string, MetricInfo>> = {
  en: {
    tokens_used: {
      label: 'Tokens Used',
      description: 'Total LLM tokens consumed across all sessions',
      what: 'Tokens are the basic units of text that LLMs process. One token ≈ 0.75 words in English. This metric tracks both input (prompts) and output (responses) tokens across all model calls.',
      how: 'Aggregated from .session/context-log/*/.state.json files. Each trace records inputTokens and outputTokens per model call. The limit is configured in dashboard-alerts.json.',
    },
    active_sessions: {
      label: 'Active Sessions',
      description: 'Currently active agent sessions',
      what: 'A session represents a continuous interaction with an AI agent (DEV, BA, QA, etc.). Active sessions are those currently running, idle sessions are paused, and completed sessions are finished.',
      how: 'Tracked via the shared state bridge from .event-bus/sessions-history.json. Sessions are created when an agent is invoked and marked complete when the agent finishes.',
    },
    latency: {
      label: 'Latency (avg)',
      description: 'Average LLM response time',
      what: 'Measures how long the LLM takes to generate a response. Lower latency means faster responses. P50 is the median, P95 means 95% of requests are faster than this value, useful for identifying slow outliers.',
      how: 'Calculated from trace durations in .session/context-log/*/.state.json. Duration is the wall-clock time from request start to response completion.',
    },
    health: {
      label: 'Health Status',
      description: 'Overall system health',
      what: 'Aggregate health of all system components: backend server, WebSocket connections, MCP bridge, and repository CI status.',
      how: 'Routing rate shows what fraction of requests are successfully processed. Components report healthy/degraded/down status based on response times and error rates.',
    },
    total_cost: {
      label: 'Total Cost',
      description: 'Aggregated LLM API cost across all models',
      what: 'Total estimated cost of all LLM API calls. Calculated per-model using token counts × model pricing rates. The top model shows which model contributed the most cost.',
      how: 'Cost = (inputTokens × inputPrice + outputTokens × outputPrice) / 1,000,000. Prices are defined in MODEL_PRICING inside the real-data pipeline.',
    },
    feedback: {
      label: 'Feedback Score',
      description: 'User satisfaction score from feedback',
      what: 'Percentage of positive feedback (thumbs up) out of total feedback votes. A score above 80% indicates high user satisfaction.',
      how: 'Collected via the thumbs up/down buttons on each trace. Stored in tenant-scoped SQLite feedback. Score = thumbsUp / (thumbsUp + thumbsDown) × 100.',
    },
    sla: {
      label: 'SLA Compliance',
      description: 'Service Level Agreement compliance rate',
      what: 'Percentage of time the system meets its uptime and performance targets. SLO (Service Level Objective) is the internal target (99.9%). Incidents track SLA breaches.',
      how: 'Uptime is calculated from the system process uptime. SLO compliance compares against the 99.9% target. Incidents are tracked when downtime or severe degradation occurs.',
    },
    system: {
      label: 'System',
      description: 'Server resource usage',
      what: 'Real-time server metrics: memory (RSS = Resident Set Size, actual RAM used), CPU time (user + system), and process uptime since last start.',
      how: 'Collected from the running WebSocket server process via process.memoryUsage() and process.cpuUsage(). Updated every metrics broadcast cycle.',
    },
    cost_by_model: {
      label: 'Cost by Model',
      description: 'Cost breakdown per LLM model',
      what: "Shows how much each AI model contributes to total cost. Models like big-pickle, claude-sonnet-4, and qwen-3.6-plus have different pricing. The % column shows each model's share of total cost.",
      how: 'Aggregated from trace data. Each model call records input/output tokens and calculates cost using the pricing table. Models with unknown names use a default rate.',
    },
    cost_insights: {
      label: 'Cost Optimization Insights',
      description: 'Recommendations to reduce LLM costs',
      what: 'Compares actual cost vs estimated cost to identify optimization opportunities. A high savings percentage means the model is performing well below its estimated maximum cost.',
      how: 'Estimated cost = (totalTokens / 1,000,000) × modelRate. Actual cost uses detailed input/output pricing. Models >5% of total cost are shown with optimization tips.',
    },
    latency_percentiles: {
      label: 'Latency Percentiles',
      description: 'Response time distribution',
      what: 'Shows the full distribution of LLM response times. Avg is the mean, P50 is the median (50% of requests are faster), P95 (95% faster), P99 (99% faster), and Max is the slowest request.',
      how: 'Calculated from all trace durations. Values are sorted and percentiles are picked at the corresponding index. Progress bars show relative size compared to the max value.',
    },
    sla_reliability: {
      label: 'SLA & Reliability',
      description: 'Service availability and incident tracking',
      what: 'Uptime is the percentage of time the system has been available. SLO Compliance compares against the 99.9% target. Incidents are periods when the system was unavailable or degraded.',
      how: 'Uptime = system uptime / elapsed time since monitoring started. SLO compliance checks if we meet the 99.9% threshold. Incidents are recorded when health checks fail.',
    },
    mcp: {
      label: 'MCP Server Metrics',
      description: 'Model Context Protocol server usage',
      what: 'MCP (Model Context Protocol) allows LLMs to interact with external tools and skills. Skills are available actions, calls are invocations, and avg response time is how fast skills execute.',
      how: 'Data from .atl/skill-stats.json. Tracks total skills registered, calls made per tool/skill, and performance metrics. The MCP bridge manages the connection to the skill registry.',
    },
    agent_activity: {
      label: 'Agent Activity',
      description: 'Recent AI agent interactions',
      what: "Shows the most recent messages from active agent sessions. Agents include DEV (development), BA (business analysis), QA (testing), and others. Each message shows the agent's role and content.",
      how: 'Live stream from the shared state bridge. Messages are pushed via WebSocket as agents process requests. Only the last 5 messages are shown per session.',
    },
    skill_usage: {
      label: 'Skill Usage',
      description: 'Top skills by usage count from SQLite',
      what: 'Shows which AI skills are being used most frequently, their token consumption, and associated costs. Skills are registered tools and capabilities available to the agent system.',
      how: 'Data from the skill_usage table in SQLite. Aggregated by skill_id with total count, tokens_used, and cost. Updated in real-time as skills are invoked.',
    },
    token_usage: {
      label: 'Token Usage',
      description: 'Token consumption per session from SQLite',
      what: 'Detailed breakdown of token usage across sessions, showing prompt tokens, completion tokens, cost, and last usage time per session.',
      how: 'Data from the token_usage table in SQLite. Grouped by session_id with SUM of prompt_tokens, completion_tokens, and cost. Sorted by most recently used.',
    },
    contract_results: {
      label: 'Contract Results',
      description: 'SDD contract validation results from SQLite',
      what: 'Validation results from Spec-Driven Development contracts. Each contract validates a specific requirement or constraint, with pass/fail status and optional quality score.',
      how: 'Data from the contract_results table in SQLite. Shows the latest contract validations with their result status and score percentage.',
    },
    routing_rules: {
      label: 'Routing Rules',
      description: 'Adaptive routing rules from SQLite',
      what: 'Rules that determine how agent requests are routed to different handlers or models. Priority determines rule precedence, hit count shows how often each rule is matched.',
      how: 'Data from the routing_rules table in SQLite. Only enabled rules are shown, ordered by priority and hit count.',
    },
    swarm_workers: {
      label: 'Swarm Workers',
      description: 'Parallel worker executions dispatched by the orchestrator',
      what: 'Each card is a worker process spawned to execute a task in parallel (skill, script or subagent). Shows status (running/completed/failed/timeout), duration, exit code and its console output or error.',
      how: 'Fed by the swarm dispatcher state persisted under .session/ and broadcast through the WebSocket live stream. Counts derive from active/completed/failed tallies reported by the watchdog.',
    },
    stack_capabilities: {
      label: 'Stack Capabilities',
      description: 'Autonomous resilience: anomaly detection, circuit breakers and DB healing',
      what: 'Aggregates three self-healing subsystems: detected anomalies (with confidence score and auto-heal flag), circuit breaker states (CLOSED/HALF_OPEN/OPEN) and Nexus SQLite maintenance stats (vacuum, reindex, prune).',
      how: 'Data comes from the maintenance watchtower health cycle and DatabaseManager telemetry in .runtime/gentle-vanguard.db, pushed live via WebSocket.',
    },
    slo_metrics: {
      label: 'Performance SLO',
      description: 'Service Level Objectives for latency, memory and disk',
      what: 'Shows each SLO check with its current value vs threshold (disk usage, memory RSS, p95 latency, error budget burn rate) and a PASS/WARN/FAIL verdict, plus per-window burn rates.',
      how: 'Generated by npm run perf:slo and the native burn-rate endpoint over metric_snapshots in Nexus (.runtime/gentle-vanguard.db); refreshed every 15 seconds.',
    },
    tracing: {
      label: 'Live Traces',
      description: 'Real-time stream of distributed trace spans',
      what: 'Lists recent traces (one per turn/model call) with a status dot, turn count, model used and elapsed time since the span started.',
      how: 'Spans are written by src/tracing-instrument.ts to .telemetry/spans and streamed to the dashboard through the WebSocket broadcast cycle.',
    },
    marketplace: {
      label: 'Skill Marketplace',
      description: 'Catalog of installable skills with governance controls',
      what: 'Browse available skill packages, inspect popularity metrics and install or remove them from the agent registry. Includes catalog governance status.',
      how: 'Backed by the skill registry API plus usage counters from the skill_usage table in Nexus (.runtime/gentle-vanguard.db).',
    },
    content_ops: {
      label: 'Content Operations',
      description: 'Publishing pipeline for multi-platform content',
      what: 'Tracks content jobs across platforms: calendar view, kanban columns grouped by status and package previews ready to publish.',
      how: 'Jobs come from the content ops queue persisted under .session/content-ops/ and exposed through the dashboard REST API.',
    },
    audit: {
      label: 'Audit Log',
      description: 'Hash-chained audit trail of session events',
      what: 'Chronological viewer of audit events written by the audit pipeline: commands, file changes and delegations, protected by a SHA-256 hash chain.',
      how: 'Reads daily JSONL files from .session/audit/logs/ as they are appended by src/infrastructure/audit-pipeline.ts.',
    },
    knowledge: {
      label: 'Knowledge Base',
      description: 'Persistent memory and absorbed documentation',
      what: 'Surfaces knowledge stored as Engram observations, ADR decisions and graphify wiki pages so agents can recall past work.',
      how: 'Combines the Engram store, docs/adr/*.md files and graphify-out/wiki/index.md generated from the codegraph snapshot.',
    },
    validations: {
      label: 'Live Validations',
      description: 'Real-time contract and health validation feed',
      what: 'Streams validation events (ok/warn/error) emitted while pipelines and SDD contracts run, including the checked value when available.',
      how: 'Events arrive over WebSocket from the validation runner; the panel seeds initially from GET /api/validations before the live stream takes over.',
    },
  },
  es: {
    tokens_used: {
      label: 'Tokens Usados',
      description: 'Total de tokens de LLM consumidos en todas las sesiones',
      what: 'Los tokens son las unidades básicas de texto que procesan los LLM. Un token ≈ 0.75 palabras en español. Esta métrica rastrea tokens de entrada (prompts) y salida (respuestas) en todas las llamadas.',
      how: 'Agregado desde archivos .session/context-log/*/.state.json. Cada traza registra inputTokens y outputTokens por llamada. El límite se configura en dashboard-alerts.json.',
    },
    active_sessions: {
      label: 'Sesiones Activas',
      description: 'Sesiones de agente actualmente activas',
      what: 'Una sesión representa una interacción continua con un agente de IA (DEV, BA, QA, etc.). Las sesiones activas están ejecutándose, las inactivas están en pausa y las completadas han finalizado.',
      how: 'Rastreadas vía el puente de estado compartido desde .event-bus/sessions-history.json. Las sesiones se crean cuando se invoca un agente y se marcan como completadas cuando finaliza.',
    },
    latency: {
      label: 'Latencia (prom)',
      description: 'Tiempo de respuesta promedio del LLM',
      what: 'Mide cuánto tarda el LLM en generar una respuesta. Menor latencia significa respuestas más rápidas. P50 es la mediana, P95 significa que el 95% de las solicitudes son más rápidas que este valor.',
      how: 'Calculado desde las duraciones de trazas en .session/context-log/*/.state.json. La duración es el tiempo real desde el inicio de la solicitud hasta la finalización de la respuesta.',
    },
    health: {
      label: 'Estado de Salud',
      description: 'Salud general del sistema',
      what: 'Estado agregado de todos los componentes: servidor backend, conexiones WebSocket, puente MCP y estado CI del repositorio.',
      how: 'La tasa de enrutamiento muestra qué fracción de solicitudes se procesan exitosamente. Los componentes reportan estado saludable/degradado/caído según tiempos de respuesta y tasas de error.',
    },
    total_cost: {
      label: 'Costo Total',
      description: 'Costo total estimado de API LLM en todos los modelos',
      what: 'Costo estimado total de todas las llamadas a la API LLM. Calculado por modelo usando conteo de tokens × tarifas del modelo. El modelo superior muestra cuál modelo contribuyó más al costo.',
      how: 'Costo = (inputTokens × precioInput + outputTokens × precioOutput) / 1,000,000. Los precios se definen en MODEL_PRICING dentro del pipeline de datos reales.',
    },
    feedback: {
      label: 'Puntuación de Feedback',
      description: 'Puntuación de satisfacción del usuario',
      what: 'Porcentaje de feedback positivo (pulgar arriba) del total de votos. Una puntuación superior al 80% indica alta satisfacción del usuario.',
      how: 'Recolectado mediante botones de pulgar arriba/abajo en cada traza. Almacenado en SQLite con tenant. Puntuación = thumbsUp / (thumbsUp + thumbsDown) × 100.',
    },
    sla: {
      label: 'Cumplimiento SLA',
      description: 'Tasa de cumplimiento del Acuerdo de Nivel de Servicio',
      what: 'Porcentaje de tiempo que el sistema cumple sus objetivos de disponibilidad y rendimiento. SLO es el objetivo interno (99.9%). Los incidentes rastrean violaciones del SLA.',
      how: 'La disponibilidad se calcula desde el tiempo de actividad del proceso del sistema. El cumplimiento SLO se compara contra el objetivo del 99.9%. Los incidentes se registran cuando hay caídas o degradación severa.',
    },
    system: {
      label: 'Sistema',
      description: 'Uso de recursos del servidor',
      what: 'Métricas del servidor en tiempo real: memoria (RSS = tamaño de conjunto residente, RAM real usada), tiempo de CPU (usuario + sistema) y tiempo de actividad desde el último inicio.',
      how: 'Recolectado del proceso del servidor WebSocket mediante process.memoryUsage() y process.cpuUsage(). Actualizado en cada ciclo de transmisión de métricas.',
    },
    cost_by_model: {
      label: 'Costo por Modelo',
      description: 'Desglose de costo por modelo LLM',
      what: 'Muestra cuánto contribuye cada modelo de IA al costo total. Modelos como big-pickle, claude-sonnet-4 y qwen-3.6-plus tienen diferentes precios. La columna % muestra la participación de cada modelo.',
      how: 'Agregado desde datos de trazas. Cada llamada registra tokens de entrada/salida y calcula el costo usando la tabla de precios. Los modelos con nombres desconocidos usan una tarifa por defecto.',
    },
    cost_insights: {
      label: 'Perspectivas de Optimización de Costos',
      description: 'Recomendaciones para reducir costos de LLM',
      what: 'Compara el costo real vs el estimado para identificar oportunidades de optimización. Un alto porcentaje de ahorro significa que el modelo está rindiendo muy por debajo de su costo máximo estimado.',
      how: 'Costo estimado = (totalTokens / 1,000,000) × tarifaModelo. El costo real usa precios detallados de entrada/salida. Los modelos con >5% del costo total se muestran con consejos de optimización.',
    },
    latency_percentiles: {
      label: 'Percentiles de Latencia',
      description: 'Distribución de tiempos de respuesta',
      what: 'Muestra la distribución completa de tiempos de respuesta del LLM. El promedio es la media, P50 es la mediana (50% de solicitudes son más rápidas), P95 (95% más rápidas), P99 (99% más rápidas) y Máx es la más lenta.',
      how: 'Calculado de todas las duraciones de trazas. Los valores se ordenan y los percentiles se toman en el índice correspondiente. Las barras de progreso muestran el tamaño relativo al valor máximo.',
    },
    sla_reliability: {
      label: 'SLA y Confiabilidad',
      description: 'Disponibilidad del servicio y registro de incidentes',
      what: 'La disponibilidad es el porcentaje de tiempo que el sistema ha estado disponible. El cumplimiento SLO se compara contra el objetivo del 99.9%. Los incidentes son períodos de indisponibilidad o degradación.',
      how: 'Disponibilidad = tiempo activo del sistema / tiempo transcurrido desde que comenzó el monitoreo. El cumplimiento SLO verifica si se cumple el umbral del 99.9%. Los incidentes se registran cuando fallan las verificaciones de salud.',
    },
    mcp: {
      label: 'Métricas del Servidor MCP',
      description: 'Uso del servidor de Protocolo de Contexto de Modelo',
      what: 'MCP (Model Context Protocol) permite a los LLM interactuar con herramientas y habilidades externas. Las habilidades son acciones disponibles, las llamadas son invocaciones, y el tiempo de respuesta promedio es qué tan rápido se ejecutan.',
      how: 'Datos de .atl/skill-stats.json. Rastrea habilidades totales registradas, llamadas por herramienta/habilidad y métricas de rendimiento. El puente MCP gestiona la conexión con el registro de habilidades.',
    },
    agent_activity: {
      label: 'Actividad del Agente',
      description: 'Interacciones recientes del agente de IA',
      what: 'Muestra los mensajes más recientes de sesiones de agente activas. Los agentes incluyen DEV (desarrollo), BA (análisis de negocio), QA (pruebas) y otros. Cada mensaje muestra el rol del agente y su contenido.',
      how: 'Transmisión en vivo desde el puente de estado compartido. Los mensajes se envían vía WebSocket mientras los agentes procesan solicitudes. Solo se muestran los últimos 5 mensajes por sesión.',
    },
    skill_usage: {
      label: 'Uso de Skills',
      description: 'Skills principales por uso desde SQLite',
      what: 'Muestra qué skills de IA se usan con más frecuencia, su consumo de tokens y costos asociados. Las skills son herramientas y capacidades registradas disponibles para el sistema de agentes.',
      how: 'Datos de la tabla skill_usage en SQLite. Agregados por skill_id con conteo total, tokens_usados y costo. Actualizado en tiempo real a medida que se invocan skills.',
    },
    token_usage: {
      label: 'Uso de Tokens',
      description: 'Consumo de tokens por sesión desde SQLite',
      what: 'Desglose detallado del uso de tokens entre sesiones, mostrando tokens de prompt, tokens de completion, costo y última vez que se usó.',
      how: 'Datos de la tabla token_usage en SQLite. Agrupados por session_id con SUM de prompt_tokens, completion_tokens y costo. Ordenados por más reciente.',
    },
    contract_results: {
      label: 'Resultados de Contratos',
      description: 'Resultados de validación de contratos SDD desde SQLite',
      what: 'Resultados de validación de contratos de Spec-Driven Development. Cada contrato valida un requisito o restricción específica, con estado de aprobación/rechazo y puntuación de calidad opcional.',
      how: 'Datos de la tabla contract_results en SQLite. Muestra las validaciones de contrato más recientes con su estado y porcentaje de puntuación.',
    },
    routing_rules: {
      label: 'Reglas de Enrutamiento',
      description: 'Reglas de enrutamiento adaptativo desde SQLite',
      what: 'Reglas que determinan cómo se enrutan las solicitudes de agentes a diferentes manejadores o modelos. La prioridad determina la precedencia de la regla, el conteo de aciertos muestra la frecuencia de coincidencia.',
      how: 'Datos de la tabla routing_rules en SQLite. Solo se muestran reglas habilitadas, ordenadas por prioridad y conteo de aciertos.',
    },
    swarm_workers: {
      label: 'Workers del Swarm',
      description: 'Ejecuciones paralelas de workers despachadas por el orquestador',
      what: 'Cada tarjeta es un proceso worker lanzado para ejecutar una tarea en paralelo (skill, script o subagente). Muestra estado (en ejecución/completado/fallido/timeout), duración, código de salida y su salida de consola o error.',
      how: 'Alimentado por el estado del dispatcher del swarm persistido en .session/ y transmitido vía WebSocket en vivo. Los conteos derivan de los totales activos/completados/fallidos reportados por el watchdog.',
    },
    stack_capabilities: {
      label: 'Capacidades del Stack',
      description:
        'Resiliencia autónoma: detección de anomalías, circuit breakers y reparación de BD',
      what: 'Agrega tres subsistemas de auto-reparación: anomalías detectadas (con puntuación de confianza y bandera de auto-reparación), estados de circuit breakers (CLOSED/HALF_OPEN/OPEN) y estadísticas de mantenimiento del SQLite de Nexus (vacuum, reindex, prune).',
      how: 'Los datos provienen del ciclo de salud de la watchtower de mantenimiento y la telemetría del DatabaseManager en .runtime/gentle-vanguard.db, enviados en vivo vía WebSocket.',
    },
    slo_metrics: {
      label: 'SLO de Rendimiento',
      description: 'Objetivos de Nivel de Servicio para latencia, memoria y disco',
      what: 'Muestra cada check SLO con su valor actual vs umbral (uso de disco, memoria RSS, latencia p95, tasa de consumo del presupuesto de errores) y un veredicto PASS/WARN/FAIL, más tasas de consumo por ventana.',
      how: 'Generado por npm run perf:slo y el endpoint nativo de burn-rate sobre metric_snapshots en Nexus (.runtime/gentle-vanguard.db); actualizado cada 15 segundos.',
    },
    tracing: {
      label: 'Trazas en Vivo',
      description: 'Transmisión en tiempo real de spans de trazas distribuidas',
      what: 'Lista las trazas recientes (una por turno/llamada al modelo) con punto de estado, conteo de turnos, modelo usado y tiempo transcurrido desde el inicio del span.',
      how: 'Los spans son escritos por src/tracing-instrument.ts en .telemetry/spans y transmitidos al dashboard mediante el ciclo de difusión WebSocket.',
    },
    marketplace: {
      label: 'Marketplace de Skills',
      description: 'Catálogo de skills instalables con controles de gobernanza',
      what: 'Explora los paquetes de skills disponibles, inspecciona métricas de popularidad e instálalos o elimínalos del registro de agentes. Incluye el estado de gobernanza del catálogo.',
      how: 'Respaldado por la API del registro de skills más contadores de uso de la tabla skill_usage en Nexus (.runtime/gentle-vanguard.db).',
    },
    content_ops: {
      label: 'Operaciones de Contenido',
      description: 'Pipeline de publicación de contenido multiplataforma',
      what: 'Rastrea los trabajos de contenido entre plataformas: vista de calendario, columnas kanban agrupadas por estado y vistas previas de paquetes listos para publicar.',
      how: 'Los trabajos provienen de la cola de content ops persistida en .session/content-ops/ y expuesta mediante la API REST del dashboard.',
    },
    audit: {
      label: 'Registro de Auditoría',
      description: 'Pista de auditoría encadenada por hash de eventos de sesión',
      what: 'Visor cronológico de eventos de auditoría escritos por el pipeline de auditoría: comandos, cambios de archivos y delegaciones, protegidos por una cadena hash SHA-256.',
      how: 'Lee archivos JSONL diarios de .session/audit/logs/ a medida que son escritos por src/infrastructure/audit-pipeline.ts.',
    },
    knowledge: {
      label: 'Base de Conocimiento',
      description: 'Memoria persistente y documentación absorbida',
      what: 'Expone el conocimiento almacenado como observaciones de Engram, decisiones ADR y páginas wiki de graphify para que los agentes recuerden trabajo previo.',
      how: 'Combina el store de Engram, los archivos docs/adr/*.md y graphify-out/wiki/index.md generado desde el snapshot del codegraph.',
    },
    validations: {
      label: 'Validaciones en Vivo',
      description: 'Flujo en tiempo real de validaciones de contratos y salud',
      what: 'Transmite eventos de validación (ok/warn/error) emitidos mientras corren pipelines y contratos SDD, incluyendo el valor verificado cuando está disponible.',
      how: 'Los eventos llegan vía WebSocket desde el runner de validaciones; el panel se inicia inicialmente desde GET /api/validations antes de que tome el control el stream en vivo.',
    },
  },
  'pt-BR': {
    tokens_used: {
      label: 'Tokens Usados',
      description: 'Total de tokens LLM consumidos em todas as sessões',
      what: 'Tokens são as unidades básicas de texto que os LLMs processam. Um token ≈ 0,75 palavras em português. Esta métrica rastreia tokens de entrada (prompts) e saída (respostas) em todas as chamadas.',
      how: 'Agregado dos arquivos .session/context-log/*/.state.json. Cada trace registra inputTokens e outputTokens por chamada de modelo. O limite é configurado no dashboard-alerts.json.',
    },
    active_sessions: {
      label: 'Sessões Ativas',
      description: 'Sessões de agente atualmente ativas',
      what: 'Uma sessão representa uma interação contínua com um agente de IA (DEV, BA, QA, etc.). Sessões ativas estão em execução, inativas estão pausadas e concluídas foram finalizadas.',
      how: 'Rastreadas via ponte de estado compartilhado do .event-bus/sessions-history.json. Sessões são criadas quando um agente é invocado e marcadas como concluídas quando o agente termina.',
    },
    latency: {
      label: 'Latência (média)',
      description: 'Tempo médio de resposta do LLM',
      what: 'Mede quanto tempo o LLM leva para gerar uma resposta. Menor latência significa respostas mais rápidas. P50 é a mediana, P95 significa que 95% das requisições são mais rápidas que este valor.',
      how: 'Calculado a partir das durações dos traces em .session/context-log/*/.state.json. A duração é o tempo real desde o início da requisição até a conclusão da resposta.',
    },
    health: {
      label: 'Status de Saúde',
      description: 'Saúde geral do sistema',
      what: 'Estado agregado de todos os componentes: servidor backend, conexões WebSocket, ponte MCP e status CI do repositório.',
      how: 'A taxa de roteamento mostra qual fração das requisições são processadas com sucesso. Componentes reportam status saudável/degradado/inativo baseado em tempos de resposta e taxas de erro.',
    },
    total_cost: {
      label: 'Custo Total',
      description: 'Custo total estimado de API LLM em todos os modelos',
      what: 'Custo estimado total de todas as chamadas de API LLM. Calculado por modelo usando contagem de tokens × taxas do modelo. O modelo principal mostra qual modelo mais contribuiu para o custo.',
      how: 'Custo = (inputTokens × preçoInput + outputTokens × preçoOutput) / 1.000.000. Os preços são definidos no MODEL_PRICING dentro do pipeline de dados reais.',
    },
    feedback: {
      label: 'Pontuação de Feedback',
      description: 'Pontuação de satisfação do usuário',
      what: 'Percentual de feedback positivo (polegar para cima) do total de votos. Uma pontuação acima de 80% indica alta satisfação do usuário.',
      how: 'Coletado através dos botões de polegar para cima/baixo em cada trace. Armazenado em SQLite com tenant. Pontuação = thumbsUp / (thumbsUp + thumbsDown) × 100.',
    },
    sla: {
      label: 'Conformidade SLA',
      description: 'Taxa de conformidade do Acordo de Nível de Serviço',
      what: 'Percentual de tempo que o sistema atende suas metas de disponibilidade e desempenho. SLO é a meta interna (99,9%). Incidentes rastreiam violações de SLA.',
      how: 'Disponibilidade é calculada a partir do tempo de atividade do processo do sistema. Conformidade SLO compara contra a meta de 99,9%. Incidentes são registrados quando ocorrem falhas ou degradação severa.',
    },
    system: {
      label: 'Sistema',
      description: 'Uso de recursos do servidor',
      what: 'Métricas do servidor em tempo real: memória (RSS = Resident Set Size, RAM real usada), tempo de CPU (usuário + sistema) e tempo de atividade desde a última inicialização.',
      how: 'Coletado do processo do servidor WebSocket via process.memoryUsage() e process.cpuUsage(). Atualizado a cada ciclo de transmissão de métricas.',
    },
    cost_by_model: {
      label: 'Custo por Modelo',
      description: 'Detalhamento de custo por modelo LLM',
      what: 'Mostra quanto cada modelo de IA contribui para o custo total. Modelos como big-pickle, claude-sonnet-4 e qwen-3.6-plus têm preços diferentes. A coluna % mostra a participação de cada modelo.',
      how: 'Agregado dos dados de traces. Cada chamada de modelo registra tokens de entrada/saída e calcula o custo usando a tabela de preços. Modelos com nomes desconhecidos usam uma taxa padrão.',
    },
    cost_insights: {
      label: 'Insights de Otimização de Custos',
      description: 'Recomendações para reduzir custos de LLM',
      what: 'Compara o custo real vs o estimado para identificar oportunidades de otimização. Uma alta porcentagem de economia significa que o modelo está performando muito abaixo de seu custo máximo estimado.',
      how: 'Custo estimado = (totalTokens / 1.000.000) × taxaModelo. O custo real usa preços detalhados de entrada/saída. Modelos com >5% do custo total são mostrados com dicas de otimização.',
    },
    latency_percentiles: {
      label: 'Percentis de Latência',
      description: 'Distribuição dos tempos de resposta',
      what: 'Mostra a distribuição completa dos tempos de resposta do LLM. A média é a média aritmética, P50 é a mediana (50% das requisições são mais rápidas), P95 (95% mais rápidas), P99 (99% mais rápidas) e Máx é a mais lenta.',
      how: 'Calculado a partir de todas as durações de traces. Os valores são ordenados e os percentis são selecionados no índice correspondente. As barras de progresso mostram o tamanho relativo ao valor máximo.',
    },
    sla_reliability: {
      label: 'SLA e Confiabilidade',
      description: 'Disponibilidade do serviço e registro de incidentes',
      what: 'A disponibilidade é a porcentagem de tempo que o sistema esteve disponível. A conformidade SLO é comparada com a meta de 99,9%. Incidentes são períodos de indisponibilidade ou degradação.',
      how: 'Disponibilidade = tempo ativo do sistema / tempo decorrido desde o início do monitoramento. Conformidade SLO verifica se atingimos o limite de 99,9%. Incidentes são registrados quando as verificações de saúde falham.',
    },
    mcp: {
      label: 'Métricas do Servidor MCP',
      description: 'Uso do servidor de Protocolo de Contexto de Modelo',
      what: 'MCP (Model Context Protocol) permite que LLMs interajam com ferramentas e habilidades externas. Habilidades são ações disponíveis, chamadas são invocações, e o tempo médio de resposta é a rapidez da execução.',
      how: 'Dados de .atl/skill-stats.json. Rastreia total de habilidades registradas, chamadas por ferramenta/habilidade e métricas de desempenho. A ponte MCP gerencia a conexão com o registro de habilidades.',
    },
    agent_activity: {
      label: 'Atividade do Agente',
      description: 'Interações recentes do agente de IA',
      what: 'Mostra as mensagens mais recentes de sessões de agente ativas. Agentes incluem DEV (desenvolvimento), BA (análise de negócios), QA (testes) e outros. Cada mensagem mostra o papel do agente e seu conteúdo.',
      how: 'Transmissão ao vivo da ponte de estado compartilhado. Mensagens são enviadas via WebSocket enquanto agentes processam requisições. Apenas as últimas 5 mensagens são mostradas por sessão.',
    },
    skill_usage: {
      label: 'Uso de Skills',
      description: 'Principais skills por uso do SQLite',
      what: 'Mostra quais skills de IA estão sendo usadas com mais frequência, seu consumo de tokens e custos associados. Skills são ferramentas e capacidades registradas disponíveis para o sistema de agentes.',
      how: 'Dados da tabela skill_usage no SQLite. Agregados por skill_id com contagem total, tokens_usados e custo. Atualizado em tempo real conforme skills são invocadas.',
    },
    token_usage: {
      label: 'Uso de Tokens',
      description: 'Consumo de tokens por sessão do SQLite',
      what: 'Detalhamento do uso de tokens entre sessões, mostrando tokens de prompt, tokens de completion, custo e última vez utilizado.',
      how: 'Dados da tabela token_usage no SQLite. Agrupados por session_id com SUM de prompt_tokens, completion_tokens e custo. Ordenados por mais recente.',
    },
    contract_results: {
      label: 'Resultados de Contratos',
      description: 'Resultados de validação de contratos SDD do SQLite',
      what: 'Resultados de validação de contratos de Spec-Driven Development. Cada contrato valida um requisito ou restrição específica, com status de aprovação/rejeição e pontuação de qualidade opcional.',
      how: 'Dados da tabela contract_results no SQLite. Mostra as validações de contrato mais recentes com seu status e percentual de pontuação.',
    },
    routing_rules: {
      label: 'Regras de Roteamento',
      description: 'Regras de roteamento adaptativo do SQLite',
      what: 'Regras que determinam como as solicitações de agentes são roteadas para diferentes manipuladores ou modelos. A prioridade determina a precedência da regra, a contagem de acertos mostra a frequência de correspondência.',
      how: 'Dados da tabela routing_rules no SQLite. Apenas regras habilitadas são mostradas, ordenadas por prioridade e contagem de acertos.',
    },
    swarm_workers: {
      label: 'Workers do Swarm',
      description: 'Execuções paralelas de workers despachadas pelo orquestrador',
      what: 'Cada cartão é um processo worker criado para executar uma tarefa em paralelo (skill, script ou subagente). Mostra status (em execução/concluído/falhou/timeout), duração, código de saída e sua saída de console ou erro.',
      how: 'Alimentado pelo estado do dispatcher do swarm persistido em .session/ e transmitido via WebSocket ao vivo. As contagens derivam dos totais ativos/concluídos/falidos reportados pelo watchdog.',
    },
    stack_capabilities: {
      label: 'Capacidades do Stack',
      description:
        'Resiliência autônoma: detecção de anomalias, circuit breakers e reparação do BD',
      what: 'Agrega três subsistemas de auto-reparação: anomalias detectadas (com pontuação de confiança e flag de auto-reparação), estados de circuit breakers (CLOSED/HALF_OPEN/OPEN) e estatísticas de manutenção do SQLite do Nexus (vacuum, reindex, prune).',
      how: 'Os dados vêm do ciclo de saúde da watchtower de manutenção e da telemetria do DatabaseManager em .runtime/gentle-vanguard.db, enviados ao vivo via WebSocket.',
    },
    slo_metrics: {
      label: 'SLO de Desempenho',
      description: 'Objetivos de Nível de Serviço para latência, memória e disco',
      what: 'Mostra cada check SLO com seu valor atual vs limiar (uso de disco, memória RSS, latência p95, taxa de consumo do orçamento de erros) e um veredito PASS/WARN/FAIL, além de taxas de consumo por janela.',
      how: 'Gerado por npm run perf:slo e o endpoint nativo de burn-rate sobre metric_snapshots no Nexus (.runtime/gentle-vanguard.db); atualizado a cada 15 segundos.',
    },
    tracing: {
      label: 'Rastros ao Vivo',
      description: 'Transmissão em tempo real de spans de rastros distribuídos',
      what: 'Lista os rastros recentes (um por turno/chamada de modelo) com ponto de status, contagem de turnos, modelo usado e tempo decorrido desde o início do span.',
      how: 'Os spans são escritos por src/tracing-instrument.ts em .telemetry/spans e transmitidos ao dashboard pelo ciclo de broadcast WebSocket.',
    },
    marketplace: {
      label: 'Marketplace de Skills',
      description: 'Catálogo de skills instaláveis com controles de governança',
      what: 'Navegue pelos pacotes de skills disponíveis, inspecione métricas de popularidade e instale-os ou remova-os do registro de agentes. Inclui o status de governança do catálogo.',
      how: 'Suportado pela API do registro de skills mais contadores de uso da tabela skill_usage no Nexus (.runtime/gentle-vanguard.db).',
    },
    content_ops: {
      label: 'Operações de Conteúdo',
      description: 'Pipeline de publicação de conteúdo multiplataforma',
      what: 'Rastreia os trabalhos de conteúdo entre plataformas: visão de calendário, colunas kanban agrupadas por status e prévias de pacotes prontos para publicar.',
      how: 'Os trabalhos vêm da fila de content ops persistida em .session/content-ops/ e exposta pela API REST do dashboard.',
    },
    audit: {
      label: 'Registro de Auditoria',
      description: 'Trilha de auditoria encadeada por hash dos eventos de sessão',
      what: 'Visualizador cronológico dos eventos de auditoria escritos pelo pipeline de auditoria: comandos, mudanças de arquivos e delegações, protegidos por uma cadeia hash SHA-256.',
      how: 'Lê arquivos JSONL diários de .session/audit/logs/ conforme são gravados por src/infrastructure/audit-pipeline.ts.',
    },
    knowledge: {
      label: 'Base de Conhecimento',
      description: 'Memória persistente e documentação absorvida',
      what: 'Expõe o conhecimento armazenado como observações do Engram, decisões ADR e páginas wiki do graphify para que os agentes lembrem de trabalho anterior.',
      how: 'Combina o store do Engram, os arquivos docs/adr/*.md e graphify-out/wiki/index.md gerado a partir do snapshot do codegraph.',
    },
    validations: {
      label: 'Validações ao Vivo',
      description: 'Fluxo em tempo real de validações de contratos e saúde',
      what: 'Transmite eventos de validação (ok/warn/error) emitidos enquanto pipelines e contratos SDD rodam, incluindo o valor verificado quando disponível.',
      how: 'Os eventos chegam via WebSocket do runner de validações; o painel é iniciado inicialmente de GET /api/validations antes de a transmissão ao vivo assumir.',
    },
  },
};

export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
};

export const LOCALE_FLAGS: Record<Locale, string> = {
  en: '🇬🇧',
  es: '🇪🇸',
  'pt-BR': '🇧🇷',
};
