# 🎨 Gentle-Vanguard Image Studio

> **Generador de Imágenes 100% Nativo** - Alternativa local a herramientas cloud como Google
> Nano-Banana, DALL-E, Midjourney, etc.

---

## 🚀 ¿Qué es?

Image Studio es un generador de imágenes completamente nativo que funciona **offline**, sin APIs de
terceros, sin costos, sin registro y sin enviar datos a servidores externos.

### ✅ Ventajas vs Cloud

| Característica   | Cloud (DALL-E, etc.)            | Image Studio               |
| ---------------- | ------------------------------- | -------------------------- |
| **Costo**        | $$$ por imagen                  | $ Gratuito ilimitado       |
| **Privacidad**   | ⚠️ Datos en servidores externos | 🔒 100% local              |
| **Offline**      | ❌ Requiere internet            | ✅ Funciona sin conexión   |
| **Latencia**     | ⏳ 5-30 segundos                | ⚡ Instantáneo             |
| **Control**      | ⚠️ Parámetros limitados         | 🔧 Totalmente configurable |
| **Dependencias** | ⚠️ APIs, créditos, rate limits  | ✅ Ninguna                 |

---

## 🎯 Características

### Algoritmos de Generación

1. **🏙️ Futuristic Grid** - Líneas de perspectiva con glow y grid cyberpunk
2. **✨ Partículas** - Elementos orgánicos flotantes con conexiones
3. **🌊 Ondas Abstractas** - Patrones de ondas con gradientes
4. **🕸️ Network Graph** - Nodos y conexiones tipo visualización técnica
5. **📐 Geométrico** - Formas geométricas abstractas
6. **🎨 Gradiente + Ruido** - Fondos suaves con textura

### Estilos Predefinidos

- **Neo Cyberpunk** - Cian, púrpura, neón
- **Minimal Clean** - Blanco, gris, profesional
- **Gradient Flow** - Degradados suaves
- **Dark Tech** - Oscuro, técnico
- **Geometric** - Formas matemáticas
- **Organic** - Naturaleza, partículas

### Paletas de Color

- 🌈 **Neón** - Cian (#22d3ee) / Púrpura (#a78bfa) / Rosa (#f472b6)
- 🌅 **Sunset** - Naranja / Rosa / Magenta
- 🌲 **Forest** - Verde / Azul / Púrpura
- ⬜ **Monocromo** - Escala de grises
- 🎨 **Personalizada** - Configurable

---

## 📏 Tamaños Soportados

| Plataforma          | Dimensiones     | Uso                 |
| ------------------- | --------------- | ------------------- |
| **LinkedIn**        | 1200×627        | Posts y artículos   |
| **Twitter/X**       | 1600×900        | Tweets y headers    |
| **Instagram**       | 1080×1080       | Feed posts          |
| **Instagram Story** | 1080×1920       | Stories             |
| **YouTube**         | 1920×1080       | Thumbnails, banners |
| **Personalizado**   | Hasta 4096×4096 | Cualquier tamaño    |

---

## 🎮 Cómo Usar

### Método 1: Desde el Asistente IA

```
1. Ve a "Asistente IA" en el CMS
2. Escribe: "Generar imagen de banner futurista"
3. El asistente abrirá Image Studio automáticamente
4. La imagen se generará con las dimensiones adecuadas
```

### Método 2: Desde el Botón "Image Studio"

```
1. Ve a "Imágenes" en el CMS
2. Click en "Abrir Image Studio"
3. Escribe tu prompt en la caja de texto
4. Selecciona plantilla y ajusta parámetros
5. Click "Generar Imagen"
```

### Método 3: Directo

```
Abrir archivo: docs/presentations/image-studio.html
```

---

## 💡 Prompts Efectivos

### Estructura Recomendada

```
[Estilo] + [Elementos] + [Propósito]
```

### Ejemplos

```
✓ "Banner futurista con neón cian y grid de perspectiva"
✓ "Thumbnail minimalista para tutorial Python"
✓ "Fondo orgánico con partículas flotantes verdes"
✓ "Ondas abstractas degradado cian a púrpura"
✓ "Diagrama de red con nodos brillantes tipo tech"
✓ "Geometric shapes neon glow dark background"
```

### Palabras Clave por Generador

| Para...            | Usar...                                                  |
| ------------------ | -------------------------------------------------------- |
| **Grid Futurista** | "futuristic", "tech", "cyberpunk", "grid", "perspective" |
| **Partículas**     | "particles", "organic", "floating", "dots", "natural"    |
| **Ondas**          | "waves", "abstract", "gradient", "flow", "curves"        |
| **Network**        | "network", "nodes", "connections", "graph", "diagram"    |
| **Geométrico**     | "geometric", "shapes", "circles", "squares", "math"      |

---

## 🎛️ Controles

### Intensidad de Efectos (0-100%)

- **0-30%**: Efectos sutiles
- **30-60%**: Balance recomendado
- **60-100%**: Efectos dramáticos

### Complejidad (1-10)

- **1-3**: Simple, pocos elementos
- **4-6**: Balance
- **7-10**: Muy detallado, denso

---

## 💾 Exportar Imágenes

### Formatos Soportados

| Formato  | Características               | Mejor Para... |
| -------- | ----------------------------- | ------------- |
| **PNG**  | Sin pérdida, transparencia    | Logos, íconos |
| **JPG**  | Comprimido, menor tamaño      | Fotos, fondos |
| **WebP** | Moderno, mejor calidad/tamaño | Web, apps     |

### Nomenclatura

```
gentle-vanguard-gen-YYYY-MM-DD-HH-MM-SS.png
```

---

## 🔧 Tips Avanzados

### 1. Combina Prompts

```
Prompt 1: "Banner futurista con grid"
Prompt 2: "Añade partículas orgánicas"
→ Combina ambos efectos
```

### 2. Usa Historial

- El sistema guarda automáticamente las últimas 20 versiones
- Usa Deshacer/Rehacer para experimentar

### 3. Ajusta Nivel por Plataforma

```
LinkedIn: Complejidad 5-6 (legible)
Twitter: Complejidad 6-7 (vistoso)
Instagram: Complejidad 7-8 ( llamativo)
```

---

## 🛠️ Arquitectura Técnica

```
Image Studio
├── Canvas API (renderizado 2D)
├── Algoritmos Procedurales
│   ├── Perlin noise (pseudo)
│   ├── Voronoi diagrams (simplificado)
│   ├── Trigonométricas (ondas)
│   └── Random distribution (partículas)
├── Sistema de Capas
│   ├── Fondo (gradients)
│   ├── Patrón (shapes)
│   ├── Efectos (blooms, vignette)
│   └── Texto (opcional)
└── Export Engine
    ├── PNG/JPG/WebP
    └── Data URLs
```

**Sin WebGL**: Todo funciona con Canvas 2D API para máxima compatibilidad (99%+ navegadores).

---

## 🔄 Comparación con Alternativas

| Tool                 | Precio    | Calidad    | Control    | Offline | Latencia |
| -------------------- | --------- | ---------- | ---------- | ------- | -------- |
| **Image Studio**     | Gratis    | ⭐⭐⭐⭐   | ⭐⭐⭐⭐⭐ | ✅      | <1s      |
| **DALL-E 3**         | $0.04/img | ⭐⭐⭐⭐⭐ | ⭐⭐       | ❌      | 5-10s    |
| **Midjourney**       | $10/mes   | ⭐⭐⭐⭐⭐ | ⭐⭐⭐     | ❌      | 30s+     |
| **Stable Diffusion** | Gratis*   | ⭐⭐⭐⭐   | ⭐⭐⭐⭐⭐ | ✅**    | 2-5s     |

\* Requiere GPU potente ** Requiere instalación local compleja

---

## ❓ FAQ

### ¿Es realmente 100% offline?

**Sí.** Todo el procesamiento ocurre en tu navegador. No se envían datos a ningún servidor.

### ¿Funciona en todos los navegadores?

Funciona en Chrome, Firefox, Safari, Edge. Requiere Canvas 2D API (soportado desde 2012).

### ¿Puedo generar fotografías realistas?

No - está diseñado para gráficos abstractos, patterns y visuales técnicos. No es un generador
fotorealista.

### ¿El texto que escribo aparece en la imagen?

Solo si el prompt es corto (< 50 caracteres). Para texto específico, edita después en un editor.

### ¿Cuántas imágenes puedo generar?

Ilimitadas - está limitado solo por tu navegador y tu paciencia.

### ¿Qué tan grandes pueden ser las imágenes?

Hasta 4096×4096 píxeles. Más grande = más lento = más memoria RAM.

---

## 🎁 Casos de Uso

### ✅ Ideal Para:

- Headers de blog/documentación
- Thumbnails de YouTube
- Posts de LinkedIn/Twitter
- Fondos de presentaciones
- Banners de landing pages
- Diagramas técnicos simples
- Patterns para UI/UX
- Placeholders de diseño

### ❌ No Es Adecuado Para:

- Fotografías realistas
- Caras detalladas
- Arte conceptual complejo
- Textos largos en imagen
- Ilustraciones narrativas

---

## 📊 Roadmap

### v1.0 ✅ (Actual)

- 6 algoritmos base
- Export PNG/JPG/WebP
- 6 templates
- Historial (20 items)

### v1.1 (Próximo)

- Batch processing
- Presets personalizados
- Animación simple (GIF)
- WebGL opcional (mejor rendimiento)

### v1.2 (Futuro)

- Integración con modelos locales (ONNX)
- Semantic search de templates
- Plugin system para algoritmos
- Collaborative canvas

---

## 📝 Créditos

**Gentle-Vanguard Stack**

- 294 archivos TypeScript
- 21 agentes especializados
- 100% Open Source

**Sin dependencias externas**

- Solo HTML5 Canvas API
- CSS3 para UI
- Vanilla JavaScript

---

## 🏠 Abrir Image Studio

```
📁 docs/presentations/image-studio.html

- Doble click para abrir
- O usar: npx serve . y abrir http://localhost:3000/docs/presentations/image-studio.html
```

---

**¿Preguntas? Escribe en el Asistente IA del CMS:** `Ayuda con Image Studio`
