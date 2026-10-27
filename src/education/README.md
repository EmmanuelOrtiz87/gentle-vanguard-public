# Servicio interno de producción educativa

El servicio produce recursos por encargo con las capacidades del stack y del cliente de IA. No importa productos de Academy ni exige que el docente compre una capacitación. El modelo ayuda a redactar y revisar; la producción se completa con fuentes, herramientas documentales y revisión del docente responsable.

Se trabaja privadamente para contactos del responsable. No forma parte de la oferta oficial de Gentle Vanguard ni se anuncia en Academy o su landing. Alcance y costo variable se definen al recibir cada pedido; no hay tarifa pública ni presupuesto predefinido.

Entrada operativa para Codex, OpenCode, MiniMax Code y Copilot: `skills/education-service/SKILL.md`. Su referencia de alcance distingue inicial, primaria, secundaria, educación superior, posgrado, adultos y equipos institucionales. La selección de modelos está documentada en `skills/education-service/referencias/modelos.md`; requiere comprobar disponibilidad en cada cuenta.

## Comandos

Desde la raíz del workspace:

```text
npm run educacion:validar -- skills/education-service/examples/paquete-primaria.json --draft
npm run educacion:validar -- ruta/paquete.json
npm run educacion:cotizar -- ruta/costos.json
npm run educacion:paquete:pdf -- ruta/paquete.json carpeta-nueva
npm run educacion:paquete:word -- ruta/paquete.json otra-carpeta-nueva
```

Los exportadores requieren `GV_DOCUMENT_PACKAGES` con el directorio retornado por el cargador de dependencias documentales y el Node de ese runtime. Ejecutar el marcador de operación documental/PDF correspondiente antes de generar archivos. El PDF usa Playwright del runtime y Edge headless en Windows; en otros sistemas necesita Chromium disponible para ese runtime. Las carpetas de salida deben ser nuevas para preservar versiones anteriores.

`--draft` comprueba estructura, referencias entre fuentes, objetivos, recursos y evaluaciones, y tiempos. La validación de entrega exige revisión registrada con responsable, fecha y evidencia. No comprueba automáticamente la exactitud disciplinar, la calidad de una fuente ni la autenticidad de una revisión. Nunca inventar datos de aprobación para pasar el control.

## Costos

`CostEstimate` en service.ts contiene horas de investigación, escritura, revisión humana, maquetación y cambios; costo horario; costos externos; gastos; contingencia; comisiones/impuestos proporcionales sobre venta; y margen objetivo. Todos los importes deben usar la misma moneda y corresponder al encargo real.

Piso estimado = costo total con contingencia / (1 − comisiones e impuestos sobre venta − margen objetivo). Se redondea hacia arriba a centavos. Descuentos o ayudas deben financiarse explícitamente; la calculadora no garantiza rentabilidad si faltan costos. No emitir una tarifa fija de documento sin los datos del encargo.

## Qué se verificó y qué queda por encargo

El ejemplo sintético de tres clases verifica generación de guía docente y material del alumno, con soluciones separadas, estructura y salida PDF inspeccionada. Se mantiene como borrador porque no tiene currículo oficial ni revisión pedagógica humana. No acredita todavía una secuencia de quince clases y cinco áreas ni resultados validados para todos los niveles.

El exportador básico produce texto; una lámina, diagrama, audio, presentación o ficha visual requiere el flujo especializado disponible en el cliente y su propia revisión. No sustituir un recurso necesario por una instrucción de crearlo después.

La salida Word se genera, pero su revisión visual no se completó en la verificación del 17/10/2026: el runtime permitido no proporciona LibreOffice. Los PDF se producen directamente desde HTML, no desde el Word; verificar un PDF no certifica la paginación del DOCX. Antes de entregar un Word final hay que completar el renderizado admitido por la skill de documentos.

El primer encargo real debe aportar jurisdicción, nivel, contenidos, cantidad y duración de módulos, recursos y formato institucional. La aceptación final corresponde al docente o institución; una segunda pasada de IA no se presenta como revisión humana.
