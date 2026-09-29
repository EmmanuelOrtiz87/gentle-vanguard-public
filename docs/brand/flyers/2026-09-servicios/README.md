# GentleVanguard — Flyers por Servicio (2026-09)

Serie de 6 flyers, uno por servicio, derivados del flyer general de marca
(modelo: imagen ChatGPT 2026-09-28). Formato **1080×1350 px (4:5)** — post de
Instagram/feed y WhatsApp. Identidad: **v2.0 APPLICATION FINAL** (ver
`docs/brand/BRAND-KIT.md`): monograma GV con gradiente `#6E4DEB→#7B63E8→#06B6D4`,
fondo `#0B1020`, acentos cyan `#06B6D4` / violeta `#8B5CF6`, tipografía Poppins.

## Archivos

| Servicio            | PNG listo para publicar                     | Fuente editable                                  |
| ------------------- | ------------------------------------------- | ------------------------------------------------ |
| 01 Software empresarial   | `png/gentlevanguard-flyer-01-software-empresarial.png` | `flyer-01-software-empresarial.html` |
| 02 Automatización de procesos | `png/gentlevanguard-flyer-02-automatizacion-procesos.png` | `flyer-02-automatizacion-procesos.html` |
| 03 IA aplicada            | `png/gentlevanguard-flyer-03-ia-aplicada.png` | `flyer-03-ia-aplicada.html`                     |
| 04 Arquitectura & Consultoría | `png/gentlevanguard-flyer-04-arquitectura-consultoria.png` | `flyer-04-arquitectura-consultoria.html` |
| 05 Academia de Conocimiento | `png/gentlevanguard-flyer-05-academia-conocimiento.png` | `flyer-05-academia-conocimiento.html` |
| 06 Soporte a sistemas     | `png/gentlevanguard-flyer-06-soporte-sistemas.png` | `flyer-06-soporte-sistemas.html`        |

Elementos preservados del flyer original en TODOS: logo + wordmark
"Gentle**Vanguard**", tagline "ARQUITECTURA DIGITAL · IA · AUTOMATIZACIÓN",
motto "IDEAS SISTEMAS OPERACIONES RESULTADOS", contactos
(+54 9 264 5452221 · @gentlevanguard.sj · gentlevanguard@gmail.com) y CTA
"Coordinar reunión". Lo que cambia por flyer: escena vectorial, headline,
subtítulo (copy del owner), frase motivadora, 3 valores y QR.

## QR de WhatsApp (captura de leads)

Cada flyer lleva un QR que abre `wa.me/5492645452221` con mensaje pre-cargado
según el servicio (ver `assets/qr/qr-urls.txt`). Generados con `qrcode` CLI
(ECC M, margen 2), módulos `#0B1020` sobre tarjeta blanca.

## Re-render (Chrome headless)

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" \
  --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=1 --window-size=1080,1350 \
  --virtual-time-budget=8000 \
  --screenshot="C:/Workspace_local/gentle-vanguard/docs/brand/flyers/2026-09-servicios/png/<salida>.png" \
  "file:///C:/Workspace_local/gentle-vanguard/docs/brand/flyers/2026-09-servicios/<fuente>.html"
```

## Sistema de layout (flyer.css)

- Canvas fijo 1080×1350; header (y≈48-132) → texto (y≈214-570) → **banda hero de
  escena (y≈570-850)** → cards de valores (y≈856) → banda CTA con QR (footer).
- Las escenas son SVG inline con skyline + glows + grid compartidos; el motivo
  focal vive SIEMPRE en la banda hero (y 570-850) para no colisionar con texto.
- Fuentes: `assets/fonts/Poppins-*.ttf` (OFL, Google Fonts) vía `@font-face`
  local — no depende de red al renderizar. Mono: Cascadia Mono (sistema).
- Edición de copy: cada HTML es self-contained; cambiar eyebrow/headline/sub/
  quote/cards y el QR `src`. Re-renderizar después.
