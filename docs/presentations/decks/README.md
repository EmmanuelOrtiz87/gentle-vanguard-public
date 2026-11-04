# GentleVanguard Deck Canon (official presentation toolkit)

> Canonical toolkit for every company presentation: sales, enterprise, technical
> onboarding, internal docs and exhibitions. Built on the brand canon
> (`docs/brand/TOKENS-v2.json` v2.1.0 + `docs/brand/BRAND-KIT.md`).
>
> Last verified: 2026-11-02 · Owner direction: **hybrid** surface (dark covers and
> section dividers, light corporate content slides).

---

## 1. What this is

A declarative presentation generator. Three parts:

| Part | Where | Who edits it |
| --- | --- | --- |
| **Theme** (tokens, palette, type scale, geometry) | `theme/tokens.js` | Nobody. It mirrors the canon. |
| **Layout library** (16 page types) | `theme/layouts.js`, `theme/kit.js` | Nobody, unless a new page type is needed. |
| **Content** (what each slide says) | `content/*.js` | **Everybody.** Plain data, no layout knowledge needed. |

The rule: content files describe WHAT to say; the layout library owns HOW it looks.
That separation is what makes the template reusable company-wide.

## 2. The decks that ship

| Deck | File | Audience | Slides |
| --- | --- | --- | --- |
| Negocio y leads | `content/gv-negocio-leads.es.js` / `.en.js` | Business owners, lead generation | 13 |
| Enterprise | `content/gv-enterprise.es.js` / `.en.js` | Business and technology leadership, internal AI adoption | 13 |
| Onboarding tecnico | `content/gv-tecnico.es.js` / `.en.js` | Engineers joining or operating the stack | 14 |
| Direcciones visuales (registro de decision) | `content/gv-theme-candidates.es.js` | Internal: how the visual direction was decided | 7 |

The three production decks are bilingual (ES / EN) and every deck is editable
PowerPoint: text stays text, diagrams stay images, nothing is a flattened
picture of a slide.

`gv-theme-candidates` is not a sales deck: it is the **decision record** of the
visual canon (which direction won, which rule was kept, which was dropped). It
carries no repository counters on purpose - a record with numbers in it starts
lying a month later. See
[references/editorial.md](../../../../skills/gv-presentations/references/editorial.md).

## 2b. The speech (guion)

Every deck has a **speech** in [`speech/`](speech/README.md): what is actually
said out loud, slide by slide - the words, the time budget, the transition,
the questions that will come, and what must not be said.

The deck says *what* the slide shows; the speech says *how it is explained*.
Without it a presentation is improvised, and what gets improvised gets
invented (numbers the repo does not support, clients that do not exist).

```bash
npm run decks:guion    # coverage gate: one speech section per slide (blocking)
```

The gate is blocking on purpose: adding a deck without its speech creates a
presentation that gets presented blind.

## 3. Commands

```bash
cd docs/presentations/decks

npm install                  # pptxgenjs, react-icons, sharp (once)

node build/assets.js         # textures + rasterize the repo's own SVG diagrams
node theme/icons.js          # rasterize the icon matrix (cached in assets/icons)
node build/hero-assets.js    # compose the cover artwork (hero + navy scrim)
node build/lint-slides.js    # content gate: punctuation, accents, icons, layouts
node build/build-all.js      # compile every content file to output/<id>.pptx

# One deck only
node build/compile.js gv-enterprise-es

# Visual QA: export every slide to PNG with real PowerPoint
powershell -File build/export-all.ps1
powershell -File build/export-png.ps1 -Pptx output/gv-enterprise-es.pptx -OutDir output/preview/gv-enterprise-es

# Read-only PDF of every deck (same renderer, same fidelity)
node build/export-all-pdf.js        # PowerPoint COM on Windows, LibreOffice anywhere else
powershell -File build/export-all-pdf.ps1   # force the COM renderer

# PDF assembled from the preview PNGs: no Office, no LibreOffice, any OS
node build/export-png-pdf.js --all

# Colour gate: a raw canon accent used as TEXT on a light surface fails
python build/pptx-colors.py --check-all
python build/contrast-gate-selftest.py    # proves the gate actually fails

# The written manual (DOCX + PDF)
node build/manual.js

# Local preview server for the slide images
node build/serve.js 4177     # http://127.0.0.1:4177/output/preview/<deck>/Diapositiva1.PNG
```

From the repository root the same pipeline runs without changing directory:

```bash
npm run decks:lint         # content gate
npm run decks:build        # compile the 7 decks
npm run decks:build:one -- gv-enterprise-es
npm run decks:template     # official template (6 masters)
npm run decks:manual       # DOCX + PDF manual
npm run decks:hero         # recompose the cover artwork
npm run decks:export:png   # visual QA renders
npm run decks:export:pdf   # PDF companions (PowerPoint COM on Windows, LibreOffice elsewhere)
npm run decks:export:pdf:png  # PDF assembled from the preview PNGs (any OS, no Office needed)
npm run decks:qa:contrast  # colour gate (exit 1 on a violation)
npm run decks:qa:contrast:selftest
npm run decks:serve        # local preview server
```

> **`export:pdf` vs `export:pdf:png`**: the first renders the PPTX through
> PowerPoint COM (Windows) or LibreOffice (any OS) and is the fidelity
> reference. The second assembles a PDF from the preview PNGs with `sharp` and
> a minimal PDF writer: no Office, no LibreOffice, works everywhere. Use it on
> Linux/CI, or when you want a PDF that matches exactly what you saw in the
> PNG QA pass. Slide order is numeric (`Diapositiva10` comes after
> `Diapositiva2`, not before).

> **Clean clone**: the toolkit is a pnpm workspace member
> (`pnpm-workspace.yaml` -> `docs/presentations/decks`). `pnpm install` at the
> repository root installs `pptxgenjs`, `sharp` and `react-icons`, and every
> `npm run decks:*` command works from the root without any extra step.

> If a build fails with `EBUSY`, a PowerPoint process still holds the file.
> Close it (or `Stop-Process -Name POWERPNT -Force`) and rebuild.

## 4. Editing content

Open the content file and edit the data. No layout knowledge required.

```js
{
  layout: 'metrics',              // the page type
  eyebrow: 'LA DIFERENCIA',       // small uppercase kicker
  title: 'No vendemos horas',     // slide title
  lead: 'Una linea de contexto.', // optional second line
  items: [
    { value: '28', label: 'Apps propias', sub: 'Sistemas que hoy funcionan', accent: '06b6d4' },
  ],
}
```

### Available page types

| `layout` | Use it for | Key fields |
| --- | --- | --- |
| `cover` | Opening slide | `eyebrow`, `title`, `subtitle`, `meta[]`, `version` |
| `section` | Section divider | `number`, `title`, `lead`, `points[]` |
| `statement` | One big idea + up to 3 stats | `title`, `body`, `stats[]` |
| `cards` | 2, 3 or 4 parallel cards | `items[]` with `icon`, `heading`, `body` |
| `metrics` | Up to 8 numbers | `items[]` with `value`, `label`, `sub` |
| `compare` | Two columns, GV vs alternative | `left`/`right` with `head`, `sub`, `items[]` |
| `table` | Comparison or reference table | `headers[]`, `rows[][]`, `colW[]` |
| `timeline` | Phased process | `items[]` with `step`, `heading`, `body` |
| `layers` | Architecture by layer | `items[]` with `label`, `body` |
| `flow` | Chain of steps | `items[]` with `icon`, `heading`, `body` |
| `bullets` | Icon list, 1 or 2 columns | `items[]` with `icon`, `heading`, `body` |
| `figure` | Text + real diagram | `items[]`, `image`, `caption` |
| `figureLayers` | Message bullets + native layer stack | `items[]` (bullets), `layers[]` with `label`, `body` |
| `principle` | Three principles + closing statement | `items[]`, `closing` |
| `agenda` | Numbered contents | `items[]` with `heading`, `body` |
| `closing` | Call to action | `title`, `body`, `ctas[]`, `contacts[]`, `note` |

### Icon set

Icons are referenced by short key and rasterized to PNG at build time.
Available keys are listed in `theme/icons.js` (`ICONS`). Examples: `agent`, `shield`,
`gears`, `brain`, `database`, `cloud`, `users`, `money`, `lock`, `chart`, `layers`,
`route`, `tools`, `academy`, `mobile`, `rocket`, `compass`, `gears`, `flask`.

If you use a key that is not in the set, `build/lint-slides.js` fails the build.

### Diagrams

`docs/presentations/diagrams/*.svg` are the repository's own architecture diagrams.
`build/assets.js` rasterizes them to `assets/diagrams/*.png` and writes a
`manifest.json` with the true pixel ratio, because PPTX stretches images that do not
declare their own size. Reference them by file name:

```js
{ layout: 'figure', image: 'architecture-layers.png', caption: 'Arquitectura por capas' }
```

**A rasterized diagram is not editable and its text is unreadable when projected.**
At slide scale the body text of these SVGs measures ~5px on a 960px render. So the
architecture slides are drawn natively with `figureLayers` (bullets on the left,
layer stack on the right) and the process slides with `flow` / `timeline`: real
PowerPoint text, editable by hand, legible from the back of the room. `figure` is
kept for genuine product mockups (the observability dashboard), where the picture
is the point.

The repo diagrams are in Spanish, so they must not be reused in the EN decks. The
English decks use native layouts instead of translated images.

## 5. Writing rules for content (editorial red lines)

The company policy (`apps/corporate-web/PRODUCT.md`) forbids inventing clients,
testimonials, results, team size, locations and certifications. The decks follow it.

1. **No invented proof.** Internal apps are described as *our own developments*, never
   as client case studies. There are no testimonials in these decks, by design.
2. **Every number is verifiable.** Each figure on a slide maps to a file in the
   repository (`docs/generated/STACK-FACTS.md`, `config/quality-gates.json`,
   `package.json`, `docs/adr/`, `docs/templates/gv/precios/`). If you add a number,
   add the file that proves it.
3. **Stale numbers are not numbers.** `ARCHITECTURE.md` is outdated (it still says
   v3.5.0). The generated facts file is the current source.
4. **Prices are projections.** The price catalogue states there is no published 2026
   rate; ranges must be refreshed before each quote.
5. **No commitment without a signature.** The two packages under `docs/clientes/` are
   unsigned prospect drafts, not delivered client results.

## 6. Cover artwork (AI heroes)

The cover slides carry official artwork instead of a flat texture. The artwork is
generated with the AI image connector and then **composed** by the toolkit, because
a photo placed raw on a slide fights the text.

Pipeline:

1. **Generate** (AI): `assets/generated/hero-<key>.jpg`, 16:9, 2K, no text in the
   image. Three keys ship: `negocio` (network of nodes), `enterprise` (layered
   planes), `technical` (isometric topology). The prompts ask for the canon colors
   (navy `#0B1020`, cyan `#06B6D4`, violet `#8B5CF6`, gold `#fbbf24`) and negative
   space on the left.
2. **Compose** (`node build/hero-assets.js`): crop to the exact slide ratio, then
   bake a navy scrim ramp into the pixels -> `assets/generated/cover-hero-<key>.png`.
   PPTX has no gradient fill, so the transition is baked in the image instead of
   stacked from solid rectangles (which band).
3. **Use**: the deck root sets `hero: '<key>'` and the `cover` layout swaps the
   background and narrows the text column to 6.15in (title) / 5.5in (lead), so the
   title never runs over the bright part of the artwork.

```js
export default {
  id: 'gv-negocio-leads-es',
  theme: 'hybrid',
  hero: 'negocio',      // -> assets/generated/cover-hero-negocio.png
  slides: [ { layout: 'cover', ... } ],
}
```

To regenerate the artwork with new AI images, run the native pipeline:

```bash
npm run decks:hero:ai              # all heroes (AI generation + compose)
npm run decks:hero:ai -- negocio   # one hero
```

It calls the stack's own image generator (`src/cli/image-gen.ts`), which uses the
**connected image app** when there are no API keys, then DALL-E if a key exists,
then falls back to SVG. The prompt for each hero lives in
`content/heroes.json` (canon colors, negative space on the left, no text).
Afterwards `npm run decks:hero` recomposes the scrim — that step is deterministic,
so the art and the transition never drift apart.

## 7. Brand rules applied by the toolkit

- Slide background `#0B1020` (dark) and `#f5f7fb` (light), from `TOKENS-v2.json`.
- Official 3-stop gradient `#6E4DEB -> #7B63E8 -> #06B6D4`, used as a raster asset
  because PPTX has no native gradient fill.
- Titles in Poppins 700, body in Inter, code and figures in JetBrains Mono.
- The brand wordmark and icon are the official raster assets, byte-identical to the
  canon, copied via the derived transparent variants so they read as one with the
  slide instead of showing their dark plate.
- Accent surfaces and accent text are separate tokens: the light theme uses
  `#155e75` for accent text (6.78:1 on `#f5f7fb`), never the raw `#06B6D4`.
- No accent rule under titles. The only brand bar is the full-bleed top edge.

## 8. Fonts

`assets/fonts/*.ttf` are converted from the repository's self-hosted `woff2` files
(`build/convert-fonts.py`). PowerPoint cannot read `woff2`, so the TTFs must be
installed for the user account:

```powershell
powershell -File build/install-fonts.ps1
```

Only one file per family is registered: Poppins 400 and 700 (Regular and Bold),
Inter 400 and JetBrains Mono 400. The other weights of Inter and JetBrains Mono ship
as the same variable font file and would conflict in the registry.

## 9. Output

| Path | What |
| --- | --- |
| `output/<id>.pptx` | The editable deck |
| `output/<id>.pdf` | Read-only export (PowerPoint), for sharing by mail |
| `output/gv-template-oficial.pptx` | The official template: 6 masters (portada, portada con arte, contenido claro, contenido oscuro, separador, cierre) |
| `output/gv-manual-oficial.docx` / `.pdf` | The written manual: the company, the stack and how to use the canon |
| `output/<id>.mavis-ppt-map.json` | Element map sidecar for later targeted edits |
| `output/preview/<id>/DiapositivaN.PNG` | Real PowerPoint export, used for visual QA |
| `assets/generated/` | Textures, gradient assets and the cover artwork (`hero-*.jpg` + `cover-hero-*.png`) |
| `assets/icons/` | Rasterized icon matrix (cache) |
| `assets/diagrams/` | Rasterized stack diagrams + aspect manifest |
| `assets/fonts/` | TTFs converted from the repo's woff2 |

## 10. Adding a new deck

1. Copy the closest existing content file in `content/`.
2. Set `id` (ASCII only, no accents: it becomes a file name), `title`, `footer`, `theme`,
   and `hero` (the cover artwork key, if the deck has one).
3. Pick layouts from the table in section 4.
4. `node build/lint-slides.js` then `node build/build-all.js`.
5. Export and read the slides before sharing them.
