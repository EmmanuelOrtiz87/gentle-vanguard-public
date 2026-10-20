# GentleVanguard · Campaña visual v2

Estado: propuesta para revisión del owner; no publicada, programada ni contratada. El concepto extiende la web corporativa con activos propios y el canon actual. No reemplaza la primera tanda de `apps/corporate-web/public/social/`.

Integración local completada el 2026-10-18: las cinco piezas y sus diez imágenes/variantes ya están en Content OS y ambos manifiestos, conservando estados de revisión. Comando: `npm run content:campaign-import -- --bundle <preview>` (dry-run), agregar `--apply` para importar con backup e idempotencia. Repetir conserva ediciones; una modificación del lote requiere identificador de revisión nuevo. Esto no aprueba ni programa la campaña. Evidencia en `apps/content-cms/docs/INTEGRATION-STATUS-2026-10-18.md`.

## Objetivo y decisiones

Cinco piezas independientes: presentación de empresa/web, software a medida, automatización, IA aplicada y Academy. Una situación o propuesta por pieza, un texto de apoyo breve y una acción. Los servicios se dirigen a responsables de negocio/operaciones; Academy tiene su propio mensaje y destino. No reunir cursos, servicios y catálogo en una sola imagen.

Poppins 700 para titulares/wordmark, Inter para lectura, tokens canónicos copiados del paquete y logo transparente oficial verificado por hash. Arte 3D reutilizado de la web. La gráfica de Academy representa categorías de recursos, no portadas ni capturas de productos. Sin clientes, resultados, descuentos, testimonios, equipos ni oficinas inventados. Los PNG son piezas estáticas; no se presentan como anuncios animados.

## Producir y revisar

Editar `campaign.json`: titular en hasta tres líneas, texto breve, CTA, destino real, caption, alt y sticker. `npm run content:campaign-preview` crea una carpeta nueva `preview-<timestamp>` y un ZIP; no sobrescribe lotes anteriores. Usa Chromium/Playwright ya nativo, carga fuentes e imágenes locales y comprueba dimensiones, texto contenido, fuentes, logo y safe zone de trabajo. No requiere un servicio de diseño ni suscripción para regenerar las piezas.

- Feed: PNG 1080×1350, 4:5. Revisar el recorte real al cargarlo en cada red.
- Historias/estados: PNG 1080×1920, 9:16. Texto crítico entre y=200 y y=1650 como margen conservador; controles/stickers varían según plataforma y deben revisarse en su compositor.
- `propuestas.png`: tablero comparativo; no es el archivo a publicar como flyer.
- `index.html`: galería local con descargas de cada PNG.
- `textos-y-enlaces.md`: caption, UTM, sticker y alt por pieza.
- `jobs-review.json`: trabajos DRAFT compatibles con el validador de Content Operations. La fecha es de preparación; no agenda publicaciones ni se fusiona automáticamente con el manifest operativo.
- `inventory.json`: dimensiones y SHA-256 de los diez PNG. Exportación ZIP mediante el helper nativo `exportKit`.

Una imagen PNG no ofrece un botón ni un enlace clicable. Para Instagram: configurar destino real en el perfil y usar sticker de enlace en historias. “Web/catálogo en el perfil” sólo corresponde si ese destino está efectivamente disponible allí; los dos destinos pueden convivir en un selector de enlaces existente o alternarse según la publicación. No se configuró uno nuevo. En LinkedIn/Facebook, acompañar el post con el enlace adecuado; si se adapta la pieza a esos canales, cambiar la indicación “en el perfil” por una referencia al enlace del post y revisar el compositor.

## Secuencia sugerida, sin fechas impuestas

Comenzar por presentación, luego software y automatización; alternar con una publicación educativa sobre un problema concreto. IA y Academy van en publicaciones separadas para no confundir contratación de un servicio con compra de un recurso. Como experimento inicial, dos publicaciones por semana más historias de apoyo es una cadencia razonable si podemos responder consultas. No es una promesa de alcance ni una “mejor hora” universal.

Medir durante el primer ciclo: pieza/canal, consultas recibidas, conversaciones útiles, reuniones y propuestas. No inferir ventas a partir de vistas ni considerar un clic en WhatsApp como mensaje recibido. La web corporativa incorpora UTM permitidos al mensaje revisable del formulario; el enlace directo a WhatsApp no lo hace. Academy tiene su propio flujo: añadir UTM no acredita instrumentación de seguimiento allí. Preguntar el origen de la consulta cuando no conste.

Antes de campañas pagas: aprobar contenido, validar destino y recepción desde un teléfono real, definir audiencia, objetivo, presupuesto máximo y atención de consultas. No se gastó ni configuró publicidad.

## Cómo pedir la próxima pieza

“Creá una pieza GV sobre [un servicio/producto real], dirigida a [audiencia], con el problema [situación concreta], objetivo [visita/consulta/catálogo], CTA [una acción], destino [URL/WhatsApp] y formato [feed/historia/carrusel/video]. Usá el canon y arte propio. No incluyas precios ni resultados sin una fuente confirmada.”

Pendientes paralelos del lanzamiento: dominio/correo propios evaluados pero no contratados; comprobación física y recepción de consultas; adopción visual por app según su evidencia; primer caso propio documentado con capturas reales y resultados medidos antes de usarlo como prueba comercial.
