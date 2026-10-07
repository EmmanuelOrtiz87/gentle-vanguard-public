# src/web — Web crawler + research CLI

Herramientas de recolección web del stack:

- **`web-crawler-cli.ts`** — crawler dual-provider: Firecrawl → Jina Reader +
  DuckDuckGo + Bing RSS. GOTCHAS operativos: Jina bloquea UA de navegador;
  decodificar `uddg` de DDG; Bing solo vía RSS.
- **`witr-cli.ts`** — traza causal de procesos/puertos (`process|port`).

## Diseño de pipeline harvestado de `last30days` (ABSORBER 6, referencia)

`docs/brand/reference/ABSORPCION-CANDIDATOS.md` evalúa el skill
`last30days-skill` (MIT, 63k stars): **el paquete NO se absorbe** (un
SKILL.md de 260 KB = ~65k tokens, runtime Python, API keys). Lo que sí se
harvestea es el **diseño del pipeline**, como criterio de evolución para
`web-crawler-cli.ts` y `research-trends-cli.ts`:

| Elemento del pipeline | Estado en el crawler | Qué falta para llegar ahí |
|---|---|---|
| **Multi-fuente con ranking** | 2 proveedores (Firecrawl, Jina) + DDG + Bing RSS | Criterio de fusión explícito entre fuentes (hoy: fallback secuencial, no merge rankeado) |
| **Confidence floor con empty-state honesto** | Errores estructurados por proveedor | Umbral de confianza declarado; resultado sin evidencia se devuelve VACÍO, no rellenado (coherente con `honest-numbers`) |
| **Salida ordenada por interacción** | Texto crudo en orden de llegada | Criterio de orden (interacción/recencia/autoridad) que convierte resultados en informe |

Estos tres puntos son el plan de evolución del crawler cuando toque. La
referencia del diseño original vive en el repo upstream
(`mvanhorn/last30days-skill`) y en el doc de candidatas citado arriba.
