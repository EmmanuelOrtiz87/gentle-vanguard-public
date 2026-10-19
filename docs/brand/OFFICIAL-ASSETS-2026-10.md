# GentleVanguard — activos oficiales verificados

Fecha de verificación: 2026-10-14

## Fuente oficial

Los archivos recibidos como `Nombre - oficial.png` e `Icono - Logo oficial.png` coinciden
exactamente con los PNG oficiales ya versionados en:

- `assets/brand/gentle-vanguard/v2/raster/official/gv-wordmark-official.png`
- `assets/brand/gentle-vanguard/v2/raster/official/gv-icon-official.png`

La comparación fue realizada por SHA-256, dimensiones y formato:

| Activo | Dimensiones | SHA-256 |
|---|---:|---|
| Wordmark | 1672 x 941 PNG | `a1b98d7ca1daa024fd5dbacfcd0c4955087d7657589b56390fd8734ee9379e58` |
| Icono | 1254 x 1254 PNG | `a2b3e41b4dd1385309cd0dd64b0ca37a19409236717358072eba9955faad678f` |

Estos PNG son la fuente raster de verdad. No se reemplazan por archivos derivados ni se
redibujan manualmente.

## Variantes disponibles

Las variantes JPEG y WebP se generan desde los PNG oficiales y viven en
`assets/brand/gentle-vanguard/v2/raster/official/derived/`.

| Necesidad | Activo recomendado |
|---|---|
| UI con transparencia y escalado | SVG canónico del brand kit |
| Exportación exacta, documentos y presentaciones | PNG oficial |
| Fotografía, compatibilidad amplia o correo | JPEG derivado |
| Web optimizada | WebP derivado |
| PWA/app icon | PNG cuadrado derivado de 192/512 px |

Los SVG canónicos son `assets/brand/gentle-vanguard/v2/svg/logos/logo-horizontal.svg` y
`assets/brand/gentle-vanguard/v2/svg/icons/gv-transparent.svg`. No se debe convertir un PNG a
SVG mediante trazado automático y llamarlo vector oficial: el vector canónico es el que figura en
el manifest de assets.

## Uso obligatorio en apps nativas

Una app nativa GV debe:

1. cargar `gv-fonts.css` y las fuentes self-hosted del stack;
2. usar tokens de `docs/brand/TOKENS-v2.json` y el gradiente oficial de tres paradas;
3. usar logo/icono canónicos, no texto `GV` dibujado en CSS como sustituto;
4. declarar `manifest.webmanifest` con iconos reales cuando sea PWA;
5. mantener nombre oficial, descripción, tema, idioma y claves compartidas de shell;
6. registrar un waiver explícito si una superficie de cliente necesita identidad distinta.

## Corrección aplicada a GV Knowledge Ops

KOps tenía un gap de homologación: usaba un monograma textual, colores anteriores, no cargaba las
fuentes oficiales y declaraba `icons: []` en el manifest PWA. En la versión 0.5.0 se corrigió:

- logo horizontal SVG oficial en el topbar;
- fuentes Poppins/Inter/JetBrains Mono self-hosted;
- colores `#0B1020`, `#06B6D4`, `#8B5CF6` alineados al canon;
- iconos PNG oficiales de 192 y 512 px en el manifest;
- variantes PNG/JPEG/WebP disponibles dentro del paquete portable;
- cache PWA `gv-knowledge-ops-v13` invalidable sin query en la URL.

## Regla de prevención

NORM-APP-001 debe ejecutarse como gate de creación de toda app bajo `apps/`. Una app no se
considera homologada sólo porque funciona: debe pasar identidad, tokens, fuentes, iconos,
manifest, shell, i18n, tema, accesibilidad y validación visual.
