# Upstream design reference data

Absorbed from `nextlevelbuilder/ui-ux-pro-max-skill` (MIT, 132,547 stars) on 2026-10-02. Only the
data was absorbed, not the skill body. See `ATTRIBUTION.md` in the skill for why.

| File | Rows | Contents |
|---|---|---|
| `paletas-upstream.csv` | 192 | Product-type palettes. Each row already carries the **on-colour** for every swatch (primary, secondary, accent, destructive), plus background/foreground/card/muted/border/ring |
| `font-pairings-upstream.csv` | 74 | Heading + body font pairs, category, mood keywords, best-for, Google Fonts URL, CSS `@import`, Tailwind config |

## Why the data and not the skill

The upstream skill is a design generator. Adopting it would conflict with
`rules/NORMATIVA-DESIGN-SYSTEM.md` and the DD-20261001 decisions that fixed the brand canon at v2.0
APPLICATION FINAL (bg `#0B1020`, cyan `#06B6D4`, violet `#8B5CF6`, Poppins 700 / Inter / JetBrains
Mono NL). The skill's own anti-AI-slop rules overlap with this stack's `impeccable` config.

The two CSVs are the genuinely additive part: they are reference material for a designer to choose
from, not an opinionated system to obey.

## What upstream already did for you

Every palette row ships with its contrast pair pre-computed: `Primary` with `On Primary`,
`Destructive` with `On Destructive`, and so on. The notes column records when a value was adjusted for
contrast, e.g. *"Trust blue + orange CTA contrast [Accent adjusted from #F97316]"*. That means a
palette copied from here is not a starting point that still needs a contrast pass; it is a finished
token set.

Each font pairing ships with a working Google Fonts URL, a CSS `@import`, and a Tailwind config
snippet, so adopting one is copy-paste rather than a lookup.

## How to use it without breaking the canon

**These are alternatives, not defaults.** The GV canon in `docs/brand/TOKENS-v2.json` is what ships.
A palette from this file is only adopted through the normal design process: a proposal, a decision
entry, and the `design-canon` watchtower check.

- **A new app** with no waiver follows `packages/gv-design-system`. Do not pick from here first.
- **A client app with a `DESIGN-WAWAIVER.md`** may choose from here. Record the choice and why.
- **A landing page or a pitch deck** may choose from here freely, since it does not change product
  tokens.

If you find yourself reaching for this file to override the canon, that is the signal that the answer
is a brand waiver conversation, not a CSV lookup.

## Contrast discipline when adopting a row

Upstream's on-colours were checked against their own primary, which is the common case. Before
shipping a palette:

1. Verify the pairs you actually use in a real render, not in the spreadsheet. Contrast ratios depend
   on the final background, which is often a gradient or an image.
2. Check the muted and border colours against the card surface at the size they will be used.
3. Confirm focus rings are visible against both the surface and the primary.
4. Run `npm run conformance --prefix packages/gv-design-system` if the change touches the system.

The stack's own rule applies: a value that has only been verified in a spreadsheet has not been
verified. See `skills/honest-numbers/references/honest-numbers.md`.

## Provenance

| Field | Value |
|---|---|
| Repo | <https://github.com/nextlevelbuilder/ui-ux-pro-max-skill> |
| License | MIT |
| Stars at absorption | 132,547 (2026-10-02) |
| Upstream paths | `.claude/skills/ui-ux-pro-max/data/colors.csv`, `.../typography.csv` |
| Retrieved | 2026-10-02, via GitHub API, unmodified |

Byte-for-byte copies, so a future diff against upstream is meaningful.
