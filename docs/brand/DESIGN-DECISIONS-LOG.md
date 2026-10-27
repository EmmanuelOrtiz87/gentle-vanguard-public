# DESIGN DECISIONS LOG — Registro de decisiones de diseño y marca

> **Patrón:** `rules/HOMOLOGACION-MULTI-TOOL.md` (log de decisiones + anti-repetición).
> **Regla:** toda decisión de identidad, estilo, estructura visual u organización de activos se
> registra AQUÍ antes de implementarse, aplique o no. Las **oportunidades de mejora** detectadas en
> el trabajo diario se plantean en la sección 3 y el owner decide juntos si se implementan.
> **Autoridad normativa:** `rules/NORMATIVA-DESIGN-SYSTEM.md` · **Canon técnico:** `docs/brand/TOKENS-v2.json`
> (v2.1.0) · **Kit operativo:** `docs/brand/BRAND-KIT.md` · **ADR de marca:** `docs/adr/ADR-0033-nueva-identidad-marca-v3.md`

---

## 1. Decisiones sancionadas (aplican)

**DD-20261020-01 — Catálogo central de diagramas.** A pedido del propietario, las vistas generales de arquitectura, operación, continuidad y planificación se reúnen en `docs/presentations/diagrams.html`, con fuentes y descripciones accesibles; cada presentación conserva únicamente gráficos contextuales. La navegación compartida enlaza a esa página en lugar de anclar una galería al índice. La composición usa los tokens y fuentes del paquete, con desplazamiento horizontal etiquetado para diagramas anchos. El resumen de estado en el índice distingue evidencia local fechada de readiness de producción e identifica explícitamente los pendientes Nexus, calibración y CI hosted. El registro y los checks detectan drift estructural; no certifican todas las traducciones, contenido histórico ni funciones del stack.

**DD-20261019-02 — Academy como continuidad de la web, con un único recorrido de catálogo.** El propietario señala que el comparador de precios duplica la navegación y dificulta recuperar todo el material. Se retira ese comparador: precios en fichas, pack separado con consulta, una sola propuesta de acompañamiento. Vista inicial con 86 materiales, tipo/tema/búsqueda visibles y reset persistente que restaura todos los criterios y la página. Academy incorpora cabecera de marca, botón de empresa, menú móvil, tema claro/oscuro compartido, back-to-top e ilustración conceptual de aprendizaje propia, conservando contenidos, precios y el waiver de idioma español. Shell/fuentes/tokens de Academy pasan al sync canónico reproducible. La composición comercial conserva su propósito y no copia el contenido ni las promesas de la web corporativa.

**DD-20261019-01 — Páginas de catálogo y claridad comercial.** El propietario solicita reemplazar la carga acumulativa por páginas numeradas con Anterior/Siguiente, estado actual, filtrado y foco accesible. Academy presenta los cinco importes fijos desde el store y reúne acompañamiento, mentoría y programas en una única propuesta con presupuesto previo; no se restauran automáticamente tarifas históricas ni se cambian precios o modos de venta. El alcance se presenta con jerarquía editorial, iconos SVG y arte oficial del sitio; requisitos y exclusiones se conservan, incluido el detalle docente. `landing-sections.mjs` y `offers.css` mantienen la composición en futuras regeneraciones. Se aplica al catálogo comercial, sin convertirlo en norma visual de todas las apps.

**DD-20261018-03 — Catálogo público legible y comparable.** A solicitud del propietario, Academy conserva marca GV y su waiver comercial, con tarjetas de portada/tipo/título/resumen/metadatos/precio/compra, descripción completa en diálogo nativo progresivo y grilla de 1/2/3/4 columnas. Carga por filas completas, búsqueda global y estado vacío recuperable. Se normalizan espacios en el render del generador; no se cambian catálogo, precios ni modalidades. Movimiento de portada/hover y diálogo desactivable por reduced-motion. Esta composición pertenece al catálogo público; no reemplaza el shell de las apps operativas. Fuente: `apps/academy-landing/DESIGN.md`.

**DD-20261018-02 — Presentaciones y presencia pública unificadas.** A pedido del propietario, Arquitectura es la referencia del shell de las 25 presentaciones: mismo header, icono oficial, controles, footer, fuentes y aliases semánticos. Los carteles de revisión editorial se eliminan del generador; procedencia y límites quedan en el registro JSON/README. Los estudios conservan su función y sus canvases. Web corporativa y Academy se publican desde un único export/repositorio: raíz y `/academy/`, con una app en Command Center. Contrato: `docs/architecture/public-web-presence.md`. La homogeneidad visual no certifica todo el contenido histórico ni cada función de los estudios.

**DD-20261017-03 — Navegación larga, diagrama e i18n.** El owner corrigió la posición del back-to-top: derecha inferior, patrón nativo `.gv-back-to-top` en shell y Motion & UX Standard. En corporate-web la franja aislada se integra en método; el diagrama usa un núcleo dimensional y tres entradas seleccionables, con todas las salidas legibles; FAQ exclusivo y cierre al click fuera/Escape; selector con globo y traducción de contenido, etiquetas y metadatos. No se modifica la identidad ni se publica en un destino remoto sin resolverlo.

**DD-20261017-02 — GentleVanguard y superficies continuas.** El owner confirmó nombre público unido en todos los textos actuales, además del wordmark (amplía DD-20261005-01). `config/brand.json` alinea name/displayName. No renombra slugs técnicos ni reescribe historia. En corporate-web se elige el SVG transparente oficial para evitar la placa visible del PNG. Refinamiento aprobado: tres escenas de servicios con arte dimensional/movimiento, señales múltiples en hero, spotlight, botones primarios del shell y back-to-top inferior izquierdo con progreso. Las imágenes son conceptuales; no se presentan oficinas o equipo inventados.

**DD-20261017-01 — Prevenir drift desde la entrada y verificar la cascada.** El owner pidió corregir la repetición de inconsistencias y eligió para corporate-web una composición cinematográfica con arte 3D y conexiones animadas, preservando la identidad oficial. La skill de marca pasa a referenciar el Brand Kit, tokens, activos y paquete vigentes en lugar de prescribir una identidad histórica. Las estáticas cargan shell → tokens → composición, sin redefinir `--gv-*`. El gate existente incorpora `--url` para comprobar tokens renderizados en dark/light y fuentes/identidad, además de sus controles de fuente. Evidencia inicial: cuatro overrides de tema claro en corporate-web y test de contrato de skill fallaron antes del fix. No cambia la paleta ni habilita migraciones masivas de apps.

| ID | Fecha | Decisión | Contexto / Razón | Evidencia |
|---|---|---|---|---|
| DD-20260901-01 | 2026-09-01 | v2 Premium como identidad (bg `#0F1115`, cyan `#22d3ee`, purple `#a78bfa`) | Decisión inicial de marca del owner | `BRAND-DECISION-2026-09-01.md` (hoy SUPERSEDED) |
| DD-20260908-01 | 2026-09-08 | **v2.0 APPLICATION FINAL = identidad OFICIAL** (monograma GV geométrico centrado 1024×1024, paleta Midnight `#0B1020` / Cyan `#06B6D4` / Violeta `#8B5CF6`, gradiente 3-stop `#6E4DEB→#7B63E8→#06B6D4`) | Owner validó el set y ordenó formalizarlo como oficial y productivo | `ADR-0033` (accepted) + propagación LIVE del logo |
| DD-20260928-01 | 2026-09-28 | **Poppins 700 = display font oficial**; Inter body; JetBrains Mono NL mono | Fix del flip-flop: `config/brand.json` reverteía la fuente en cada `gv:tokens`. Unificadas las 3 fuentes de verdad | commit `e20df7500` |
| DD-20261001-01 | 2026-10-01 | **Cierre del canon único (Opción A): completar la propagación de ADR-0033.** El paquete `gv-design-system` + apps migran a los valores de `TOKENS-v2.json` v2.1.0. No se re-decide la identidad: se termina de ejecutar el decreto 2026-09-08 | Auditoría encontró 2 identidades paralelas "oficiales" (logo v2.0 + UI v2 Premium). Dejarlas conviviendo es exactamente el "parecido pero no igual" que el owner prohíbe | `docs/design/09-brand-canon-audit-2026-10-01.md` |
| DD-20261001-02 | 2026-10-01 | **Una sola serialización del logo.** `assets/logo.svg` (root) es el archivo canónico byte-a-byte; toda copia en `apps/<app>/public/` y `docs/brand/` debe ser idéntica (verificable por hash) | 3 serializaciones distintas de la misma marca detectadas (`556bfafd`/`bbbf513c`/`80a74e95`) | auditoría 09 |
| DD-20261001-03 | 2026-10-01 | **Prohibido importar el legacy congelado** `assets/gv-design-system.css` en apps. Las 3 apps que aún lo importan (archify, content-cms, prompt-studio) migran al paquete. El archivo queda dormido (no se borra) | El legacy ya no recibe evolución; su presencia produce stack CSS mixto (hasta 4 capas en prompt-studio) | auditoría 09 |
| DD-20261001-04 | 2026-10-01 | **Imports del design system solo vía export del paquete** (`@gentle-vanguard/design-system/...` o serve del canon en vanilla). Prohibido `../../../packages/...` relativo | Las rutas relativas de FS bypasean la superficie pública del paquete y rompen con reorganizaciones | auditoría 09 |
| DD-20261001-05 | 2026-10-01 | **Toda app Vite debe CARGAR las fuentes que declara** (link/@font-face). Declarar `--gv-font-display: Poppins` sin cargarla no cuenta como cumplimiento | 7 apps declaraban Poppins sin cargarla; el display canónico solo funcionaba si el SO la tenía instalada | auditoría 09 |
| DD-20261001-06 | 2026-10-01 | **Waivers de diseño para apps de clientes (opt-in).** Las apps nativas del stack cumplen el canon OBLIGATORIO. Las apps de clientes (`apps/wpp-bot`, etc.) pueden optar por identidad propia declarándolo en `apps/<app>/DESIGN-WAIVER.md` (fuente de la excepción + qué usa). Sin waiver = se espera canon | Regla del owner: clientes no necesariamente obligados, pero la opción debe existir y quedar documentada | `NORM-APP-001` (extiende) |
| DD-20261001-07 | 2026-10-01 | **Toda evaluación de homologación visual se registra aquí** (aplique o no). Anti-repetición de debates de diseño | Patrón HOMOLOGACION-MULTI-TOOL | — |
| DD-20261001-08 | 2026-10-01 | **Enforcement activo (W3):** conformance del paquete extendido a 28 checks (drift de canon: marca byte-idéntica, paleta SUPERSEDED prohibida en apps, fuentes cargadas, SoT↔dist, legacy dormido, config CLI) · watchtower `checkDesignCanon` + `checkRepoOrganization` · prepush layer `design-canon-conformance`. El canon deja de depender de disciplina manual | Modelo ventanas-fantasma (normativa + gate + watchtower) replicado para diseño | conformance 28/28, watchtower PASS |
| DD-20261002-01 | 2026-10-02 | **O-1 APROBADA — fuentes self-host nativas.** 12 woff2 (Poppins 300-700, Inter 400-700, JetBrains Mono 400-600, subsets latin, **SIL OFL 1.1**) versionadas en `packages/gv-design-system/dist/fonts/` + `dist/fonts.css` (export `./fonts.css`) + snapshot raíz `assets/gv-fonts.css`+`assets/fonts/`. Apps Vite: import del export (woff2 embebidos en build). Vanilla (CC, sandbox, portal, web, landing, hub ×13): `/gv-fonts.css` + `/fonts/*` servidos/copiados local. **Cero CDN en la UI del stack** (quedan solo: preview dinámico de `wordmark-builder.js` y @import dentro de los SVG oficiales). Apps resuelven offline (ADR-0017) | Owner aprobó avanzar con todo; local-first + misma fuente garantizada siempre | builds 7/7, woff2 en dist, conformance 29/29 |
| DD-20261002-02 | 2026-10-02 | **O-6 APROBADA — overrides redundantes eliminados.** gv-analytics: solo aliases app-específicos (`--gv-bg-rgb`, `--gv-violet`, `--gv-header-height` 62px). prompt-studio: bloque :root completo eliminado (paquete = única fuente). Verificado con build + screenshot (wordmark gradiente OK) | El paquete ya es canon; duplicar valores era la clase de drift original | build OK + screenshot |
| DD-20261002-03 | 2026-10-02 | **O-2 RESUELTA — academy-landing queda con estructura propia + waiver.** Tokens/fuentes/marca canónicos (ya migrados), shell GV NO aplica (página de conversión pública). `apps/academy-landing/DESIGN-WAIVER.md` | El shell de "app" no sirve al patrón de conversión; alinear identidad basta | waiver creado |
| DD-20261002-04 | 2026-10-02 | **O-3 DECIDIDA — NO renombrar normativas masivamente.** El índice generado (`rules/README.md`, 64 entradas) + convención nueva (`NORMATIVA-<DOMINIO>.md`/`NORM-<ID>-<tema>.md`) es la homologación; renames romperían referencias cruzadas. Renames puntuales solo con oportunidad | Anti-rotura; el valor (navegabilidad) ya está cubierto | índice generado |
| DD-20261002-05 | 2026-10-02 | **O-4 APROBADA — Git LFS para binarios pesados FUTUROS.** `git-lfs 3.7.1` disponible: `.gitattributes` (zip/mp4/mov/psd/ai/eps/pdf) sin rewrite de historia + `git lfs pre-push` encadenado en lefthook pre-push. Los PNG/PDF históricos quedan en git | Repo privado, LFS presente; sin rewrite = cero riesgo de historia | lfs install OK |
| DD-20261002-06 | 2026-10-02 | **O-5 MITIGADA — igualdad SoT↔paquete value-by-value en conformance** (20 valores + gradiente + fuentes mapeados y comparados; drift imposible de pasar por alto). El refactor "paquete consume TOKENS-v2.json directo" queda diferido hasta que haya motivo (el mapeo de schemas W3C↔paquete es real pero arriesgado sin necesidad inmediata) | Mismo resultado (cero drift) a 10% del costo y riesgo | conformance 29/29 |
| DD-20261002-07 | 2026-10-02 | **O-7 RESUELTA — `gv:tokens` byte-idempotente** (header sin timestamp; trazabilidad en git). Dos corridas consecutivas = mismo hash | El flip-flop histórico era de valores (resuelto 09-28); el timestamp ensuciaba diffs | verificado md5 igual |
| DD-20261005-01 | 2026-10-05 | **Wordmark "GentleVanguard" SIN espacio (canon único).** Markup canónico `Gentle<span>Vanguard</span>` — «Gentle» blanco, «Vanguard» gradiente. REEMPLAZA la nota del 2026-09-28 ("el espacio es parte de la marca"). Alinea los topbars con el bitmap oficial `gv-wordmark-official.png` (brand kit v2) y los sellos de footer (patrón genesis D-30), que siempre fueron pegados. El nombre de marca en UI/documentación oficial del stack es **GentleVanguard** (alt/aria y textos en mayúsculas tipo `GENTLE VANGUARD ACADEMY` quedan fuera del wordmark). Pendiente: regenerar los lockups SVG del brand kit (`logo-horizontal*.svg` traen `dx="20"`) | El owner reportó drift visible: apps con espacio y sin espacio conviviendo. El bitmap oficial nunca tuvo espacio; el canon 09-28 quedó en minoría y su test ya fallaba (11/20, 55%) | wordmark.test.ts 11/11 PASS + homologate --check sin cambios + barrido en 11 apps UI |

### DD-20261018-02 — Consumo activo y evidencia separada del cierre integral

La propagación se verifica sobre entradas activas, no sobre todos los archivos con el mismo nombre. El sync explícito de snapshots y su check en CI preservan copias inactivas e identidades de clientes. La lectura runtime normaliza CSS compilado con el navegador y evita transiciones de la sonda; la regresión conserva la detección de colores incorrectos. El control de Agenda deja de aceptar azure/purple históricos como canon. Base de 21 superficies/84 casos comprobada; el smoke de idioma no certifica traducciones completas. Brechas, waivers y revisión documental se mantienen explícitos en [la matriz](../design/10-native-homologation-2026-10-18.md), sin declarar homologación integral por aprobar tokens.

## 2. Matriz de estatus de identidades (VEREDICTO ÚNICO)

| Variante | Estatus | Dónde queda |
|---|---|---|
| **v2.1.0 — v2.0 APPLICATION FINAL (canon)** | ✅ **OFICIAL — ÚNICA** | `docs/brand/TOKENS-v2.json` + paquete + apps |
| v2 Premium (2026-09-01) | 🗄 SUPERSEDED | historia de git + banner en `BRAND-DECISION-2026-09-01.md` |
| v3 GV New Identity (SVG Master Pack) | 🗄 HISTÓRICO (reemplazada por v2.0) | `assets/brand/v3-candidate/` (archivar, W2) |
| Primer set v3 (SVG NEW FINAL, canvas 1000) | 🗄 HISTÓRICO | `docs/brand/assets/v3/` (consolidar con el anterior, W2) |
| Design-system `#121212`/Orbitron (ADR-0026 alpha) | 🗄 DEPRECADO | solo historia de git |
| v3 Kinetic (lime/Outfit) | 📦 EXPERIMENTO | Design Hub > Labs (no es marca) |
| Tema claro `web-dashboard` | ⚠️ WAIVER documentado | `apps/web-dashboard/DESIGN-WAIVER.md` (W1) — densidad de datos, accent alineado a canon |

## 3. Oportunidades de mejora — RESUELTAS (2026-10-02)

| # | Oportunidad | Resolución |
|---|---|---|
| O-1 | Self-host de fuentes vs CDN | ✅ **DD-20261002-01** — self-host nativo (12 woff2 OFL en el paquete), CDN eliminado |
| O-2 | academy-landing alineación mínima vs shell completo | ✅ **DD-20261002-03** — mínimo (hecho) + waiver de estructura propia |
| O-3 | Renombrado masivo de normativas vs índice | ✅ **DD-20261002-04** — índice + convención nueva; sin renames |
| O-4 | Git LFS vs archivar | ✅ **DD-20261002-05** — LFS para binarios pesados futuros, sin rewrite |
| O-5 | `gv:tokens` única puerta | ✅ **DD-20261002-06** — mitigado: igualdad SoT↔paquete value-by-value en conformance; refactor completo diferido |
| O-6 | Eliminar overrides redundantes de apps | ✅ **DD-20261002-02** — eliminados (aliases app-específicos preservados) |
| O-7 | Timestamp rompe idempotencia de `gv:tokens` | ✅ **DD-20261002-07** — header sin timestamp, byte-idempotente verificado |

---

> **Uso:** al tomar una nueva decisión, agregar fila en §1 con ID `DD-YYYYMMDD-NN`, mover la
> oportunidad correspondiente de §3 a §1 si se aprueba, y actualizar la matriz §2 si cambia el
> estatus de una identidad.

### DD-20261017-04 — Contraste de uso y lectura pública

La igualdad de tokens no acredita el contraste del componente. Footer compartido usa texto semántico y target de 44px; el gate runtime existente verifica contraste de enlaces sólidos en ambos temas. Páginas públicas adaptan diagramas móviles antes de reducir etiquetas, con notas de al menos 12px como criterio de producto. QA nativa con axe-core fijado y Playwright Chromium/Firefox/WebKit; resultados incompletos y dispositivos físicos se declaran por separado. Se conserva identidad Poppins/Inter y paleta actual.

### DD-20261018-01 — Interacción oficial y composición por propósito

El owner solicita formalizar los avances corporativos y extender la homologación. Se incorpora al shell el patrón contextual `.gv-dialog`, con semántica nativa, lectura preservada y foco/teclado; corporate-web es la primera implementación con privacidad progresiva ES/EN/PT. Su firma de marca se eleva a cierre editorial. Se ratifican fuente/paleta existentes, foco por modalidad, flecha inferior derecha, movimiento controlado y captions sólo cuando aportan información. Cinemática y arte 3D pertenecen al contexto comercial: no son un mandato para apps operativas. Contrato detallado en Motion & UX Standard §§8–10; inventario de adopción de sólo lectura complementa conformance. El registro no acredita automáticamente homologación visual de todas las apps.

### DD-20261019-03 — Academy: continuidad cinematográfica con lectura comercial

El owner solicita llevar a Academy los fondos, separación editorial y movimiento de la web corporativa. Se mantienen tokens y tipografías oficiales, controles y arte propio de aprendizaje. Se incorporan capítulos visualmente diferenciados, topbar con estado de navegación, cierre de marca destacado, spotlight y transición de página del catálogo. El único foco decorativo continuo son dos recorridos SVG sobre el libro: pausa visible, suspensión fuera del viewport/pestaña y reduced-motion estático. No se añaden dependencias, testimonios, nuevas ofertas o cambios de precios. El registro documenta esta superficie comercial; no certifica homologación de toda la flota ni traducción de materiales.

### DD-20261019-04 — Una composición pública para cabecera y footer

Ante diferencias persistentes entre Academy y la web corporativa, el builder sirve una sola capa `public-chrome.css` para ambas rutas: métricas, marca completa en móvil, controles, cierre y footer. Se conserva navegación/contenido específico por propósito, sin modificar tokens oficiales. `web:chrome:verify` compara estilos renderizados en cuatro anchos y ambos temas; el gate público de export comprueba la referencia compartida. Esta adopción se limita a las dos superficies públicas, no migra automáticamente otras apps.
