# Academy: precios y presentación pública

Fecha: 2026-10-19. Se mejora la presentación; no se modifican tarifas ni condiciones de venta.

## Por qué aparecían tres ofertas con presupuesto

La historia de `apps/academy-web/data/store/pricing.json` conserva curso con cinco sesiones a USD 100, mentoría de una hora a USD 20 y programa personalizado a USD 250. La revisión del 17-10 retiró estos importes de la venta fija por falta de validación de costo, preparación, duración y alcance. La condición vigente está en ese store (`salesMode: quote`, `price: null`) y en [la revisión comercial](../research/2026-10-17-academy-transparencia-servicio-educativo.md).

El precio histórico no equivale a una tarifa vigente. Restaurarlo requiere acordar las prestaciones y validar costos; no corresponde cambiar sólo la cifra del HTML ni reutilizar importes del catálogo corporativo por hora para otro servicio.

## Presentación vigente

- Microebook: USD 20.
- Manual premium: USD 40.
- Curso de autoestudio: USD 50.
- Toolkit: USD 80.
- Pack Agencia Creativa: USD 320, con el alcance aprobado en el store.

Estos importes se generan desde el store, no desde valores duplicados en el template. En el refinamiento posterior del 19-10 se retiró el comparador de cinco alternativas porque duplicaba la navegación y aplicaba filtros confusos. Los precios se muestran en cada ficha y el pack conserva su consulta independiente. Acompañamiento, mentoría y programas se reúnen en una sola propuesta: objetivo, sesiones/preparación y presupuesto acordado antes de contratar. Se evita repetir tres tarjetas con la misma leyenda sin presentar servicios humanos como gratuitos o incluidos en el material.

El bloque de alcance conserva requisitos, exclusiones, compras previas y condiciones del material docente. Su composición usa fuentes/tokens oficiales y arte existente de la web, sin añadir oficinas, equipos o casos ficticios.

## Verificación

Los 86 productos, precios y políticas se compararon contra el catálogo público anterior: sin diferencias, excluida la fecha de generación. El catálogo ahora navega con páginas numeradas, Anterior/Siguiente y filtrado paginado. Se probaron 390/768/1024/1440/1920 px, precio visible, detalle/Escape/foco, links de planes, selector de acompañamiento y apertura/cancelación del checkout. No se realizó ningún pago.

Generador: `apps/academy-web/scripts/build-landing.mjs` y `landing-sections.mjs`. Composición: `apps/academy-landing/catalog.js` y `offers.css`. Regresión: `npm run web:catalog:verify` y `npm run web:check`. Evidencia: `.runtime/qa-academy-catalog/`.
