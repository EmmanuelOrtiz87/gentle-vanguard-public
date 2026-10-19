# Academy · catálogo público

Superficie: https://gentlevanguard.github.io/academy/. Modo: Persuade; la tarea principal es explorar materiales, comprender alcance/precio y consultar o comprar. Refinamiento del canon GV existente, aprobado por el propietario el 2026-10-18; conserva el waiver de composición comercial en español.

## Lectura y composición

Catálogo hasta 1600 px con márgenes fluidos. Cuatro columnas desde 1200 px, tres desde 900 px, dos desde 600 px y una en teléfono. Portada íntegra en soporte dimensional, tipo de material, título, resumen breve normalizado, metadatos, detalle y pie comercial alineado. El precio se muestra explícitamente junto a la compra; acompañamiento mantiene su presupuesto previo.

Las descripciones completas no gobiernan la altura de la grilla. Permanecen en el HTML dentro de un `details` nativo; JavaScript convierte su apertura en un diálogo de lectura, con Escape, cierre explícito, fondo y foco restaurado. El CTA del diálogo delega en el checkout existente; no hay un segundo checkout. Sin soporte de dialog, continúa el detalle nativo.

El catálogo se recorre por páginas: dos filas por página (tres tarjetas en teléfono), controles Anterior/Siguiente y páginas numeradas con estado actual. Cada página reemplaza la anterior; no acumula tarjetas. La vista inicial reúne los 86 materiales; `sec-destacados` conserva su slug por compatibilidad pero representa “Todo el material”. Búsqueda y tema se aplican a la vista seleccionada, cuya etiqueta y cantidad aparecen explícitamente en `catalog-state`. “Ver todo el material” permanece visible y restablece tipo, texto, tema y página con un clic. Hay una sola vista activa, incluso sin resultados. En móvil la barra de tipos desplaza horizontalmente bajo la cabecera; búsqueda y estado permanecen en el flujo.

## Identidad y movimiento

Poppins 700 e Inter self-hosted; tokens `gv-tokens.css`, sin redefinir `--gv-*`. Superficies y texto semánticos; cyan para la acción comercial con texto oscuro legible, violeta para profundidad y énfasis secundario. Portadas con perspectiva al hover y transición breve; diálogo con entrada sutil. Bajo `prefers-reduced-motion` se desactivan transformaciones, transiciones y entrada. El contenido permanece visible sin animación.

`catalog.css` y `catalog.js` son composición de esta superficie; no son un nuevo canon para todas las apps.

Se retira el comparador de cinco precios que duplicaba la navegación por tipo. Los importes permanecen en cada ficha, y el pack conserva su precio derivado del store en una propuesta propia que prepara una consulta, sin filtrar el catálogo. `offers.css` y `landing-sections.mjs` componen acompañamiento y alcance; se preservan condiciones y detalle docente.

## Continuidad con la web corporativa · 19-10-2026

Cabecera con icono transparente oficial, wordmark unido, contexto Academy, navegación y botón para volver a la empresa. Tema claro/oscuro con `gv-cc-theme`, menú móvil con Escape y retorno al inicio inferior derecho. `academy.css/js` y `academy-page.mjs` mantienen la composición. El contenido sigue en español según su waiver: no se presenta un selector que simule traducir los materiales.

Arte conceptual propio de aprendizaje: `media/academy-learning-v1.webp`, 84.512 bytes, optimizado desde la generación ImageGen guardada en `C:/Users/emman/.codex/generated_images/01a14bdc-eaa5-7c72-853b-424aa9b84d05/exec-bc50f11f-f220-4963-b552-2e154b37c85b.png`. No es un logo ni una fotografía de un equipo o instalación real. Dos recorridos SVG de conocimiento acompañan el libro como foco cinematográfico: control visible de pausa, suspensión fuera de pantalla o al ocultar la pestaña y alternativa estática bajo reduced-motion. El contenido no depende de la animación.

Snapshots de shell, fuentes y tokens sincronizados byte a byte con el paquete y añadidos al gate reproducible de superficies (10 consumidores activos). La QA comprueba cinco anchos, restauración del catálogo, menú, temas, contraste automatizado oscuro/claro con la selección de interés visible, lectura sin JS y checkout sin pagos. No equivale a certificación completa de accesibilidad, compra real o traducción de los 86 materiales.

## Fuentes y mantenimiento

### Cabecera y footer compartidos · 19-10-2026

`src/web-presence/public-chrome.css` es la única composición de cabecera, marca, controles, cierre y footer para la web corporativa y Academy. El builder la exporta una sola vez y ambas rutas la cargan después de sus estilos locales. Mismo ancho/alto de cabecera, logo transparente de 32px, wordmark unido visible en móvil, espaciado, superficie glass, tipografía de cierre y primera fila de footer. El icono de tema representa la acción siguiente con los mismos trazos que corporate-web. Academy conserva su navegación local, retorno a la empresa y condiciones comerciales en una segunda fila; el idioma sigue según waiver. No se agrega un selector de traducción parcial.

Gate reproducible `npm run web:chrome:verify`: compara valores renderizados de ambas rutas en 320/390/768/1440 px, claro y oscuro; snapshots en `.runtime/qa-public-chrome/`. Los tokens del paquete no cambian. La prueba verifica igualdad de propiedades seleccionadas, no identidad de contenido ni certificación completa de accesibilidad.

### Ritmo editorial y movimiento · 19-10-2026

Se amplía la continuidad corporativa por pedido del owner: portada con iluminación ambiental, catálogo sobre superficie profunda, recurso gratuito sobre matiz violeta, acompañamiento editorial, alcance con atmósfera de aprendizaje y contacto con luz cyan. Separadores de acento, espacio entre capítulos y cierre tipográfico “Aprender. Aplicar. Seguir creciendo.” distinguen las secciones sin crear nuevas acciones o modificar productos/precios.

Topbar responde al scroll con fondo translúcido, indicador de sección y navegación por teclado. Footer usa los mismos tokens, identidad y contactos oficiales; su composición sigue siendo comercial y en español. El retorno al inicio restaura foco en la marca. Spotlight delegado en tarjetas para puntero fino, feedback de botones y transición de una página completa del catálogo comunican foco/cambio de estado sin coreografiar cada ficha ni ocultar lectura. Entrada focal de 560ms; cambio de catálogo 280ms; recorridos CSS sin bucle JS ni dependencias nuevas. Pausa explícita controla los recorridos y nuevas entradas; reduced-motion elimina todo desplazamiento/animación. No se impone esta composición cinematográfica a apps operativas.

- Generador: `apps/academy-web/scripts/build-landing.mjs`.
- Render de tarjetas: `apps/academy-web/scripts/catalog-card.mjs`; normaliza espacios/saltos de línea, escapa HTML y conserva la descripción completa.
- Artefacto único: `src/web-presence/build.ts`, raíz corporativa + `/academy/`.
- Regresión: `npm run web:catalog:verify` (app local arrancada), `npm run web:check` y `npm run web:verify`.
- QA: `.runtime/qa-academy-catalog/report.json`, cinco anchos 390/768/1024/1440/1920, navegación, filtros, precio, foco y checkout sin envío de pago. No sustituye compra real ni prueba física de dispositivos.

Se comprobó que los 86 productos y sus términos/precios coinciden con el catálogo previo a este refinamiento. No se añadieron testimonios, resultados comerciales ni popularidad inferida.

## Revalidación · 2026-10-19

La versión pública `9e3931c677c5ba0bab72d031172c5edb8dcca74f` pasó nuevamente las pruebas en 390, 768, 1024, 1440 y 1920 px: filas completas, carga progresiva, detalle y restauración de foco, precio, filtros y apertura/cancelación del checkout, sin enviar pagos. Doce tests unitarios/de controlador pasaron. Se inició desde la única entrada **Web GentleVanguard** de Command Center y ambas rutas locales (`/` y `/academy/`) respondieron HTTP 200 en el mismo puerto 4188. Evidencia actualizada en `.runtime/qa-academy-catalog/report.json` y capturas contiguas; no equivale a una compra real ni a pruebas físicas de dispositivos.
