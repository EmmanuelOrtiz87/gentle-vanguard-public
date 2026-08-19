/**
 * i18n-extra.js — Claves de i18n extra para las presentaciones añadidas en v4.1:
 * commands.html, glossary.html, study-material.html y la sección "Consumption
 * Optimization" de index.html.
 *
 * NO editar i18n-content.js. Este archivo hace merge sobre window.__GV_CONTENT.
 * Cargar SIEMPRE entre i18n-content.js y i18n.js.
 */
window.__GV_CONTENT = window.__GV_CONTENT || {};
(function () {
  const extra = {
    en: {
      /* Nav */
      nav_commands: 'Commands',
      nav_glossary: 'Glossary',
      nav_study: 'Study',

      /* commands.html — secciones */
      sec_cmd_intro: 'How to use this catalog',
      sec_cmd_session: 'Session & Stack',
      sec_cmd_health: 'Health & Maintenance',
      sec_cmd_tokens: 'Tokens & Optimization',
      sec_cmd_delegation: 'Delegation & Agents',
      sec_cmd_nexus: 'Nexus Database',
      sec_cmd_dashboard: 'Dashboard',
      sec_cmd_presentations: 'Presentations',
      sec_cmd_security: 'Security & Governance',
      sec_cmd_research: 'Research & Web',
      sec_cmd_recovery: 'Checkpoints & Recovery',
      sec_cmd_quality: 'Quality & CI/CD',
      sec_cmd_utils: 'Utilities',
      c_cmd_intro_text:
        'Every command runs from the repo root with npm run <script>. None of them depend on the AI: they are direct tools to operate, verify and maintain the stack. Use the search box to filter by name, description or reference.',
      c_cmd_session_intro: 'Commands — all manually executable without AI.',
      c_cmd_health_intro: 'Commands — all manually executable without AI.',
      c_cmd_tokens_intro: 'Commands — all manually executable without AI.',
      c_cmd_delegation_intro: 'Commands — all manually executable without AI.',
      c_cmd_nexus_intro: 'Commands — all manually executable without AI.',
      c_cmd_dashboard_intro: 'Commands — all manually executable without AI.',
      c_cmd_presentations_intro: 'Commands — all manually executable without AI.',
      c_cmd_security_intro: 'Commands — all manually executable without AI.',
      c_cmd_research_intro: 'Commands — all manually executable without AI.',
      c_cmd_recovery_intro: 'Commands — all manually executable without AI.',
      c_cmd_quality_intro: 'Commands — all manually executable without AI.',
      c_cmd_utils_intro: 'Commands — all manually executable without AI.',

      /* glossary.html */
      sec_glossary: 'Glossary & Index',
      sec_gloss_intro:
        'Alphabetical vocabulary of the stack: acronyms, synonyms, meanings, concepts and nomenclatures with A-Z anchor navigation.',
      c_gloss_intro_text:
        'Words, acronyms, synonyms, meanings, concepts and nomenclatures of the stack, sorted alphabetically. Use the A-Z bar to jump to a letter.',
      sec_gloss_stack: 'Stack terminology',
      sec_gloss_acronyms: 'Acronyms & abbreviations',
      sec_gloss_ai: 'AI / LLM concepts',
      sec_gloss_tools: 'Tools & platforms',
      sec_gloss_standards: 'Standards & frameworks',

      /* study-material.html */
      sec_study: 'Study Material',
      sec_study_intro:
        'Technical, architectural, design, AI, programming and software foundations considered to build the stack — each concept with how it applies in Gentle-Vanguard.',
      c_study_intro_text:
        'Each concept explains the theory and how it was applied in the stack, with references to real files in src/, config/ and docs/.',
      sec_study_se: 'Software Engineering Fundamentals',
      sec_study_ai: 'AI / LLM Fundamentals',
      sec_study_infra: 'Infrastructure & Operations',
      sec_study_db: 'Databases & Persistence',
      sec_study_proto: 'Communication & Protocols',
      sec_study_test: 'Quality & Testing',
      sec_study_ux: 'UX & Frontend',

      /* index.html — Consumption Optimization */
      sec_optimization: 'Consumption Optimization',
      c_optimization_intro:
        'Token optimization across the 4 fronts: session start, session close, delegation and cache. Real savings from the stack compression and routing.',

      /* index.html — book cards */
      c_index_118: '💻 Commands & CLI',
      c_index_119:
        '266 npm scripts cataloged in 12 categories — session, tokens, security, research and more, searchable and copyable',
      c_index_120: '🔤 Glossary & Index',
      c_index_121:
        '280 alphabetical stack terms with A-Z navigation — acronyms, concepts, tools, standards and nomenclatures',
      c_index_122: '🎓 Study Material',
      c_index_123:
        '42 concepts across 7 domains — engineering, AI/LLM, infra, databases, protocols, testing and UX, each with exercises',
    },
    es: {
      /* Nav */
      nav_commands: 'Comandos',
      nav_glossary: 'Glosario',
      nav_study: 'Estudio',

      /* commands.html — secciones */
      sec_cmd_intro: 'Cómo usar este catálogo',
      sec_cmd_session: 'Sesión y Stack',
      sec_cmd_health: 'Salud y Mantenimiento',
      sec_cmd_tokens: 'Tokens y Optimización',
      sec_cmd_delegation: 'Delegación y Agentes',
      sec_cmd_nexus: 'Base de Datos Nexus',
      sec_cmd_dashboard: 'Dashboard',
      sec_cmd_presentations: 'Presentaciones',
      sec_cmd_security: 'Seguridad y Gobernanza',
      sec_cmd_research: 'Investigación y Web',
      sec_cmd_recovery: 'Checkpoints y Recuperación',
      sec_cmd_quality: 'Calidad y CI/CD',
      sec_cmd_utils: 'Utilidades',
      c_cmd_intro_text:
        'Todos los comandos se ejecutan desde la raíz del repo con npm run &lt;script&gt;. No dependen de la IA: son herramientas directas para operar, verificar y mantener el stack. Usa el buscador para filtrar por nombre, descripción o referencia.',
      c_cmd_session_intro: 'Comandos — todos ejecutables manualmente sin depender de la IA.',
      c_cmd_health_intro: 'Comandos — todos ejecutables manualmente sin depender de la IA.',
      c_cmd_tokens_intro: 'Comandos — todos ejecutables manualmente sin depender de la IA.',
      c_cmd_delegation_intro: 'Comandos — todos ejecutables manualmente sin depender de la IA.',
      c_cmd_nexus_intro: 'Comandos — todos ejecutables manualmente sin depender de la IA.',
      c_cmd_dashboard_intro: 'Comandos — todos ejecutables manualmente sin depender de la IA.',
      c_cmd_presentations_intro: 'Comandos — todos ejecutables manualmente sin depender de la IA.',
      c_cmd_security_intro: 'Comandos — todos ejecutables manualmente sin depender de la IA.',
      c_cmd_research_intro: 'Comandos — todos ejecutables manualmente sin depender de la IA.',
      c_cmd_recovery_intro: 'Comandos — todos ejecutables manualmente sin depender de la IA.',
      c_cmd_quality_intro: 'Comandos — todos ejecutables manualmente sin depender de la IA.',
      c_cmd_utils_intro: 'Comandos — todos ejecutables manualmente sin depender de la IA.',

      /* glossary.html */
      sec_glossary: 'Glosario e Índice',
      sec_gloss_intro:
        'Vocabulario alfabético del stack: palabras, siglas, sinónimos, significados, conceptos y nomenclaturas con navegación por anclas A-Z.',
      c_gloss_intro_text:
        'Palabras, siglas, sinónimos, significados, conceptos y nomenclaturas del stack, ordenados alfabéticamente. Usa la barra A-Z para saltar a una letra.',
      sec_gloss_stack: 'Terminología del stack',
      sec_gloss_acronyms: 'Siglas y abreviaturas',
      sec_gloss_ai: 'Conceptos de IA / LLM',
      sec_gloss_tools: 'Herramientas y plataformas',
      sec_gloss_standards: 'Estándares y marcos',

      /* study-material.html */
      sec_study: 'Material de Estudio',
      sec_study_intro:
        'Fundamentos técnicos, arquitectónicos, de diseño, de IA, de programación y de software contemplados para construir el stack — cada concepto con su aplicación en Gentle-Vanguard.',
      c_study_intro_text:
        'Cada concepto explica la teoría y cómo se aplicó en el stack, con referencias a archivos reales en src/, config/ y docs/.',
      sec_study_se: 'Fundamentos de Ingeniería de Software',
      sec_study_ai: 'Fundamentos de IA / LLM',
      sec_study_infra: 'Infraestructura y Operaciones',
      sec_study_db: 'Bases de Datos y Persistencia',
      sec_study_proto: 'Comunicación y Protocolos',
      sec_study_test: 'Calidad y Testing',
      sec_study_ux: 'UX y Frontend',

      /* index.html — Consumption Optimization */
      sec_optimization: 'Optimización de Consumo',
      c_optimization_intro:
        'Optimización de tokens en los 4 frentes: inicio de sesión, cierre de sesión, delegación y caché. Ahorros reales por la compresión del stack y el ruteo.',

      /* index.html — book cards */
      c_index_118: '💻 Comandos y CLI',
      c_index_119:
        '266 scripts npm catalogados en 12 categorías — sesión, tokens, seguridad, investigación y más, buscables y copiables',
      c_index_120: '🔤 Glosario e Índice',
      c_index_121:
        '280 términos alfabéticos del stack con navegación A-Z — siglas, conceptos, herramientas, estándares y nomenclaturas',
      c_index_122: '🎓 Material de Estudio',
      c_index_123:
        '42 conceptos en 7 dominios — ingeniería, IA/LLM, infra, bases de datos, protocolos, testing y UX, cada uno con ejercicios',
    },
    'pt-BR': {
      /* Nav */
      nav_commands: 'Comandos',
      nav_glossary: 'Glossário',
      nav_study: 'Estudo',

      /* commands.html — secciones */
      sec_cmd_intro: 'Como usar este catálogo',
      sec_cmd_session: 'Sessão e Stack',
      sec_cmd_health: 'Saúde e Manutenção',
      sec_cmd_tokens: 'Tokens e Otimização',
      sec_cmd_delegation: 'Delegação e Agentes',
      sec_cmd_nexus: 'Banco de Dados Nexus',
      sec_cmd_dashboard: 'Dashboard',
      sec_cmd_presentations: 'Apresentações',
      sec_cmd_security: 'Segurança e Governança',
      sec_cmd_research: 'Pesquisa e Web',
      sec_cmd_recovery: 'Checkpoints e Recuperação',
      sec_cmd_quality: 'Qualidade e CI/CD',
      sec_cmd_utils: 'Utilitários',
      c_cmd_intro_text:
        'Todos os comandos são executados da raiz do repositório com npm run &lt;script&gt;. Não dependem da IA: são ferramentas diretas para operar, verificar e manter a stack. Use a busca para filtrar por nome, descrição ou referência.',
      c_cmd_session_intro: 'Comandos — todos executáveis manualmente sem depender da IA.',
      c_cmd_health_intro: 'Comandos — todos executáveis manualmente sem depender da IA.',
      c_cmd_tokens_intro: 'Comandos — todos executáveis manualmente sem depender da IA.',
      c_cmd_delegation_intro: 'Comandos — todos executáveis manualmente sem depender da IA.',
      c_cmd_nexus_intro: 'Comandos — todos executáveis manualmente sem depender da IA.',
      c_cmd_dashboard_intro: 'Comandos — todos executáveis manualmente sem depender da IA.',
      c_cmd_presentations_intro: 'Comandos — todos executáveis manualmente sem depender da IA.',
      c_cmd_security_intro: 'Comandos — todos executáveis manualmente sem depender da IA.',
      c_cmd_research_intro: 'Comandos — todos executáveis manualmente sem depender da IA.',
      c_cmd_recovery_intro: 'Comandos — todos executáveis manualmente sem depender da IA.',
      c_cmd_quality_intro: 'Comandos — todos executáveis manualmente sem depender da IA.',
      c_cmd_utils_intro: 'Comandos — todos executáveis manualmente sem depender da IA.',

      /* glossary.html */
      sec_glossary: 'Glossário e Índice',
      sec_gloss_intro:
        'Vocabulário alfabético da stack: palavras, siglas, sinônimos, significados, conceitos e nomenclaturas com navegação por âncoras A-Z.',
      c_gloss_intro_text:
        'Palavras, siglas, sinônimos, significados, conceitos e nomenclaturas da stack, ordenados alfabeticamente. Use a barra A-Z para saltar a uma letra.',
      sec_gloss_stack: 'Terminologia da stack',
      sec_gloss_acronyms: 'Siglas e abreviações',
      sec_gloss_ai: 'Conceitos de IA / LLM',
      sec_gloss_tools: 'Ferramentas e plataformas',
      sec_gloss_standards: 'Padrões e frameworks',

      /* study-material.html */
      sec_study: 'Material de Estudo',
      sec_study_intro:
        'Fundamentos técnicos, arquiteturais, de design, de IA, de programação e de software considerados para construir a stack — cada conceito com sua aplicação no Gentle-Vanguard.',
      c_study_intro_text:
        'Cada conceito explica a teoria e como foi aplicado na stack, com referências a arquivos reais em src/, config/ e docs/.',
      sec_study_se: 'Fundamentos de Engenharia de Software',
      sec_study_ai: 'Fundamentos de IA / LLM',
      sec_study_infra: 'Infraestrutura e Operações',
      sec_study_db: 'Bancos de Dados e Persistência',
      sec_study_proto: 'Comunicação e Protocolos',
      sec_study_test: 'Qualidade e Testes',
      sec_study_ux: 'UX e Frontend',

      /* index.html — Consumption Optimization */
      sec_optimization: 'Otimização de Consumo',
      c_optimization_intro:
        'Otimização de tokens nos 4 frontes: início de sessão, fechamento de sessão, delegação e cache. Economias reais pela compressão da stack e pelo roteamento.',

      /* index.html — book cards */
      c_index_118: '💻 Comandos e CLI',
      c_index_119:
        '266 scripts npm catalogados em 12 categorias — sessão, tokens, segurança, pesquisa e mais, pesquisáveis e copiáveis',
      c_index_120: '🔤 Glossário e Índice',
      c_index_121:
        '280 termos alfabéticos da stack com navegação A-Z — siglas, conceitos, ferramentas, padrões e nomenclaturas',
      c_index_122: '🎓 Material de Estudo',
      c_index_123:
        '42 conceitos em 7 domínios — engenharia, IA/LLM, infra, bancos de dados, protocolos, testes e UX, cada um com exercícios',
    },
  };

  for (const lang of Object.keys(extra)) {
    window.__GV_CONTENT[lang] = Object.assign({}, window.__GV_CONTENT[lang], extra[lang]);
  }
})();