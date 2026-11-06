/**
 * Set 1 - Negocio y leads (ES).
 *
 * Audiencia: responsables de negocio y empresas que evalúan contratar un
 * desarrollo a medida. Objetivo: explicar qué somos, qué hacemos, cómo
 * trabajamos y dejar una acción concreta (diagnóstico sin cargo).
 *
 * Regla editorial: no se inventan clientes, testimonios, resultados ni
 * certificaciones. Las apps propias se presentan como desarrollos propios en
 * funcionamiento, nunca como casos de clientes.
 */

export default {
  id: 'gv-negocio-leads-es',
  title: 'GentleVanguard - Software a medida, automatización e IA aplicada',
  subject: 'Presentación comercial de GentleVanguard',
  footer: 'GentleVanguard - San Juan, Argentina',
  theme: 'hybrid',
  hero: 'negocio',
  slides: [
    {
      layout: 'cover',
      eyebrow: 'Software a medida - Automatización - IA aplicada',
      title: 'Tu negocio crece.\nTus sistemas también.',
      titleSize: 36,
      titleH: 1.3,
      subtitle:
        'Diseñamos apps, sistemas empresariales y automatizaciones alrededor de cómo trabaja tu equipo. Diagnóstico sin cargo, propuesta por etapas y precios cerrados por hito.',
      meta: ['Diagnóstico sin cargo', 'Precio fijo por hito', 'San Juan, Argentina'],
      versión: 'Stack v4.3.0 - Noviembre 2026',
    },

    {
      layout: 'statement',
      eyebrow: 'Quiénes somos',
      title: 'Un estudio de software que escucha antes de construir',
      body:
        'GentleVanguard diseña y construye apps a medida y sistemas empresariales para pymes y empresas que necesitan ordenar procesos, automatizar operaciones y crecer con software confiable. Trabajamos por proyecto, con contratación independiente, desde San Juan, Argentina.',
      bodyW: 8.2,
      bodySize: 12.5,
      stats: [
        { value: '15+', label: 'Años de trayectoria', sub: 'Arquitectura de software e IA aplicada en empresas' },
        { value: '3', label: 'Líneas de servicio', sub: 'Software a medida, automatización e IA aplicada' },
        { value: '1', label: 'Responsable real', sub: 'El mismo diseño, la misma construcción y la misma entrega' },
      ],
    },

    {
      layout: 'cards',
      eyebrow: 'Qué hacemos',
      title: 'Tres formas de ordenar una operación',
      lead: 'Cada proyecto arranca del proceso real, no de una herramienta.',
      cols: 3,
      items: [
        {
          icon: 'laptop',
          heading: 'Software a medida',
          body: 'Aplicaciones y portales construidos alrededor de tus procesos, no al revés. Gestión de clientes, operaciones y seguimiento. Evolución de sistemas que ya no alcanzan.',
          accent: '06b6d4',
        },
        {
          icon: 'gears',
          heading: 'Automatización',
          body: 'Integraciones entre sistemas, CRM y pagos. Flujos de atención conversacional. Tableros y reportes para que el seguimiento deje de depender de planillas.',
          accent: '8b5cf6',
        },
        {
          icon: 'brain',
          heading: 'IA aplicada',
          body: 'Evaluamos dónde la inteligencia artificial aporta valor real: asistentes conectados a la información de la organización, con límites y revisión humana definidos.',
          accent: 'fbbf24',
        },
      ],
    },

    {
      layout: 'principle',
      eyebrow: 'Cómo trabajamos',
      title: 'Un método corto, con criterios acordados antes de empezar',
      items: [
        {
          heading: 'Primero entendemos',
          body: 'Conversamos sobre el problema, las personas involucradas y las herramientas que ya usan. No se diseña sobre supuestos.',
          accent: '06b6d4',
        },
        {
          heading: 'Después construimos',
          body: 'Acordamos prioridades, etapas, entregables y criterios de aceptación. La primera versión se prueba y se revisa con evidencia.',
          accent: '8b5cf6',
        },
        {
          heading: 'Acompañamos',
          body: 'Puesta en marcha, documentación, capacitación y un camino de evolución acordado. La entrega es el inicio de la operación.',
          accent: 'fbbf24',
        },
      ],
      closing:
        'Un proyecto no arranca con una propuesta: arranca con un diagnóstico que termina en un mapa de procesos, dolores principales, oportunidades de automatización y un roadmap por etapas.',
    },

    {
      layout: 'metrics',
      eyebrow: 'La diferencia',
      title: 'No vendemos horas: operamos sobre una plataforma ya construida',
      lead:
        'GentleVanguard es un estudio con un stack propio. Esa plataforma es la que sostiene los tiempos, la calidad y la trazabilidad de cada proyecto.',
      cols: 4,
      items: [
        { value: '28', label: 'Apps propias', sub: 'Sistemas desarrollados por nosotros y hoy en funcionamiento', accent: '06b6d4' },
        { value: '20', label: 'Agentes de IA', sub: 'Roles con modelo, permisos y presupuesto asignados', accent: '8b5cf6' },
        { value: '256', label: 'Skills', sub: 'Capacidades reutilizables que no se reescriben por proyecto', accent: 'fbbf24' },
        { value: '35', label: 'Componentes vigilados', sub: 'Health checks por componente, con autoheal', accent: '22d3ee' },
      ],
    },

    {
      layout: 'figureLayers',
      eyebrow: 'La plataforma',
      title: 'Un stack con capas, no un proyecto suelto',
      lead: 'Cada capa resuelve una capa de problemas y deja registro de lo que hizo.',
      textW: 3.3,
      items: [
        { icon: 'layers', heading: 'Capas', body: 'Superficies, orquestación, agentes, skills, conocimiento, herramientas e infraestructura.' },
        { icon: 'eye', heading: 'Trazabilidad', body: 'Sesiones, trazas, eventos y auditoría con cadena de hash en la base local.' },
        { icon: 'shield', heading: 'Gobernanza', body: '46 quality gates, escaneo de secretos y políticas fail-closed.' },
        { icon: 'cloud', heading: 'Local primero', body: 'Funciona en la máquina del equipo y se expone en la nube cuando hace falta.' },
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
      layout: 'timeline',
      eyebrow: 'El recorrido',
      title: 'De la primera conversación a la operación',
      lead: 'Etapas con entregables verificables, no fases indefinidas.',
      items: [
        { step: '01', heading: 'Entender', body: 'Mapeamos el proceso, los roles y las herramientas actuales.' },
        { step: '02', heading: 'Definir', body: 'Alcance, etapas, entregables y criterios de aceptación acordados.' },
        { step: '03', heading: 'Construir', body: 'Primera versión útil, probada y revisada con quienes la van a usar.' },
        { step: '04', heading: 'Operar', body: 'Puesta en marcha, documentación, capacitación y evolución.' },
      ],
    },

    {
      layout: 'table',
      eyebrow: 'Alcance',
      title: 'Qué se puede contratar, y en qué orden',
      lead: 'Catálogo de referencia en dólares, netos de impuestos. Se refresca antes de cada presupuesto.',
      headers: ['Servicio', 'Rango de referencia (USD)', 'Cuándo tiene sentido'],
      colW: [2.9, 2.3, 3.6],
      rows: [
        ['Análisis y propuesta', '200 - 400', 'No tenés claro qué construir. Es descontable al firmar.'],
        ['Landing page / Web corporativa', '350 - 700 / 900 - 1.800', 'Necesitás presencia propia y una forma simple de recibir consultas.'],
        ['App web con integraciones', '3.500 - 8.000', 'El proceso ya vive en varias herramientas y hay que conectarlas.'],
        ['App móvil MVP', '3.000 - 6.000', 'El equipo necesita operar fuera del escritorio.'],
        ['Bot de WhatsApp simple / híbrido con IA', '1.500 - 2.500 / 3.500 - 5.000', 'Hay atención repetitiva que se puede automatizar.'],
        ['Agente de IA con RAG', '4.000 - 8.000', 'La consulta necesita responder sobre documentación propia.'],
        ['CRM a medida', '5.000 - 15.000', 'El seguimiento comercial vive disperso.'],
        ['Mantenimiento y soporte', '90 - 250 por mes', 'Ya hay un sistema y hace falta sostenerlo y evolucionarlo.'],
      ],
    },

    {
      layout: 'compare',
      eyebrow: 'Por qué nosotros',
      title: 'Un estudio con stack propio, frente a un desarrollo aislado',
      lead: 'Dos caminos que suelen parecer equivalentes y no lo son.',
      left: {
        head: 'GentleVanguard',
        sub: 'Un estudio que opera sobre su propia plataforma',
        icon: 'shield',
        accent: '06b6d4',
        items: [
          { text: 'Precios cerrados por hito y alcance acotado antes de empezar.' },
          { text: 'Diagnóstico documentado: mapa de procesos, riesgos y roadmap por etapas.' },
          { text: 'Código, documentación y criterios de entrega bajo un único criterio de calidad.' },
          { text: 'Capacidades reutilizadas entre proyectos: lo que ya se resolvió no se vuelve a pagar.' },
          { text: 'Continuidad después de la entrega: soporte, mejoras y nuevas integraciones.' },
          { text: 'Formación propia: GV Academy para que el equipo adopte el sistema.' },
        ],
      },
      right: {
        head: 'Desarrollo aislado',
        sub: 'El proyecto empieza y termina con el proyecto',
        icon: 'cross',
        accent: '8b95a8',
        items: [
          { text: 'Alcance difuso que se ajusta sobre la marcha, con el costo como variable.', mark: 'warn' },
          { text: 'Entrega de un software sin proceso documentado ni operación transferida.', mark: 'warn' },
          { text: 'Cada proyecto vuelve a resolver los mismos problemas de base.', mark: 'warn' },
          { text: 'Sin transferencia de conocimiento: el sistema depende de una sola persona.', mark: 'cross' },
          { text: 'Sin continuidad acordada: el sistema envejece sin ruta de evolución.', mark: 'cross' },
          { text: 'Sin formación: la adopción queda en manos del proveedor.', mark: 'cross' },
        ],
      },
    },

    {
      layout: 'metrics',
      eyebrow: 'Además del proyecto',
      title: 'GV Academy: el conocimiento queda en tu equipo',
      lead: 'Catálogo abierto y en funcionamiento: 89 productos sobre IA aplicada, software y negocio.',
      cols: 4,
      items: [
        { value: '30', label: 'Cursos', sub: 'Con 429 horas de contenido en video', accent: '06b6d4' },
        { value: '33', label: 'Ebooks', sub: '2.634 páginas, 18 de ellos en edición premium', accent: '8b5cf6' },
        { value: '26', label: 'Toolkits', sub: 'Prompts y flujos listos para aplicar', accent: 'fbbf24' },
        { value: '89', label: 'Productos', sub: 'Publicados y vendibles de forma individual', accent: '22d3ee' },
      ],
    },

    {
      layout: 'figure',
      eyebrow: 'Prueba de trabajo',
      title: 'Esto ya está corriendo: 28 desarrollos propios',
      lead: 'No son productos en catálogo ni casos de clientes. Son sistemas que construimos y que hoy funcionan.',
      textW: 3.5,
      image: 'stack-dashboard.png',
      imageAlt: 'Arquitectura del dashboard de observabilidad del stack',
      caption: 'Dashboard de observabilidad del stack, alimentado con trazas reales',
      items: [
        { icon: 'academy', heading: 'GV Academy', body: 'Plataforma de estudio, portal, CRM y catálogo de 89 productos.' },
        { icon: 'mobile', heading: 'Bot de WhatsApp', body: 'Atención conversacional determinista con entrega en producción.' },
        { icon: 'chart', heading: 'Observabilidad', body: 'Dashboard con métricas, trazas, alertas y feedback en vivo.' },
        { icon: 'boxes', heading: 'Centro de comandos', body: 'Ciclo de vida de las apps: arranque, estado y logs.' },
      ],
    },

    {
      layout: 'statement',
      eyebrow: 'El primer paso',
      title: 'La primera consulta es sin cargo',
      body:
        'Nos juntamos, entendemos tu operación y te llevás un análisis claro con una propuesta por etapas y precios cerrados por hito. Después decidís si avanzamos. Si no avanzamos, igual te queda el diagnóstico.',
      bodyW: 8.2,
      bodySize: 13,
      stats: [
        { value: 'Sin cargo', label: 'Diagnóstico inicial', sub: 'Incluye mapa de procesos y roadmap por etapas' },
        { value: '50/40/10', label: 'Hitos de pago', sub: 'Precio fijo cerrado por hito, con pagos adelantados' },
        { value: '30 días', label: 'Garantía', sub: 'Garantía por producto al cierre de la entrega' },
      ],
    },

    {
      layout: 'closing',
      title: 'Empecemos por entender tu operación',
      body: 'Una conversación de diagnóstico alcanza para saber si hay un proyecto acá, y cuánto vale. Sin compromiso.',
      ctas: [
        { label: 'Quiero mi diagnóstico sin cargo' },
        { label: 'Ver el catálogo' },
      ],
      contacts: [
        'WhatsApp: +54 9 264 545-2221',
        'Correo: gentlevanguard@gmail.com',
        'San Juan, Argentina - Trabajo por proyecto, contratación independiente',
      ],
      note: 'La presentación institucional y el catálogo de Academy están publicados en gentlevanguard.github.io',
    },
  ],
};
