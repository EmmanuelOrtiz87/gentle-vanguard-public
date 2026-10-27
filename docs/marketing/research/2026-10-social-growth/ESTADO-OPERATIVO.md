# Estado operativo de redes y contenido

**Verificación: 21/10/2026 · GentleVanguard**

Esta actualización reemplaza el estado técnico inicial del informe. La investigación de referencias se conserva con su fecha y límites; no son métricas de las nuevas campañas.

## Qué quedó operativo

- **Texto:** el CMS usa Gemini `gemini-flash-lite-latest`. La generación real produjo variantes para Instagram y TikTok. Quedan como borradores: la revisión editorial sigue siendo necesaria.
- **Arte local:** Creative Studio devolvió HTTP 201 y persistió una pieza de 1080×1350. Las plantillas ahora incorporan Poppins, Inter y el wordmark oficial. No dependen de cuota generativa.
- **Integración de imágenes:** el CMS admite OpenAI-compatible y Gemini, con selector de modelo visual separado del modelo de texto. Valida los bytes y produce el canvas real solicitado, sin estirar el original. Conserva además el archivo original del proveedor antes de convertirlo; la copia adaptada no sustituye esa fuente.
- **Videos:** dos MP4 de 30 segundos, H.264 + AAC, 1080×1920, con voz de Windows y subtítulos quemados. Usan arte propio y guion definido, sin claves de stock. La inspección visual detectó y corrigió el escalado excesivo de subtítulos de libass.
- **Campañas:** diez contenidos importados al CMS, cinco por frente; veinte variantes de Instagram feed/historia y diez variantes de TikTok en estado generado/borrador. No se aprobaron, programaron ni publicaron remotamente. Repetir la importación produjo cero duplicados.
- **Portabilidad:** Social Studio se incorporó a la lista crítica y se sincronizó a OpenCode, Codex, ZCode, MiniMax, Copilot y Antigravity. La auditoría de interoperabilidad reportó PASS para los seis clientes; eso verifica integración y superficies, no que todos los modelos externos tengan cuota.
- **Zen:** la inferencia API de `glm-5.3-flash` en la cuenta Zen C devolvió HTTP 200 con texto. La prueba con 128 tokens de salida máximos consumió 93 tokens totales, incluyendo razonamiento. No se cambió el modelo global del usuario a uno de pago.
- **Protección de configuración:** las pruebas de settings usan almacenamiento temporal aislado; ya no guardan «template» sobre la configuración real del CMS.

## Límites externos y alternativa disponible

| Dependencia | Resultado real de esta verificación | Cómo operar mientras tanto |
|---|---|---|
| Imágenes Gemini | Catálogo autenticado HTTP 200; inferencia de modelos de imagen probados HTTP 429, RESOURCE_EXHAUSTED. | Composición local con arte propio. Revisar cuota y condiciones del proyecto en Google antes de reintentar; no supone que la clave sea inválida. |
| Imágenes OpenAI | Catálogo autenticado HTTP 200; generación con gpt-image-1-mini HTTP 429. | Plantillas y composición local. Revisar el límite/cuota del proyecto; no se verificó aquí si es saldo o un límite temporal. |
| Big Pickle / GLM Flash free de Zen | HTTP 403, FreeTierError, en esta sesión. | Gemini texto operativo en CMS. Zen GLM Flash de pago respondió, usando el crédito existente; elegirlo conscientemente si se usa. |
| Voz Edge | El adaptador se corrigió para la API real del paquete; la llamada viva respondió HTTP 403. | Voz local de Windows comprobada en los dos MP4. No declarar restablecido Edge por pasar un test con frontera simulada. |
| Stock Pexels/Pixabay | Sin claves configuradas. | Usar frames y grabaciones propias. El pipeline de stock sigue incompleto; la alternativa local ya renderizó videos. |
| Conexión directa Instagram/TikTok | Faltan credenciales OAuth nativas. Buffer autenticado reconoce ambas cuentas. | Preparar material y borradores; Buffer es la conexión existente. No se certificó publicación ni analítica privada mediante una prueba remota. |
| Insights y atribución | Sin exportación privada verificada. | Registros CSV separados por campaña. No fabricar métricas de retención, compradores o retorno. |

Ninguna integración local puede crear cuota, crédito o autorizaciones de un proveedor. Se conservaron conexiones y claves existentes; no se compraron planes, créditos ni anuncios. Los datos de prueba son puntuales y se deben revalidar cuando cambie el acceso.

## Cómo repetir la producción nativa

Desde la raíz del repositorio:

```bash
# Generar prueba visual de una campaña propia; la fecha identifica preparación, no programación.
node --import tsx src/content-operations/campaign-preview.ts --campaign-dir docs/marketing/campaigns/2026-10-social-growth/servicios --date 2026-10-21

# Validar/importar el bundle curado. Omitir --apply para una inspección sin escritura.
node --import tsx src/content-operations/import-campaign.ts --bundle docs/marketing/campaigns/2026-10-social-growth/servicios/bundle --apply

# Generar video local desde guion, subtítulos y frames propios.
node --import tsx apps/content-cms/server/social/studio-cli.ts video --script docs/marketing/research/2026-10-social-growth/VIDEO-SERVICIOS.json
node --import tsx apps/content-cms/server/social/studio-cli.ts video --script docs/marketing/research/2026-10-social-growth/VIDEO-ACADEMY.json

# Verificar las integraciones mantenidas.
node --import tsx src/integrations/tool-interoperability-audit.ts
```

Las campañas originales están en `docs/marketing/campaigns/2026-10-social-growth/{servicios,academy}/`. Los directorios `bundle/` preservan fuentes, inventario, hashes y PNG. Los previews fechados son reproducibles y no se versionan.

## Entregables para revisar

- [Video de servicios](videos/servicios.mp4) y [video de Academy](videos/academy.mp4), con sus SRT.
- `VIDEO-SERVICIOS.json` y `VIDEO-ACADEMY.json`: fuentes editables de narración, captions y frames. Sus tiempos de subtítulo son editoriales y no una alineación palabra por palabra de Whisper.
- Dos carruseles de siete láminas en `carrusel/` y `carrusel-academy/`.
- Diez ideas completas con copy y veinte PNG de feed/historia en los bundles de campaña.
- Calendario de 14 días, prompts, registros de contenido y leads sin datos inventados.

## Validación y próximos pasos

Validación local realizada: 222 tests del CMS, 75 tests de gv-shorts-core, typecheck y build del CMS, comprobación de dimensiones/duración/códecs con FFprobe, inspección visual de artes y video, y auditoría de seis integraciones. El gate obligatorio de push y el cierre de sesión generan evidencia adicional propia.

Los pendientes externos quedan identificados en la tabla. La operación disponible permite continuar preparando contenido con Gemini texto, composición y video local. Antes de una publicación se revisa la pieza concreta, el contacto, el destino y las condiciones de la plataforma; las cuentas no fueron modificadas para publicar automáticamente.
