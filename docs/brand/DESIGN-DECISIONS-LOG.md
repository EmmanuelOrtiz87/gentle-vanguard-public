# DESIGN DECISIONS LOG — Registro de decisiones de diseño y marca

> **Patrón:** `rules/HOMOLOGACION-MULTI-TOOL.md` (log de decisiones + anti-repetición).
> **Regla:** toda decisión de identidad, estilo, estructura visual u organización de activos se
> registra AQUÍ antes de implementarse, aplique o no. Las **oportunidades de mejora** detectadas en
> el trabajo diario se plantean en la sección 3 y el owner decide juntos si se implementan.
> **Autoridad normativa:** `rules/NORMATIVA-DESIGN-SYSTEM.md` · **Canon técnico:** `docs/brand/TOKENS-v2.json`
> (v2.1.0) · **Kit operativo:** `docs/brand/BRAND-KIT.md` · **ADR de marca:** `docs/adr/ADR-0033-nueva-identidad-marca-v3.md`

---

## 1. Decisiones sancionadas (aplican)

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
