# Nomenclatura — GentleVanguard

> **Generado automáticamente** desde `docs/presentations/glossary.html` (la fuente unica).
> No editar a mano: `npm run docs:glossary` regenera el documento y el gate de drift
> (`npm run docs:glossary:check`) falla si queda desactualizado.

> 284 términos. Para el guion de cada deck, ver `decks/speech/`; para las
> preguntas que van a hacer, ver `docs/presentations/FAQ.md`.

---

## App

| Término | Definición | En el repo |
| --- | --- | --- |
| **Command Center** | Panel standalone para gestionar el ciclo de vida on-demand de las apps construidas, en el puerto 8090. | 📍 apps/command-center |

## Conceptos

| Término | Definición | En el repo |
| --- | --- | --- |
| **A/B** | Prueba controlada de dos variantes para decidir por evidencia estadística. El stack lo usa en AB Testing con auto-rollback ante degradación. | 📍 src/ab-testing · skill ab-testing |
| **ACID** | Atomicidad, Consistencia, Aislamiento y Durabilidad: garantías de transacciones. SQLite de Nexus cumple ACID por diseño. | 📍 apps/web-dashboard/server/database/ |
| **AES** | Advanced Encryption Standard: cifrado simétrico usado en esquemas de protección del stack (GCM por defecto). | 📍 src/cli/protect.ts |
| **Ansible** | Herramienta de automatización de configuración. No usada directamente; el stack usa TS nativo. | 📍 — |
| **ArgoCD** | CD declarativa para Kubernetes. No usado en el stack (CI con GitHub Actions). | 📍 — |
| **Argon2** | Algoritmo de hashing de contraseñas resistente a fuerza bruta. | 📍 — |
| **Async** | Modelo de concurrencia no bloqueante. Todo el stack es async (Promise.allSettled en watchtower y pipeline). | 📍 src/core/maintenance-watchtower.ts |
| **Babel** | Transpilador JS. No usado; el stack compila con esbuild/Vite/tsc. | 📍 — |
| **BCrypt** | Hashing de contraseñas con salt. Referencia de patrones de seguridad. | 📍 — |
| **Bisect** | Búsqueda binaria de commits que introdujeron un bug en git. | 📍 skill git-workflow-and-versioning |
| **BLAKE3** | Hash criptográfico rápido; alternativa moderna a SHA-2. | 📍 — |
| **BlueGreen** | Patrón de despliegue con dos entornos (azul/verde) y corte instantáneo. | 📍 skill ci-cd-and-automation |
| **Brotli** | Algoritmo de compresión sin pérdida (alternativa a gzip). | 📍 — |
| **Canary** | Despliegue incremental a un pequeño porcentaje de usuarios. | 📍 skill ci-cd-and-automation |
| **CDN** | Content Delivery Network: red de distribución de contenido estático. | 📍 — |
| **CJS** | CommonJS: formato de módulos de Node (require). | 📍 — |
| **Commit** | Unidad de cambio versionada en git. | 📍 skill git-workflow-and-versioning |
| **Compose** | Docker Compose: orquestación multi-contenedor declarativa. | 📍 docker-compose.test.yml |
| **Container** | Paquete de software aislado con su runtime (Docker). | 📍 Dockerfile |
| **CQRS** | Command Query Responsibility Segregation: separa escrituras de lecturas. | 📍 skill api-and-interface-design |
| **CRUD** | Create/Read/Update/Delete: operaciones básicas de datos. Usado por los DAOs de Nexus. | 📍 apps/web-dashboard/server/database/ |
| **DDD** | Domain-Driven Design: diseño guiado por el dominio del negocio. | 📍 skill spec-driven-development |
| **DefenseInDepth** | Defensa en profundidad: múltiples capas de seguridad independientes. | 📍 skill security-and-hardening |
| **DevOps** | Cultura que une desarrollo y operaciones. | 📍 skill ci-cd-and-automation |
| **DevSecOps** | DevOps con seguridad integrada desde el inicio (shift-left). | 📍 skill implementing-devsecops-security-scanning |
| **DNS** | Domain Name System: resolución de nombres a IPs. | 📍 — |
| **DWH** | Data Warehouse: almacén de datos para análisis. | 📍 — |
| **E2E** | End-to-End: tests que cubren el flujo completo de la aplicación. | 📍 tests/ · skill qa-lead |
| **ECDSA** | Elliptic Curve Digital Signature Algorithm: firma digital sobre curvas elípticas. | 📍 — |
| **Esbuild** | Bundler extremadamente rápido; usado vía Vite. | 📍 apps/web-dashboard/ |
| **ESM** | ECMAScript Modules: formato de módulos nativo de JS (import/export). | 📍 package.json (type: module) |
| **ETL** | Extract-Transform-Load: proceso de integración de datos. | 📍 — |
| **Event-Driven** | Arquitectura dirigida por eventos. | 📍 docs/architecture/ · patterns |
| **EventLoop** | Bucle de eventos de Node.js que procesa callbacks asíncronos. | 📍 — |
| **ExactlyOnce** | Garantía de procesamiento de mensajes exactamente una vez. | 📍 — |
| **FaaS** | Function as a Service: ejecución de funciones serverless. | 📍 — |
| **FeatureFlag** | Flag de funcionalidad para activar/desactivar features en runtime. | 📍 skill ab-testing |
| **FinOps** | Disciplina de optimización de costes cloud. | 📍 rules/COST-ATTRIBUTION.md |
| **Fuzzing** | Técnica de testing que inyecta inputs aleatorios/maliciosos. | 📍 skill testing-api-security-with-owasp-top-10 |
| **GC** | Garbage Collector: gestión automática de memoria. | 📍 — |
| **GitFlow** | Modelo de ramas (feature/develop/release/hotfix). | 📍 skill git-workflow-and-versioning |
| **GitOps** | Operaciones declarativas basadas en git como fuente de verdad. | 📍 skill git-workflow-and-versioning |
| **GraphQL** | Lenguaje de consulta de APIs tipadas. | 📍 skill api-and-interface-design |
| **gRPC** | RPC de alto rendimiento sobre HTTP/2 con Protobuf. | 📍 — |
| **Gzip** | Algoritmo de compresión sin pérdida estándar. | 📍 — |
| **HA** | High Availability: disponibilidad continua del servicio. | 📍 — |
| **Hashing** | Función unidireccional que mapea datos a un resumen fijo (SHA-256). | 📍 event-sourcing · response_cache |
| **Helm** | Gestor de paquetes de Kubernetes. No usado. | 📍 — |
| **HLD** | High-Level Design: diseño de alto nivel del sistema. | 📍 docs/architecture/ |
| **HMAC** | Hash Message Authentication Code: autenticación de integridad con clave. | 📍 — |
| **HTML** | HyperText Markup Language: lenguaje de estructura web. | 📍 docs/presentations/ |
| **HTTP** | HyperText Transfer Protocol: protocolo de la web. | 📍 apps/web-dashboard/server/ |
| **HTTPS** | HTTP sobre TLS (cifrado). | 📍 — |
| **IaaS** | Infrastructure as a Service: servidores virtualizados bajo demanda. | 📍 — |
| **IAM** | Identity and Access Management: gestión de identidades y accesos. | 📍 rules/ |
| **JavaScript** | Lenguaje de la web. Base de todo el stack TS. | 📍 — |
| **JWT** | JSON Web Token: token firmado para autenticación/autorización. | 📍 — |
| **KillSwitch** | Interruptor de emergencia para desactivar un sistema (RDD). | 📍 src/rdd/rdd-kill-switch.ts |
| **Kubernetes** | Orquestador de contenedores. No usado; deploy vía Docker/CI. | 📍 — |
| **Latency** | Latencia: tiempo de respuesta de un sistema. | 📍 metrics dashboard |
| **LB** | Load Balancer: equilibrador de carga. | 📍 — |
| **LeastPrivilege** | Principio de menor privilegio: mínimos permisos necesarios. | 📍 skill security-and-hardening |
| **LLD** | Low-Level Design: diseño de detalle de módulos. | 📍 docs/sdd/ |
| **Logs** | Registros de eventos de un sistema (JSONL en el stack). | 📍 .session/audit/logs/ |
| **Lossless** | Compresión sin pérdida (modo input en structural-compression). | 📍 config/structural-compression.json |
| **Lossy** | Compresión con pérdida (modo output permitido). | 📍 config/structural-compression.json |
| **Markdown** | Lenguaje de marcado ligero. Documentación del stack. | 📍 docs/ · rules/ |
| **Medallion** | Arquitectura de datos en capas bronze/silver/gold. | 📍 — |
| **Metrics** | Métricas: mediciones numéricas de comportamiento (tokens, latencia, salud). | 📍 metric_snapshots |
| **MFA** | Multi-Factor Authentication: autenticación multifactor. | 📍 rules/ |
| **Microservices** | Arquitectura de servicios pequeños e independientes. | 📍 docs/architecture/ |
| **MLOps** | Prácticas de ML en producción. | 📍 — |
| **Mock** | Objeto simulado para aislar el comportamiento bajo test. | 📍 tests/ |
| **MTTR** | Mean Time To Repair: tiempo medio de reparación. | 📍 docs/status/ |
| **MVC** | Model-View-Controller: patrón de separación de capas. | 📍 — |
| **MVP** | Minimum Viable Product: producto mínimo viable. | 📍 — |
| **Node** | Runtime de JavaScript. Base del stack TS. | 📍 package.json (node >=20) |
| **NoSQL** | Bases no relacionales (documentos, grafos, clave-valor). | 📍 — |
| **OAuth** | Marco de autorización delegada (tokens de acceso). | 📍 — |
| **Observability** | Capacidad de entender el estado interno por outputs externos (metrics/logs/traces). | 📍 apps/web-dashboard/ · .telemetry/ |
| **OKR** | Objectives and Key Results: marco de objetivos. | 📍 — |
| **P95** | Percentil 95: latencia bajo la que cae el 95% de las peticiones. | 📍 dashboard · perf:slo |
| **P99** | Percentil 99 de latencia. | 📍 dashboard · perf:slo |
| **PaaS** | Platform as a Service. | 📍 — |
| **Parquet** | Formato columnar de almacenamiento de datos. | 📍 — |
| **PKI** | Public Key Infrastructure: infraestructura de certificados y claves públicas. | 📍 — |
| **PoC** | Proof of Concept: prueba de concepto. | 📍 — |
| **PR** | Pull Request: solicitud de integración de cambios. | 📍 skill branch-pr |
| **Promise** | Objeto JS para operaciones asíncronas. Promise.allSettled en el stack. | 📍 src/ |
| **Protobuf** | Protocol Buffers: serialización binaria tipada (usado por gRPC). | 📍 — |
| **Queue** | Cola de mensajes FIFO para desacoplar procesos. | 📍 — |
| **RBAC** | Role-Based Access Control: control de acceso por roles. | 📍 rules/ |
| **Rebase** | Reescribir el historial de commits sobre otra base. | 📍 skill git-workflow-and-versioning |
| **Regex** | Expresiones regulares: patrones de búsqueda de texto. | 📍 src/secret-scanner.ts |
| **REST** | Estilo arquitectónico de APIs sobre HTTP. | 📍 apps/web-dashboard/server/ |
| **RFC** | Request For Comments: documento de propuesta técnica. | 📍 docs/ |
| **ROI** | Return On Investment: retorno de la inversión. | 📍 — |
| **RollingUpdate** | Despliegue gradual sin downtime. | 📍 — |
| **RSA** | Algoritmo asimétrico de cifrado/firma. | 📍 — |
| **RTO** | Recovery Time Objective: tiempo objetivo de recuperación. | 📍 docs/status/ |
| **SaaS** | Software as a Service. | 📍 — |
| **Saga** | Patrón de consistencia distribuida con pasos de compensación. | 📍 src/saga-orchestrator.ts |
| **Serverless** | Ejecución sin gestión de servidores. | 📍 — |
| **SHA3** | Familia de hashes Keccak estándar. | 📍 — |
| **SIEM** | Security Information and Event Management: correlación de eventos de seguridad. | 📍 src/infrastructure/siem-audit-bridge.ts |
| **SLA** | Service Level Agreement: acuerdo de nivel de servicio. | 📍 docs/ |
| **Spans** | Unidades de trabajo del tracing distribuido. | 📍 .telemetry/spans/ |
| **SQL** | Structured Query Language: lenguaje de consulta relacional. | 📍 Nexus SQLite |
| **SRE** | Site Reliability Engineering: ingeniería de fiabilidad. | 📍 docs/operations/ |
| **Stream** | Flujo continuo de datos. | 📍 — |
| **Stub** | Reemplazo minimalista de dependencias en tests. | 📍 tests/ |
| **SWC** | Compilador Rust de JS/TS (rápido). | 📍 — |
| **Tailwind** | Framework CSS utility-first. No usado; se usa Bootstrap + design tokens. | 📍 — |
| **TDD** | Test-Driven Development: tests antes que código. | 📍 skill test-driven-development |
| **Telemetry** | Recolección automática de datos operacionales. | 📍 .telemetry/ |
| **Terraform** | IaC de infraestructura. No usado. | 📍 — |
| **Throughput** | Rendimiento: operaciones por unidad de tiempo. | 📍 dashboard |
| **TLS** | Transport Layer Security: cifrado en tránsito. | 📍 — |
| **Traces** | Seguimiento de una petición a través del sistema (árbol trace_id→span_id). | 📍 .telemetry/traces/ |
| **TrunkBased** | Flujo de trabajo con rama principal única e integración frecuente. | 📍 skill git-workflow-and-versioning |
| **TTL** | Time To Live: tiempo de vida de datos en caché. | 📍 response_cache |
| **Unicode** | Estándar de codificación de caracteres (UTF-8). | 📍 — |
| **UTF-8** | Codificación de Unicode de 8 bits. Estándar de archivos del stack. | 📍 — |
| **VPN** | Virtual Private Network: red privada virtual. | 📍 — |
| **WAF** | Web Application Firewall: firewall de aplicaciones web. | 📍 — |
| **WebSocket** | Protocolo de comunicación bidireccional full-duplex sobre TCP. | 📍 apps/web-dashboard/server/websocket-server.ts |
| **XMP** | Extensible Metadata Platform: metadatos embebidos (proveniencia). | 📍 .opencode/skills/ai-provenance |
| **ZeroTrust** | Modelo de seguridad "nunca confiar, siempre verificar". | 📍 skill security-and-hardening |
| **Zstd** | Zstandard: compresión moderna de alta ratio. | 📍 — |

## Estándar

| Término | Definición | En el repo |
| --- | --- | --- |
| **ATLAS** | MITRE ATLAS: matriz de tácticas y técnicas de ataques a sistemas de IA. | 📍 .opencode/skills/ (frontmatter de skills de seguridad) |
| **C2PA** | Coalition for Content Provenance and Authenticity: estándar de proveniencia de contenido (Content Credentials). | 📍 .opencode/skills/ai-provenance |
| **CMMC** | Cybersecurity Maturity Model Certification del DoD (niveles 1-3). | 📍 .opencode/skills/achieving-cmmc-level-2-compliance |
| **CVE** | Common Vulnerabilities and Exposures: catálogo público de vulnerabilidades. | 📍 skill analyzing-sbom-for-supply-chain-vulnerabilities |
| **FTS5** | Full-Text Search 5: extensión de SQLite para búsqueda full-text. | 📍 Engram · .codegraph |
| **GDPR** | Reglamento General de Protección de Datos (EU 2016/679). | 📍 .opencode/skills/implementing-gdpr-data-protection-controls |
| **ISO 27001** | Estándar de sistemas de gestión de seguridad de la información (ISMS). | 📍 .opencode/skills/implementing-iso-27001-information-security-management |
| **MITRE** | MITRE ATT&CK: matriz de tácticas y técnicas de ataque. | 📍 .opencode/skills/ (frontmatter) |
| **NIST** | National Institute of Standards and Technology: estándares de seguridad (800-30, CSF, 800-171). | 📍 .opencode/skills/ |
| **OWASP** | Open Worldwide Application Security Project: estándares de seguridad de aplicaciones (API Top 10, LLM Top 10). | 📍 .opencode/skills/ |
| **SBOM** | Software Bill of Materials: inventario de componentes/dependencias. | 📍 src/generate-sbom.ts |
| **SHA-256** | Hash criptográfico de 256 bits. Usado en hash-chain de eventos y cache keys. | 📍 src/event-sourcing.ts |

## Herramientas

| Término | Definición | En el repo |
| --- | --- | --- |
| **Aider** | Herramienta de desarrollo por IA en terminal; soportada como herramienta (Layer 1 Tools). | 📍 docs/presentations/index.html |
| **Bootstrap** | Framework CSS usado por las presentaciones del stack (5.3.3). | 📍 docs/presentations/ |
| **Burp** | Burp Suite: proxy de intercepción para pentest de APIs (OWASP API Top 10). | 📍 .opencode/skills/conducting-api-security-testing |
| **Claude Code** | Herramienta de desarrollo por IA (Antrhopic); soportada en Layer 1 Tools. | 📍 docs/presentations/index.html |
| **Cline** | Herramienta de desarrollo por IA (VS Code); soportada. | 📍 docs/presentations/index.html |
| **Copilot** | Asistente de código de GitHub; soportado en Layer 1 Tools. | 📍 docs/presentations/index.html |
| **Cursor** | Editor con IA; soportado en Layer 1 Tools. | 📍 docs/presentations/index.html |
| **Dependabot** | Bot de GitHub que actualiza dependencias automáticamente. | 📍 .github/ |
| **Docker** | Plataforma de contenedores. Build y test del stack en Docker. | 📍 Dockerfile · docker-compose.test.yml |
| **DuckDuckGo** | Motor de búsqueda usado como fallback del web-crawler (HTML). | 📍 src/web-crawler.ts |
| **Elasticsearch** | Buscador distribuido. No usado; se usa FTS5 y embeddings propios. | 📍 — |
| **ESLint** | Linter de JS/TS. Gates de lint con max-warnings 0. | 📍 .eslintrc · npm run lint |
| **Firecrawl** | Motor de scrape/search primario del web-crawler (requiere API key). | 📍 src/web-crawler.ts |
| **Garak** | Framework de NVIDIA para red-teaming de LLMs (probes de jailbreak, injection…). | 📍 .opencode/skills/red-teaming-llms-with-garak |
| **GitHub Actions** | CI/CD de GitHub. 6 jobs CI + 3 jobs de seguridad. | 📍 .github/workflows/ |
| **Gitleaks** | Escáner de secrets para repos git. | 📍 .github/workflows/security.yml |
| **Grafana** | Plataforma de dashboards/métricas. No usado; se usa el dashboard propio del stack. | 📍 — |
| **Jest** | Framework de testing JS. El stack usa node:test/vitest mayormente. | 📍 — |
| **Jina** | Jina Reader (r.jina.ai): fallback cero-config del web-crawler para scrape. | 📍 src/web-crawler.ts |
| **Jupyter** | Notebooks de Python. Usados en research/ (RLHF datasets). | 📍 research/rlhf-dataset-search/ |
| **Kafka** | Plataforma de streaming. No usado; el stack usa event sourcing propio. | 📍 — |
| **Lefthook** | Gestor de git hooks. Instalado en prepare y usado para gates. | 📍 .lefthook.yml |
| **MongoDB** | Base NoSQL documental. No usada; el stack usa SQLite. | 📍 — |
| **Netlify** | Plataforma de hosting estático/deploy. Opción para publicar las presentaciones. | 📍 docs/presentations/ |
| **OpenCode** | CLI de desarrollo por IA donde vive este stack (Layer 1). | 📍 opencode.json |
| **OpenTelemetry** | Framework de telemetría estándar. El stack exporta OTLP. | 📍 src/tracing-instrument.ts |
| **Playwright** | Framework de testing E2E de navegador. | 📍 @playwright/test |
| **PostgreSQL** | Base SQL relacional. No usada; el stack usa SQLite. | 📍 — |
| **Prettier** | Formateador de código. Gates de format:check. | 📍 .prettierrc |
| **Promptfoo** | Framework de red-teaming continuo de LLMs en CI/CD. | 📍 .opencode/skills/continuous-llm-red-teaming-with-promptfoo |
| **RabbitMQ** | Broker de mensajes. No usado. | 📍 — |
| **Redis** | Base clave-valor en memoria. No usada; caché LRU propio. | 📍 — |
| **RxJS** | Programación reactiva. No usado; React hooks propios. | 📍 — |
| **Secretlint** | Linter de secrets sobre archivos de config. | 📍 .secretlintrc.json |
| **Semgrep** | SAST estático. Referencia de skill DevSecOps. | 📍 .opencode/skills/implementing-devsecops-security-scanning |
| **Snyk** | SCA de dependencias. Referencia de skill DevSecOps. | 📍 .opencode/skills/ |
| **SonarQube** | Plataforma de calidad de código. No integrada; gates con ESLint/typecheck. | 📍 — |
| **Spark** | Motor de procesamiento distribuido. No usado. | 📍 — |
| **SQLite** | Base SQL embebida de archivo. Motor de Nexus y CodeGraph. | 📍 .runtime/gentle-vanguard.db |
| **Trivy** | Escáner de vulnerabilidades de contenedores/SCA. | 📍 .github/workflows/security.yml |
| **Trufflehog** | Detector de secrets en historial git. Complementa a secretlint. | 📍 .github/workflows/security.yml |
| **TypeScript** | JavaScript con tipos. Lenguaje de todo el stack (604+ TS files). | 📍 src/ · apps/web-dashboard/ |
| **Vercel** | Plataforma de deploy de frontends. Opción para las presentaciones. | 📍 docs/presentations/ |
| **Vite** | Bundler dev/build del dashboard. | 📍 apps/web-dashboard/vite.config.ts |
| **Vitest** | Framework de testing Vite-native (test:eval). | 📍 vitest.eval.config.ts |
| **Webpack** | Bundler clásico. No usado; se usa Vite. | 📍 — |
| **Windsurf** | Editor con IA; soportado en Layer 1 Tools. | 📍 docs/presentations/index.html |
| **witr** | Why Is This Running: traza procesos/puertos/archivos hasta su causa. | 📍 src/witr-wrapper.ts |
| **wscat** | Cliente WebSocket para pentest de APIs real-time. | 📍 .opencode/skills/testing-websocket-api-security |
| **ZAP** | OWASP Zed Attack Proxy: DAST de aplicaciones web. | 📍 .opencode/skills/implementing-devsecops-security-scanning |

## Ia/llm

| Término | Definición | En el repo |
| --- | --- | --- |
| **ANN** | Approximate Nearest Neighbor: búsqueda aproximada de vecinos cercanos en espacios vectoriales. | 📍 src/ml-embeddings |
| **Attention** | Mecanismo que pesa la relevancia entre tokens; base de los transformers. | 📍 Modelos externos (OpenAI/Anthropic) |
| **BERT** | Modelo transformer bidireccional (contexto izquierda+derecha). Referencia conceptual. | 📍 — |
| **BM25** | Algoritmo lexical de relevancia. Usado en retrieval-grader (CRAG) y web-research-select. | 📍 src/retrieval-grader.ts |
| **BPE** | Byte Pair Encoding: algoritmo de tokenización subpalabra usado por los LLMs. | 📍 — |
| **Cosine** | Similitud coseno entre vectores; métrica de embeddings. | 📍 src/ml-embeddings |
| **CRAG** | Corrective RAG: grada la relevancia del retrieval y hace keyword-fallback si es pobre. | 📍 src/retrieval-grader.ts |
| **DPO** | Direct Preference Optimization: optimización a partir de preferencias directas (RLHF sin reward model). | 📍 research/rlhf-dataset-search/ |
| **Embedding** | Vector de alta dimensión que representa semánticamente un texto. Usado en ML embeddings y caché semántica. | 📍 src/ml-embeddings |
| **GPT** | Generative Pre-trained Transformer: familia de LLMs. | 📍 — |
| **HNSW** | Hierarchical Navigable Small World: índice ANN usado en búsqueda vectorial. | 📍 src/ml-embeddings |
| **KV-Cache** | Caché de claves/valores de atención para acelerar inferencia. | 📍 — |
| **PPO** | Proximal Policy Optimization: algoritmo de RL para RLHF. | 📍 research/rlhf-dataset-search/ |
| **Quantization** | Reducción de precisión numérica de modelos para acelerar inferencia. | 📍 — |
| **RAG** | Retrieval-Augmented Generation: generación asistida por recuperación de contexto. | 📍 src/rag-retrieval.ts |
| **RLHF** | Reinforcement Learning from Human Feedback: alineación con feedback humano. | 📍 research/rlhf-dataset-search/ |
| **SFT** | Supervised Fine-Tuning: ajuste fino supervisado. | 📍 research/ |
| **TF-IDF** | Term Frequency-Inverse Document Frequency: peso estadístico de términos. | 📍 referencia de BM25 |
| **Token** | Unidad mínima de texto que procesa un LLM. Budget 5M/día, 3M/sesión. | 📍 config/token-budget-guard.json |
| **Tokenizer** | Componente que convierte texto en tokens. | 📍 — |
| **Transformer** | Arquitectura de atención que define los LLMs modernos. | 📍 — |
| **Vector** | Array numérico que representa datos en espacio semántico. | 📍 src/ml-embeddings |

## Operación

| Término | Definición | En el repo |
| --- | --- | --- |
| **Apps on-demand** | Modelo en el que cada app se inicia bajo demanda y no es detenida por el cierre de sesión mientras esté sana. | 📍 Command Center · process hygiene |
| **DAEMON_CLASSES** | Registro de clases de daemons que el reaper protege, incluidas las apps on-demand sanas. | 📍 src/core/process-hygiene.ts |

## Sigla

| Término | Definición | En el repo |
| --- | --- | --- |
| **ADR** | Architecture Decision Record: documento que captura una decisión arquitectónica, su contexto y consecuencias. | 📍 docs/adr/ (ADR-0001 a ADR-0012) |
| **ADV** | Agente de verificación (SDD-verify): testing, validación y quality gates del ciclo SDD. | 📍 .opencode/skills/ · sdd-verify |
| **BA** | Business Analyst: rol del agente sdd-explore — recopila requisitos, analiza y aclara. | 📍 sdd-explore |
| **BAD** | Business Analysis Document: documento de análisis de negocio del ciclo SDD. | 📍 docs/sdd/ |
| **DEV** | Developer: rol del agente sdd-apply — generación de código, features, refactor. | 📍 sdd-apply |
| **FF** | Feature Flag: alternancia de funcionalidades. Sinónimo de FeatureFlag. | 📍 skill ab-testing |
| **KB** | Knowledge Base: base de conocimiento del stack. | 📍 docs/knowledge-base/ · src/knowledge-base-manager.ts |
| **KPI** | Key Performance Indicator: indicador clave de rendimiento. | 📍 docs/ · dashboard |
| **MCP** | Model Context Protocol: protocolo de contexto para herramientas de IA. | 📍 src/mcp/ · config/mcp.json |
| **OPS** | Operations: rol del agente ops-agent — deploy, CI/CD, infra. | 📍 ops-agent |
| **OTLP** | OpenTelemetry Protocol: formato de exportación de trazas. | 📍 src/tracing-instrument.ts (4318) |
| **PAD** | Preliminary Architecture Document: documento de arquitectura preliminar del ciclo SDD. | 📍 docs/sdd/ |
| **PIE** | Proactive Intelligence Engine: analiza señales y sugiere acciones proactivas. | 📍 src/proactive-intelligence-engine.ts |
| **QA** | Quality Assurance: rol del agente sdd-verify — testing, validación. | 📍 sdd-verify |
| **RDD** | Receipt-Driven Development: desarrollo guiado por recibos/revisiones. | 📍 src/rdd/ |
| **RTK** | Routing Table (tabla de ruteo aprendida del stack). | 📍 .session/routing/routing-table.json |
| **SAD** | System Architecture Document: documento de arquitectura del ciclo SDD. | 📍 docs/sdd/ |
| **SDD** | Spec-Driven Development: ciclo explore→design→apply→verify con contratos. | 📍 sdd-explore/design/apply/verify |
| **SIA** | Self-Improving Agent: agente que se auto-mejora iterativamente. | 📍 src/sia-orchestrator.ts |
| **SLO** | Service Level Objective: objetivo de nivel de servicio (error budget). | 📍 src/performance-slo-monitor.ts |
| **WAL** | Write-Ahead Log: registro de escrituras anticipadas de SQLite (checkpoint >1MB auto). | 📍 Nexus DB |

## Stack

| Término | Definición | En el repo |
| --- | --- | --- |
| **Adaptive Steps** | Sistema que auto-escala el presupuesto de steps de orquestador y subagentes según complejidad de la tarea y historial. | 📍 src/adaptive-steps.ts |
| **Agent Bus** | Bus de mensajes entre agentes del stack (comunicación asíncrona inter-agentes). | 📍 src/agent-message-bus.ts |
| **Auto-Apply Safe** | Motor ejecutivo que aplica cambios de forma segura: trigger→eval(≥80%)→apply→verify→rollback (máx. 5/día, rollback si >15%). | 📍 src/ · auto-apply-safe |
| **Auto-Escalation** | Escalación en 3 niveles (warning 3 → critical 5 → emergency 10) con audit trail completo. | 📍 src/ · auto-escalation |
| **Auto-Norm Learner** | Descubre patrones recurrentes y escribe LEARNED-NORMS.md (el stack evoluciona sus propias reglas). | 📍 src/ · auto-norm-learner |
| **Auto-Url Fix** | Fix automático del patrón roto import.meta.url en 33 archivos (CLI Guard). | 📍 src/auto-url-fix.ts |
| **Azure Delegator** | Delegador de tareas a Azure dentro de los cloud connectors híbridos. | 📍 src/azure-delegator.ts |
| **Backlog** | CLI de gestión de backlog con prioridades, severidades, estados y reportes markdown. | 📍 src/cli/backlog.ts |
| **Cache** | Caché LRU de respuestas (response_cache con clave SHA256 y TTL) + caché semántica por embeddings. | 📍 apps/web-dashboard/server/database/ |
| **Checkpoint** | Punto de restauración del estado de sesión (create/list/verify/prune). | 📍 src/checkpoint-manager.ts |
| **Circuit Breaker** | Patrón de 3 estados (CLOSED/OPEN/HALF_OPEN). 5 fallos→OPEN, 2 éxitos→CLOSED. | 📍 src/circuit-breaker-api.ts |
| **CodeGraph** | Grafo de conocimiento SQLite para inteligencia de símbolos (AST). 10.000+ nodos, 20.000+ aristas. | 📍 src/ · .codegraph/ |
| **Dashboard** | SPA React/TS/Vite de observabilidad con WebSocket (5s), 7 secciones, i18n y 8 alertas. | 📍 apps/web-dashboard/ |
| **Delegation** | Modelo de delegación del orquestador a subagentes por confianza y tipo de tarea. | 📍 src/route-and-delegate.ts |
| **Design Tokens** | Sistema de tokens de diseño (colores, tipografía, spacing) con CLI de generación/validación. | 📍 src/design-tokens.ts · config/design-tokens.json |
| **Doubt-Driven Dev** | Revisión adversarial con contexto fresco para errores y código crítico. | 📍 .opencode/skills/doubt-driven-development |
| **Engram** | Memoria persistente que sobrevive sesiones y compactaciones (3,600+ observaciones). | 📍 src/engram-* · MCP engram |
| **Event Sourcing** | Event store append-only con cadena de hash SHA-256 (tamper-proof) + saga orchestrator. | 📍 src/event-sourcing.ts · src/saga-orchestrator.ts |
| **GGA** | Guardrail-Gated Agent: orquestador con compuertas de guardrails en la delegación. | 📍 src/gga.ts |
| **Graphify** | Grafo de conocimiento del proyecto (god nodes, comunidades, 4MB) con CLI query/explain/path. | 📍 src/cli/graphify.ts · graphify-out/ |
| **Guardrails** | Compuertas de seguridad pre-input que rechazan prompts inseguros. | 📍 src/safety-guardrails.ts |
| **Hashline** | Utilidad de hashing de líneas para integridad. | 📍 src/tools/hashline.ts |
| **Hooks** | Git hooks gestionados por Lefthook (pre-commit, post-commit, post-merge). | 📍 .lefthook.yml |
| **Humanizer** | Transforma texto técnico/IA en prosa humana con scoring de legibilidad. | 📍 src/humanizer.ts |
| **Idea Refine** | Pensamiento divergente→convergente para afinar ideas. | 📍 .opencode/skills/idea-refine |
| **Image Studio** | App CMS de generación de imágenes del stack. | 📍 docs/presentations/image-studio.html |
| **Karpathy Guidelines** | Estándares de código: Think First, Simplicity, Surgical Changes, Goal-Driven. | 📍 rules/ · skill |
| **Maintenance Watchtower** | Orquestador central de health/autoheal: 35 componentes vigilados, 6 modos. | 📍 src/core/maintenance-watchtower.ts |
| **Migration** | Evolución del esquema de Nexus (22 migraciones). | 📍 apps/web-dashboard/server/database/ |
| **ML Embeddings** | Índice vectorial para búsqueda semántica sobre skills, normas y docs. | 📍 src/ml-embeddings |
| **Nexus** | Base de datos operacional SQLite (WAL, FK ON, 44 tablas, 22 migraciones). Cerebro operacional. | 📍 .runtime/gentle-vanguard.db |
| **Pipeline** | Pipeline de sesión: 31 Phase-1 paralelos + 78 lazy background. | 📍 config/session-autostart.config.json |
| **Retrieval Grader** | Gradúa relevancia de chunks con BM25 y dispara keyword-fallback (CRAG). | 📍 src/retrieval-grader.ts |
| **Rollback** | Restauración de estado desde checkpoint con validación dry-run. | 📍 src/rollback-orchestrator.ts |
| **Route-and-Delegate** | Recomienda agente + delega con tiering de temperatura (M6). | 📍 src/route-and-delegate.ts |
| **Router Adaptativo** | Router que persiste routing_rules con hit_count y sugiere rutas. | 📍 src/adaptive-router.ts |
| **Secret Scanner** | Detector nativo de secrets (80 patrones, entropy opcional). | 📍 src/secret-scanner.ts |
| **Session Scoring** | Scoring de calidad por sesión (delegaciones, correcciones, proactivos). | 📍 session_scoring |
| **Session-Autostart** | Pipeline de inicio de sesión: 31 pasos Phase-1 + 78 lazy. | 📍 src/session/session-autostart.ts |
| **Session-Close Orchestrator** | Orquestación del cierre de sesión (guardian + reportes). | 📍 src/session-close-guardian.ts |
| **Snapshot** | Captura completa del estado (create/list/cleanup). | 📍 src/snapshot-manager.ts |
| **Stack Verify** | Verificador de integridad del stack completo. | 📍 src/stack-verify.ts |
| **Structural Compression** | Compresión estructural (SmartCrusher, LogCompressor, BM25, CrossCompression) con seguridad por modo. | 📍 src/structural-compression.ts |
| **Token Ingest** | Daemon agnóstico que lee tokens reales desde la DB de la herramienta. | 📍 src/token-ingest.ts |
| **Watchtower** | Ver Maintenance Watchtower. Modos: health, rebuild, autoheal, report, continuous, all. | 📍 src/core/maintenance-watchtower.ts |
| **Web Crawler** | Crawler dual-provider (Firecrawl → Jina/DDG/Bing) con cache por provider. | 📍 src/web-crawler.ts |

## Ui

| Término | Definición | En el repo |
| --- | --- | --- |
| **Design System GV** | Tokens y estilos compartidos por las apps del stack mediante gv-design-system.css. | 📍 assets/gv-design-system.css |
