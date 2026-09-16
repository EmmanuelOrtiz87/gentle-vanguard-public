# Gentle Vanguard — GV App Asset System

## Nueva identidad visual · SVG Master Pack

Este paquete contiene la **versión vectorial SVG** del símbolo `GV` de Gentle Vanguard, trazado a
partir de la nueva identidad visual suministrada.

> **Principio:** SVG es la fuente maestra para interfaces, web, PWA y sistemas que soporten
> vectores. No se incrustan PNG dentro de los SVG.

---

## 1. Identidad

**Marca:** Gentle Vanguard  
**Símbolo:** GV — monograma geométrico integrado  
**Concepto:** tecnología + movimiento + aprendizaje + transformación  
**Estilo:** premium, tecnológico, limpio, humano y contemporáneo.

### Lema de marca

`APRENDER • EXPERIMENTAR • CONSTRUIR • TRANSFORMAR`

### Paleta

| Token           | Hex       | Uso                   |
| --------------- | --------- | --------------------- |
| `gv-midnight`   | `#0B1020` | fondos principales    |
| `gv-blue`       | `#1E40AF` | azul tecnológico      |
| `gv-cyan`       | `#06B6D4` | acentos / acciones    |
| `gv-violet`     | `#8B5CF6` | identidad / acentos   |
| `gv-soft-white` | `#F8FAFC` | fondos claros         |
| `gv-black`      | `#050A14` | versión monocromática |

### Gradiente oficial

`#6E4DEB → #7B63E8 → #06B6D4`

Dirección visual aproximada: diagonal inferior-izquierda → superior-derecha.

---

## 2. Archivos incluidos

- `gv-gradient.svg` — símbolo principal con gradiente.
- `gv-transparent.svg` — master transparente para UI.
- `gv-white.svg` — versión blanca.
- `gv-black.svg` — versión negra.
- `gv-cyan.svg` — versión cyan.
- `gv-violet.svg` — versión violeta.
- `gv-on-midnight.svg` — icono cuadrado para app sobre Midnight Navy.
- `gv-on-light.svg` — icono cuadrado para app sobre Soft White.
- `android-foreground.svg` — foreground para icono adaptativo Android.
- `android-background.svg` — background Android.
- `favicon.svg` — favicon/web.
- `README.md` — esta documentación.

---

## 3. Recomendación de archivo maestro

Para la mayoría de las aplicaciones:

**Usar:** `gv-transparent.svg`

Para el icono principal de una aplicación:

**Usar:** `gv-on-midnight.svg`

La versión con fondo Midnight es preferible cuando el icono necesita funcionar como una pieza
autónoma.

---

## 4. Web

### HTML

```html
<img src="/assets/brand/gv-transparent.svg" alt="Gentle Vanguard" width="40" height="40" />
```

### CSS

```css
:root {
  --gv-midnight: #0b1020;
  --gv-blue: #1e40af;
  --gv-cyan: #06b6d4;
  --gv-violet: #8b5cf6;
  --gv-soft-white: #f8fafc;

  --gv-gradient: linear-gradient(135deg, #6e4deb 0%, #7b63e8 52%, #06b6d4 100%);
}
```

---

## 5. Favicon

Archivo recomendado:

`favicon.svg`

HTML:

```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
```

Si el sistema requiere PNG, exportar el SVG a:

- 16×16
- 32×32
- 48×48
- 180×180
- 192×192
- 512×512

El SVG sigue siendo el master.

---

## 6. PWA / Web App Manifest

Ejemplo:

```json
{
  "name": "Gentle Vanguard",
  "short_name": "Gentle Vanguard",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0B1020",
  "theme_color": "#0B1020",
  "icons": [
    {
      "src": "/assets/brand/gv-on-midnight.svg",
      "sizes": "any",
      "type": "image/svg+xml",
      "purpose": "any maskable"
    }
  ]
}
```

**Nota:** algunos navegadores/instaladores son más estrictos con SVG en manifest. Para máxima
compatibilidad, mantener el SVG como fuente y generar adicionalmente PNG 192×192 y 512×512.

---

## 7. Android

### Opción recomendada

Usar:

- `android-foreground.svg`
- `android-background.svg`

El foreground debe conservar espacio de seguridad alrededor del monograma porque Android puede
aplicar máscaras circulares, squircle u otras formas.

Para Android nativo, el SVG puede importarse como **Vector Drawable** desde Android Studio.

Conceptualmente:

```text
mipmap/
  ic_launcher/
  ic_launcher_round/

drawable/
  gv_foreground.xml
  gv_background.xml
```

El `GV` es el foreground y `#0B1020` el background.

### Regla importante

No pegar el GV al borde del canvas. Mantener aproximadamente 15–20% de área de seguridad.

---

## 8. iOS / iPadOS

SVG funciona como fuente de diseño, pero el catálogo de iconos de Apple normalmente requiere los
tamaños rasterizados correspondientes.

Flujo recomendado:

```text
SVG MASTER
   ↓
exportación automática
   ↓
PNG @1x / @2x / @3x
   ↓
Assets.xcassets
   ↓
AppIcon
```

No modificar manualmente el SVG maestro para cada tamaño.

---

## 9. React / React + Vite

Ejemplo:

```jsx
import gvLogo from './assets/brand/gv-transparent.svg';

export function BrandMark() {
  return <img src={gvLogo} alt="Gentle Vanguard" width={40} height={40} />;
}
```

Si se utiliza SVGR:

```jsx
import { ReactComponent as GV } from './assets/brand/gv-transparent.svg';

export function BrandMark() {
  return <GV aria-label="Gentle Vanguard" />;
}
```

---

## 10. Next.js

```jsx
import Image from 'next/image';
import gvLogo from '@/assets/brand/gv-transparent.svg';

export default function Brand() {
  return <Image src={gvLogo} alt="Gentle Vanguard" width={48} height={48} priority />;
}
```

---

## 11. Electron / escritorio

Utilizar:

`gv-on-midnight.svg`

como icono visual principal de la aplicación.

Para instaladores que exijan ICO/ICNS, generar esos formatos desde el SVG maestro.

---

## 12. Flutter

El SVG puede utilizarse con `flutter_svg`.

```dart
SvgPicture.asset(
  'assets/brand/gv-transparent.svg',
  semanticsLabel: 'Gentle Vanguard',
);
```

En `pubspec.yaml`:

```yaml
flutter:
  assets:
    - assets/brand/gv-transparent.svg
    - assets/brand/gv-on-midnight.svg
```

---

## 13. React Native

Con `react-native-svg`, se recomienda importar el SVG mediante el pipeline SVG configurado por el
proyecto.

Ejemplo conceptual:

```jsx
<GVLogo width={48} height={48} />
```

Para launcher icons, utilizar las herramientas específicas de Android/iOS para generar los tamaños
requeridos a partir del SVG maestro.

---

## 14. Electron / Tauri / escritorio multiplataforma

Fuente recomendada:

```text
gv-on-midnight.svg
```

Exportaciones:

```text
Windows → .ico
macOS   → .icns
Linux   → PNG/desktop icon set
```

El SVG no debe convertirse manualmente en diferentes versiones dibujadas a mano.

---

## 15. Sistema de nombres

Usar:

```text
gv-[variante].svg
```

Ejemplos:

```text
gv-gradient.svg
gv-white.svg
gv-black.svg
gv-cyan.svg
gv-violet.svg
gv-on-midnight.svg
gv-on-light.svg
```

Para plataformas:

```text
android-foreground.svg
android-background.svg
favicon.svg
```

---

## 16. Reglas de uso

### Permitido

- Escalar libremente.
- Cambiar tamaño.
- Utilizar sobre fondos compatibles.
- Mantener el gradiente oficial.
- Utilizar las versiones monocromáticas cuando el contexto lo requiera.
- Aplicar el símbolo como avatar, app icon, favicon o elemento de navegación.

### Evitar

- Estirar horizontalmente.
- Estirar verticalmente.
- Rotar el monograma.
- Cambiar arbitrariamente los colores.
- Añadir sombras pesadas.
- Añadir contornos externos no definidos por la identidad.
- Superponer texto sobre el símbolo.
- Reducir el área de seguridad del icono de aplicación.

---

## 17. Tamaños de referencia

El SVG no tiene una resolución nativa: es escalable.

Referencias:

| Uso                | Tamaño recomendado |
| ------------------ | -----------------: |
| favicon            |           16–48 px |
| navbar             |           32–48 px |
| avatar             |          64–128 px |
| app icon master    |          1024×1024 |
| PWA                |  192×192 / 512×512 |
| Android master     |          1024×1024 |
| iOS master         |          1024×1024 |
| splash / marketing |   cualquier tamaño |

---

## 18. Tokens para el sistema

```json
{
  "brand": {
    "name": "Gentle Vanguard",
    "symbol": "GV",
    "colors": {
      "midnight": "#0B1020",
      "blue": "#1E40AF",
      "cyan": "#06B6D4",
      "violet": "#8B5CF6",
      "softWhite": "#F8FAFC",
      "black": "#050A14"
    },
    "gradient": {
      "type": "linear",
      "angle": 135,
      "stops": ["#6E4DEB", "#7B63E8", "#06B6D4"]
    }
  }
}
```

---

## 19. Estructura recomendada dentro del proyecto

```text
assets/
└── brand/
    ├── svg/
    │   ├── gv-gradient.svg
    │   ├── gv-transparent.svg
    │   ├── gv-white.svg
    │   ├── gv-black.svg
    │   ├── gv-cyan.svg
    │   ├── gv-violet.svg
    │   ├── gv-on-midnight.svg
    │   ├── gv-on-light.svg
    │   ├── android-foreground.svg
    │   ├── android-background.svg
    │   └── favicon.svg
    └── BRAND_SYSTEM.md
```

---

## 20. Regla para futuras aplicaciones

**Nunca dibujar nuevamente el logo para una nueva aplicación.**

El flujo correcto es:

```text
Gentle Vanguard Brand Master
          ↓
      SVG Master
          ↓
   ┌──────┼─────────┐
   ↓      ↓         ↓
 Web    Mobile    Desktop
   ↓      ↓         ↓
 PWA   Android/iOS Electron/Tauri
```

Esto garantiza que todas las aplicaciones de Gentle Vanguard mantengan exactamente la misma
identidad.

---

## 21. Fuente de esta versión

La geometría del símbolo de este paquete fue trazada a partir de la nueva referencia visual
proporcionada en la conversación.

**Importante:** esta versión es un asset vectorial reconstruido desde la referencia visual. Si
posteriormente aparece el archivo vectorial original del diseñador (`.AI`, `.SVG`, `.EPS`,
`.PDF vectorial` o equivalente), ese archivo debe convertirse en el **master definitivo**,
sustituyendo este trazado si existen diferencias geométricas.

---

## 22. Estado

**Brand:** Gentle Vanguard  
**Asset family:** GV New Identity  
**Formato maestro:** SVG  
**Uso:** Web · PWA · Android · iOS · Desktop · Marketing  
**Versión:** NEW
