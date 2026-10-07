# Absorber 4 — `frontend-slides` — SKIP (decidido 2026-10-02)

> **Re-verificado 2026-10-06:** sin push nuevo desde 2026-06-23 (3,7 meses al
> momento del chequeo vía API de GitHub, no archivado). El SKIP sigue firme.

## Veredicto

**No absorber.** Verificado antes de decidir, no después.

## El candidato

| Campo | Valor |
|---|---|
| Repo | <https://github.com/zarazhangrui/frontend-slides> |
| License | MIT |
| Stars | 30,093 |
| Último push | **2026-06-23** (3,5 meses) |
| Contenido | 68 `design.md` de templates + `preview.md` por cada uno |

## Por qué se descarta

**1. Stale, y el resto del lote no lo está.** En la misma tanda de evaluación, `obra/superpowers` había
movido código esa semana. Este repo lleva 3,5 meses sin push. Absorber material sin mantenedor activo
crea un snapshot que nadie actualiza y que compite con lo que ya tenemos.

**2. Duplicaría cobertura que ya existe.** Contando solo los directorios relevantes del stack:

| Ya en el repo | Ficheros |
|---|---|
| `docs/presentations/` | 152 (24 decks HTML) |
| `skills/diagram-design/` | 145 |
| `skills/canvas-design/` | 83 |
| `skills/huashu-design/` | 175 (PPTX editable) |
| `apps/design-hub/` | 309 |

Unos 864 ficheros frente a 68 templates HTML. Lo que aportan los templates upstream es variety
estética de un tipo concreto de deck; lo que ya existe cubre diagramas, decks, canvas y PPTX con
enforcement de canon (`design-canon`, NORM-DESIGN-SYSTEM).

**3. Riesgo de canon.** Este stack tiene un canon de diseño cerrado (`docs/brand/TOKENS-v2.json`,
DD-20261001-*) con Poppins 700 / Inter / JetBrains Mono NL y prohibition de bounce-easing, grids
decorativos y em-dash. Templates de terceros traen su propia dirección visual y habría que auditarlos
uno a uno. Ese coste de auditoría es mayor que el beneficio de tener 68 layouts.

## Cuándo reconsiderarlo

- Si el proyecto necesita decks de cliente con estética de terceros como requisito explícito.
- Si el repo vuelve a hacer push Y publica un canario de mantenimiento.
- Si `docs/presentations/` deja de cubrirse y los decks HTML existentes no son suficientes.

## Lo que sí se conserva de esta evaluación

La **pregunta de la lista original** era útil: *¿puede el stack generar una presentación de pitch y
compartirla como enlace o PDF?* La respuesta ya la dan `docs/presentations/` (24 decks HTML
autocontenidos, uno por dominio del stack) y `huashu-design` (PPTX editable). No hace falta nada
externo.

---

# Absorber 6 — `last30days` — SKIP el paquete, HARVEST el diseño

## Veredicto

**No absorber el paquete. Absorber el diseño del pipeline cuando toqueazyar el crawler.**

| Campo | Valor |
|---|---|
| Repo | <https://github.com/mvanhorn/last30days-skill> |
| License | MIT |
| Stars | 63,372 (claim verificado, exacto) |
| Contenido | Un `SKILL.md` de **259.941 bytes** + dependencias Python ≥3.12 + API keys |

## Por qué no el paquete

Un único fichero de 260 KB es 65.000 tokens. El presupuesto de una skill en este stack es 1.000
tokens (700 si es CRITICAL), y `npm run skills:size` lo rechazaría en el mismo commit que lo
introdujera. Además arrastra un runtime Python que el stack no tiene y credenciales que habría que
gestionar.

## Lo que sí vale la pena copiar

El **diseño del pipeline**, que es bueno y aplicable a `src/web/web-crawler-cli.ts` y
`src/research/research-trends-cli.ts`:

| Elemento | Por qué importa aquí |
|---|---|
| Multi-fuente con ranking | El crawler ya tiene dos proveedores (Firecrawl, Jina) + DDG y Bing RSS; le falta el criterio de fusión explícito |
| Confidence floor con empty-state honesto | Coherente con `honest-numbers`: un resultado sin evidencia se declara vacío, no se rellena |
| Salida ordenada por interacción | El crawler devuelve texto crudo; el criterio de orden es lo que convierteChar en informe |

Esto es un ítem de trabajo futuro, no una absorción. Cuando se implemente, el diseño queda como
referencia en el propio crawler.

---

# Resumen de los 12 candidatos

| # | Candidato | Veredicto |
|---|---|---|
| 1 | Gstack | SKIP (telemetría y binarios) |
| 2 | superpowers | **ADOPT** (`verification-before-completion`) |
| 3 | taste-skill | YA ABSORBIDO como `ui-taste` |
| 4 | ui-ux-pro-max | **HARVEST DATA** (192 paletas + 74 font pairings) |
| 5 | marketingskills | YA ABSORBIDO (familia CRO/copywriting) |
| 6 | last30days | SKIP paquete / harvest diseño |
| 7 | frontend-slides | SKIP (stale + duplicado) |
| 8 | humanizer | **ADOPT** (26 patrones + regla lint) |
| 9 | brag | SKIP (servicio comercial) |
| 10 | claude-for-legal | SKIP (sin white-label) |
| 11 | caveman | **DOCTRINA** (`honest-numbers`) |
| 12 | awesome-claude-skills | SKIP (sin licencia; 832/864 wrappers) |

**2 absorbidos como skills, 1 doctrina, 1 harvest de datos, 3 ya étaient, 6 descartados.** Ningún
nombre duplicado: donde el contenido ya existía, seJap enrichmentó el skill existente en vez de
crear un nombre paralelo.