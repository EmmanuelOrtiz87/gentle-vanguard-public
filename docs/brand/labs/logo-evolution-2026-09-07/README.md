# Logo Evolution 2026-09-07 — "The Vanguard Cut" (v3)

Evolución del monograma GV hacia un sistema de identidad completo, generado con geometría
determinista (sin LLM, sin raster): cada forma deriva de un sistema de construcción verificable.
Referencia de calidad: deck de estudio de identidad (8 paneles individuales 1440×1800, formato
carrusel).

## Concepto

**The Vanguard Cut** — dos gestos, una geometría:

- **El abrazo (G)**: anillo abierto con terminales de corte radial. Lo _gentle_: el sistema que
  sostiene sin encerrar.
- **El avance (V)**: chevrón sólido que rompe el perímetro del anillo en el eje de 45°. La
  _vanguardia_ va primero.

Decisiones de oficio (lo que lo hace parecer diseño humano, no AI-slop):

| Decisión       | Valor                             | Razón                                       |
| -------------- | --------------------------------- | ------------------------------------------- |
| Peso uniforme  | 72u en anillo y chevrón           | coherencia óptica entre curva y recta       |
| Corte radial   | terminales al eje del sistema     | nada decorativo; todo se construye          |
| Sobrepaso      | punta a `RO + w/2`                | la V atraviesa la frontera: la marca avanza |
| Micro-plano    | 10u en la punta                   | _"even the blade is gently finished"_       |
| Aire medido    | auto-tuned ≥ 22u brazo↔terminal   | el generador busca el gap mínimo legible    |
| Gradiente      | solo sobre el chevrón             | la energía vive únicamente donde se avanza  |
| Variante small | gap+8°, peso 84u, sin micro-plano | óptica para ≤32px (favicon, icono)          |

## Archivos

### Assets (out/)

- `mark-gradient.svg` / `mark-mono-light.svg` / `mark-mono-dark.svg` — marca principal
- `mark-small.svg` / `mark-small-gradient.svg` — variante óptica ≤32px
- `mark-construction.svg` — sheet de construcción (grid, círculos, ejes, cotas)
- `anatomy-ring.svg` / `anatomy-chevron.svg` — elementos separados
- `icon-tile.svg` (512) / `icon-tile-64.svg` — icono de app
- `emblem-profile.svg` + `gv-profile-1080.png` — **sello de perfil 1080×1080** (RRSS)
- `lockup-horizontal.svg` — lockup horizontal con wordmark

### Deck de presentación (8 paneles individuales 1440×1800)

`gv-01-hero.png` … `gv-08-applications.png` — La Marca · El Emblema · El Simbolismo · La
Construcción · Los Elementos · El Color · La Tipografía · Aplicaciones.

### Fuente

`fonts/space-grotesk.css` + woff2 locales (font oficial de marca, OFL).

## Regenerar

```bash
node --import tsx docs/brand/labs/logo-evolution-2026-09-07/generate.ts
# screenshots (Chrome headless) — ver comandos en el historial; cada panel-*.html → PNG 1440x1800
```

## Ruta de adopción (pendiente de decisión del propietario)

1. Aprobar dirección v3 (o iterar parámetros en `generate.ts` — todo es determinista).
2. Reemplazar `assets/logo.svg` + variantes mono + `logo-icon.svg` desde `out/`.
3. Redistribuir a las 8 apps (mismo pipeline que v2.1).
4. Actualizar `docs/brand/BRAND-DECISION-2026-09-01.md` con la decisión v3.

El logo oficial vigente sigue siendo **v2.1** hasta que se apruebe este lab.
