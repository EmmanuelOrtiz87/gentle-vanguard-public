# Guion — GentleVanguard - Capa de orquestación para la IA de su empresa (ES)

- **Deck:** `gv-enterprise-es`
- **Archivo de contenido:** `content/gv-enterprise.es.js`
- **Audiencia:** Dirección de negocio y dirección de tecnología de una empresa grande (referencia: telecomunicaciones) que quiere llevar la IA a sus equipos de forma gobernada.
- **Duración objetivo:** 18 minutos de exposición + 10 minutos de preguntas.
- **Salida de la sala:** Que la sala entienda el stack como una capa de orquestación —no como un chatbot— con roles, presupuestos, trazabilidad y auditoría; que acepte que la adopción es gradual y reversible; y que el próximo paso sea una sesión de diagnóstico, no un contrato.

> Nota de uso: este guion es una guía de memoria, no un teleprompter. Los tiempos son el presupuesto de ensayo; si sobra tiempo, se profundiza en las preguntas esperadas, no se agregan slides.

---

## Slide 1 — Una capa de orquestación para la IA de su empresa

**Layout:** cover · **Tiempo:** 0:45

**Qué decir:**
> La pregunta que suele llegar a dirección no es "qué modelo usamos", sino "qué pasa cuando la IA toca nuestros datos, nuestros costos y nuestros equipos". GentleVanguard es una capa que pone esa respuesta por delante: los asistentes dejan de ser cuentas sueltas y pasan a ser roles con permisos, presupuesto y trazabilidad. En los próximos minutos no voy a enseñar producto, voy a explicar qué queda resuelto si lo adoptan como plataforma y qué pasa con su operación el día que dejen de mantenerlo.

**Transición:** Antes de hablar del stack conviene decir quién lo construyó y desde qué experiencia.

**Preguntas esperadas:**
- **P:** ¿Es un producto comercial con precio?
  **R:** No hay tarifa oficial publicada. El modelo de trabajo es la plataforma instalada sobre la propia infraestructura del cliente, sobre un repositorio open source; la conversación inicial es un diagnóstico sin costo.
- **P:** ¿Qué diferencia a esto de comprar una herramienta de IA corporativa?
  **R:** Son cosas distintas: la herramienta es el insumo, esta es la capa de gobierno que decide quién la usa, con qué límites y dejando qué registro.
- **P:** ¿Pueden mostrarnos un cliente que ya lo use?
  **R:** El stack no tiene clientes: las aplicaciones que lo operan son desarrollos internos propios, que es justamente lo que se explica en las slides siguientes.

**No decir:**
- No decir "somos la plataforma líder" ni comparar con nombres de producto: no hay estudio comparativo en el repositorio que lo sostenga.
- No decir que el stack tiene certificaciones o auditorías externas: no las tiene.
- No prometer plazos de implementación ni resultados de negocio en la apertura.

---

## Slide 2 — Quién conoce la IA aplicada en empresas grandes ya lo hizo antes

**Layout:** statement · **Tiempo:** 1:00

**Qué decir:**
> Esta plataforma no parte de una idea de laboratorio, parte de problemas concretos de integración en empresas grandes: sistemas que hay que integrar, costos que hay que entender y equipos que hay que coordinar. Eso explica por qué el stack trae control y trazabilidad desde la base, en lugar de agregarlos después como un envoltorio. De la trayectoria personal pasamos ahora a lo que importa para esta sala: qué es exactamente lo que están mirando.

**Transición:** Con el contexto de quién lo construye, definamos qué es el stack y, sobre todo, qué es lo que no es.

**Preguntas esperadas:**
- **P:** ¿Son referencias de clientes de GentleVanguard?
  **R:** No. Son etapas profesionales anteriores del fundador: la trayectoria es verificable, no son casos de este producto.
- **P:** ¿Qué garantiza la experiencia del fundador?
  **R:** Que el diseño responde a problemas ya vistas en integración corporativa. No es una garantía de resultados, y no debe presentarse como tal.

**No decir:**
- No presentar a DIRECTV, GlobalLogic u Oracle como clientes del stack.
- No transformar la trayectoria en promesas de servicio ("con esto garantizamos X"): no hay SLA publicado.
- No usar la experiencia como argumento para saltarse el diagnóstico.

---

## Slide 3 — El stack no es un chatbot: es la capa que lo gobierna

**Layout:** figureLayers · **Tiempo:** 1:45

**Qué decir:**
> Lo que la slide muestra son cuatro piezas y seis capas, pero el marco que importa es otro: cada pieza responde a una pregunta de dirección que hoy se responde con improvisación. ¿Quién puede hacer qué? ¿Qué sabe el sistema? ¿Qué evidencia queda? ¿Qué pasa si algo sale mal? La idea es que esas cuatro respuestas no dependan de la buena voluntad de cada equipo, sino de una capa común que se puede auditar. Todo lo que van a ver después son los detalles de esa capa.

**Transición:** Si el stack es una capa, vale la pena mirar su anatomía completa, porque de ahí sale la respuesta a la pregunta que más importa en esta sala: qué pasa si dejamos de mantenerlo.

**Preguntas esperadas:**
- **P:** ¿El stack reemplaza a las herramientas que ya usamos?
  **R:** No. El stack trabaja sobre las superficies y herramientas que ya están: el objetivo es gobernarlas, no reemplazarlas.
- **P:** ¿Funciona sin conexión a internet?
  **R:** Las capas de control, agentes y datos son locales; los modelos pueden ser de proveedor con cadena de failover a modelos locales. Eso se detalla en la slide de topología.

**No decir:**
- No decir que el stack es "100% local": el modelo puede ser remoto y la sincronización de memoria es opcional.
- No decir que las skills son "código que se escribe": se invocan por contexto, no por desarrollo.
- No enumerar de nuevo las cifras de la slide: la evidencia se sostiene en el repositorio, no en la promesa verbal.

---

## Slide 4 — Nueve capas, cada una con un límite explícito

**Layout:** layers · **Tiempo:** 2:15

**Qué decir:**
> Esta slide es el mapa del stack y también la respuesta parcial a la pregunta de mantenimiento. Cada capa tiene un límite explícito: sabe qué hace y qué no hace, y por eso una capa se puede reemplazar, auditar o extender sin arrastrar a las demás. Eso es lo que convierte al stack en una plataforma y no en un monolito. Cuando una pieza quede vieja, se cambia esa pieza; no hay que rehacer el conjunto.

**Transición:** Con la estructura conocida, conviene dimensionar la escala real de lo que hay detrás.

**Preguntas esperadas:**
- **P:** ¿Qué tan grande es el costo de mantener esto?
  **R:** Es un costo real y hay que decirlo: hay más de 800 archivos de código propio, más de 550 archivos de test y más de 600 scripts de operación. A cambio se compra una base que se puede actualizar por capas, con migraciones versionadas y gates que verifican el estado.
- **P:** ¿Y si el proyecto termina o cambia de dirección?
  **R:** El conocimiento vive en el repositorio y en la base local (Nexus), con 22 migraciones versionadas: eso se puede archivar, traspasar o revisar con un equipo nuevo.
- **P:** ¿Cada capa se puede reemplazar por un proveedor externo?
  **R:** La capa de modelos sí está desacoplada por diseño (proveedor, luego Ollama, luego LM Studio). El resto del stack es propio y su ventaja es justamente que el control no depende de un tercero.

**No decir:**
- No decir que el stack "no necesita mantenimiento": sí lo necesita, y lo que se propone es que ese mantenimiento esté dentro de la plataforma.
- No prometer SLA, disponibilidad ni soporte con acuerdos de nivel de servicio: no hay SLA publicado.
- No leer las cifras de la slide como métricas de mercado: son conteos del propio repositorio.

---

## Slide 5 — No es un prototipo: es un sistema en uso sostenido

**Layout:** metrics · **Tiempo:** 0:45

**Qué decir:**
> Estos cuatro números son del propio código: cuántos archivos de implementación, cuántos de test, cuántos comandos de operación y cuántos chequeos de salud hay. La razón por la que los muestro es simple: cuando alguien pregunta "¿esto es real?", la respuesta más fuerte que existe no es una declaración, es el repositorio, que cualquiera de ustedes puede abrir. El archivo que resume el estado vigente del stack es `docs/generated/STACK-FACTS.md`, y se regenera desde la configuración real.

**Transición:** Con la escala en claro, pasemos a lo que la empresa recibe concretamente al instalar esto.

**Preguntas esperadas:**
- **P:** ¿Estos números significan que hay N empresas usándolo?
  **R:** No. Son conteos de código, tests, scripts y chequeos del propio repositorio. No son métricas de mercado ni de clientes.
- **P:** ¿Los tests están pasando hoy?
  **R:** El estado de los checks de salud y de la suite se consulta en el watchtower y en los scripts de operación; lo que afirmamos en esta sala es que la verificación existe y es automática, no un porcentaje de cobertura.

**No decir:**
- No usar estos números como prueba de adopción, clientela o tamaño de mercado.
- No inventar porcentajes de cobertura, tiempos de build o tasas de éxito que no estén en el repositorio.
- No decir "está auditado por terceros": la auditoría es propia y encadenada.

---

## Slide 6 — Lo que la empresa recibe al instalar el stack

**Layout:** cards · **Tiempo:** 1:30

**Qué decir:**
> Las tres tarjetas son las tres cosas que la dirección termina pidiendo. Roles, para que la capacidad de IA no dependa de una persona concreta que se fue. Costo, para que el gasto tenga techo y se vea antes de la factura. Permisos, para que la exposición a datos y a acciones riesgosas esté escrita antes de que ocurra. El valor no está en cada pieza por separado, está en que las tres se mueven juntas: un rol sin presupuesto ni permisos es un riesgo; un presupuesto sin roles es un gasto difuso.

**Transición:** Con lo que recibe definido, veamos cómo se ve eso en el día a día, porque la promesa se sostiene o cae en el loop de trabajo.

**Preguntas esperadas:**
- **P:** ¿Los presupuestos garantizan que no se pase la factura?
  **R:** No son un seguro: son cortes configurables con umbral blando y duro. Acotan la exposición y generan la señal; el control de gasto real sigue siendo del área financiera.
- **P:** ¿Cómo se define un rol nuevo?
  **R:** En el repositorio, con permisos, límites de pasos, skills y bindings de modelo por área y criticidad. Es un artefacto versionado, no una configuración informal.
- **P:** ¿El ROI es medido?
  **R:** El stack mide y expone el costo de la operación; el ahorro respecto de operar con herramientas sin control no está medido en el repositorio y no vamos a inventarlo.

**No decir:**
- No dar porcentajes de ahorro, ROI o productividad: no hay medición publicada.
- No decir que los presupuestos son un límite duro garantizado de gasto: son cortes con umbral blando y duro.
- No decir "permisos por rol = cero riesgo": el modelo es explícito y auditable, no una garantía.

---

## Slide 7 — Cómo se ejecuta una tarea de punta a punta

**Layout:** flow · **Tiempo:** 1:30

**Qué decir:**
> Este es el loop de trabajo, y funciona igual para un proyecto de una semana que para uno de seis meses, que es justamente lo que permite que la adopción sea gradual sin cambiar de metodología a mitad de camino. Cada turno inyecta contexto y reglas, el router elige modelo y agente, el agente trabaja con herramientas reales y deja traza, y los gates y el revisor cierran el ciclo antes de declarar el trabajo terminado. Para la dirección, el dato relevante es el último paso: el trabajo no se da por bueno porque el modelo lo dijo.

**Transición:** Si el loop termina en verificación, entonces la gobernanza no es un complemento: es parte del circuito.

**Preguntas esperadas:**
- **P:** ¿Quién revisa, una persona o el sistema?
  **R:** Los dos: los gates verifican de forma automática y existe un revisor explícito antes de cerrar. El punto es que la revisión está en el proceso, no en la buena voluntad de alguien.
- **P:** ¿Cuánto cuesta una tarea?
  **R:** Depende del modelo elegido y de la complejidad; el router decide por costo, latencia y carga, y los presupuestos cortan cuando se supera el límite.

**No decir:**
- No decir que el loop es idéntico en costo y en tiempo entre un proyecto chico y uno grande: la forma es la misma, la factura no.
- No decir que los agentes trabajan sin intervención humana: hay revisión y hay escalamiento.
- No llamar "autónomo" a un proceso que tiene gates obligatorios.

---

## Slide 8 — Lo que impide que esto sea un experimento sin control

**Layout:** bullets · **Tiempo:** 2:00

**Qué decir:**
> Esta es la slide que responde "¿esto es seguro para nosotros?". Los seis controles están en el repositorio y son ejecutables: los gates corren en el hook de git y en CI, el escaneo de secretos revisa antes de commit, la auditoría encadenada detecta si alguien edita el registro, el SBOM documenta de qué se compone lo entregado, el dashboard muestra lo que pasó de verdad y el backup diario permite recuperar. El punto de fondo es que ninguno de estos controles depende de que alguien se acuerde de aplicarlos.

**Transición:** Con los controles claros, la pregunta que queda es de gestión: adoptamos IA herramienta por herramienta o con una capa común, y qué pasa si dejamos de mantener la capa.

**Preguntas esperadas:**
- **P:** ¿La auditoría encadenada demuestra que nadie hizo nada indebido?
  **R:** No. Demuestra que el registro no fue alterado de forma inconsistente: es integridad del registro, no una investigación de conducta.
- **P:** ¿El mapeo contra OWASP es una certificación?
  **R:** No. Es un mapeo documentado de controles contra OWASP Top 10 para agentes, en la documentación de seguridad del repositorio. No hay certificación de terceros.
- **P:** ¿Quién opera los gates?
  **R:** El hook de git y el pipeline de CI, con la configuración en `config/quality-gates.json`. Es infraestructura, no una tarea de alguien.

**No decir:**
- No decir "auditado", "certificado" o "cumple con la norma" en sentido de certificación: no existe certificación de terceros.
- No decir que la trazabilidad evita fugas: permite saber qué pasó y demostrarlo.
- No prometer que los controles cubren todo: cubren lo que está implementado y versionado en el repositorio.

---

## Slide 9 — Adoptar IA herramienta por herramienta, o con una capa de orquestación

**Layout:** compare · **Tiempo:** 2:00

**Qué decir:**
> Las dos columnas no difieren en qué tan buenos son los modelos: difieren en dónde queda la capacidad. A la izquierda, la capacidad queda en la empresa, con estándar, presupuesto y registro definidos en el repositorio. A la derecha, cada equipo improvisa, y el conocimiento del proceso vive en conversaciones que se pierden. Sobre la pregunta de mantenimiento, la respuesta honesta es que la capa también se mantiene; lo que cambia es que ese mantenimiento se hace una vez, versionado y con migraciones, en lugar de repetirse en cada herramienta.

**Transición:** Si la diferencia es dónde vive cada parte, la siguiente slide muestra el mapa de residencia de los datos.

**Preguntas esperadas:**
- **P:** ¿Entonces el stack no necesita mantenimiento?
  **R:** Sí lo necesita. La diferencia es que el mantenimiento queda en un solo lugar, versionado y auditable, en vez de disperso en cada herramienta que cada equipo adoptó por su cuenta.
- **P:** ¿La columna de la derecha es "incorrecta"?
  **R:** No es incorrecta, es dispersa: funciona mientras el equipo sea pequeño y la herramienta la controle el mismo grupo. El costo aparece cuando hay que auditar, migrar o explicar qué hizo el modelo.
- **P:** ¿Podemos usar el stack con el proveedor de modelos que ya tenemos?
  **R:** Sí, y la tabla de ruteo permite cambiar de modelo o de proveedor sin reescribir los procesos.

**No decir:**
- No decir que la alternativa "no funciona" o que es irregular: funciona, solo no consolida capacidad.
- No decir "costo cero" ni "sin mantenimiento": el stack tiene costo operativo y hay que decirlo.
- No usar esta slide para descalificar herramientas existentes: el punto es el estándar común.

---

## Slide 10 — Dónde vive cada parte, y por qué importa

**Layout:** table · **Tiempo:** 1:30

**Qué decir:**
> Esta tabla es la que sostiene la promesa de portabilidad, y también es donde conviene ser más preciso. El control del proceso vive local, en la máquina del equipo; la base operacional es local y consultable sin latencia de red; la auditoría son archivos versionados que se pueden archivar o enviar a un SIEM. Sobre la salida del proceso: si mañana dejan de mantener esta plataforma, lo que queda es un repositorio documentado, una base con esquema versionado y un registro de auditoría. No es una caja negra ni una dependencia de un proveedor.

**Transición:** Con el mapa de residencia claro, podemos hablar de la única variable que de verdad preocupa a finanzas: cuánto cuesta y cómo se acota.

**Preguntas esperadas:**
- **P:** ¿Los datos nunca salen de la organización?
  **R:** Los datos operativos y la auditoría son locales por defecto; la memoria admite sincronización opcional y los modelos pueden ser de proveedor. Si eso no es aceptable, el stack tiene ruta local (Ollama, LM Studio) y eso se define por política, no por contrato.
- **P:** ¿Podemos auditar hacia afuera?
  **R:** Sí: la auditoría y las trazas son archivos versionados que se pueden archivar, exportar a un SIEM o retener según la política de la empresa.
- **P:** ¿Qué pasa si la empresa cambia de proveedor de modelos?
  **R:** La tabla de ruteo y la cadena de failover están en configuración (`config/model-router.json`); los procesos no dependen de un modelo concreto.

**No decir:**
- No decir "air-gapped" ni "los datos nunca salen": la sincronización de memoria es opcional y configurable.
- No prometer que cualquier app del stack se puede exponer a internet sin revisión de seguridad: la exposición es opcional y hay que decidirla con política.
- No decir que la base es "replicada en la nube" si no está configurada así en la empresa del cliente.

---

## Slide 11 — El costo de la IA, medido y acotado

**Layout:** metrics · **Tiempo:** 0:45

**Qué decir:**
> Estos cuatro números son la configuración vigente de presupuesto y ruteo del stack, y son los que se pueden cambiar. El objetivo no es frenar el uso de la IA, es que la factura deje de ser una sorpresa y pase a ser una variable de diseño. Cuando esto se instala en una empresa, los valores se ajustan al presupuesto real y quedan escritos en la configuración, no en la cabeza de nadie.

**Transición:** Con la economía ordenada, el último paso es cómo entrar sin romper nada.

**Preguntas esperadas:**
- **P:** ¿Cuánto cuesta operarlo?
  **R:** Depende del consumo de tokens y del modelo que elija el router; los límites actuales están en `config/token-budget-guard.json` y se ajustan por política. No hay tarifa oficial publicada del producto.
- **P:** ¿Qué pasa si se supera el presupuesto?
  **R:** El guardián de presupuesto corta y, según la configuración, degrada el modelo a un perfil más barato antes de llegar al límite duro.

**No decir:**
- No dar precios del producto ni rangos: el catálogo de precios del repositorio aclara que no hay tarifa 2026 publicada.
- No traducir los límites de tokens a una promesa de ahorro en pesos o dólares: son topes, no un ahorro medido.
- No decir que el presupuesto "garantiza" el control del gasto: acota y avisa; la conciliación la sigue haciendo finanzas.

---

## Slide 12 — Cómo se entra sin romper nada

**Layout:** timeline · **Tiempo:** 1:30

**Qué decir:**
> Los cuatro pasos están ordenados por reversibilidad, que es el criterio con el que se los propone. Se audita lo que ya está instalado, se hace un piloto acotado con presupuesto y traza desde el primer día, se extiende lo que funcionó hacia roles formalizados y, por último, se incorporan gates, respaldos, auditoría y actualización a la rutina. El paso dos es el que más conviene no saltear: un piloto mal elegido es la forma más rápida de que la dirección pierda interés.

**Transición:** Con el camino de entrada claro, cerramos con lo que efectivamente estoy proponiendo hoy.

**Preguntas esperadas:**
- **P:** ¿Cuánto dura cada fase?
  **R:** Depende del área y del proceso, y por eso la primera fase es el diagnóstico: no hay un plazo genérico defendible antes de ver la superficie real.
- **P:** ¿Qué pasa si el piloto no funciona?
  **R:** Se detiene y se revisa. Como cada paso es reversible y acotado, el costo de un piloto fallido está en el tiempo, no en una migración de sistemas.
- **P:** ¿Qué necesita de nuestra parte para arrancar?
  **R:** Un área, un proceso, un agente y un interlocutor con decisión sobre el proceso. El resto lo pone el stack.

**No decir:**
- No decir que el audit garantiza que la ejecución va a funcionar: revela la superficie real, nada más.
- No prometer un calendario de adopción ni una migración completa de sistemas existentes.
- No usar esta slide para cerrar precios: el precio no está publicado y el paso es diagnóstico.

---

## Slide 13 — El siguiente paso es un diagnóstico, no un contrato

**Layout:** closing · **Tiempo:** 1:00

**Qué decir:**
> Lo que les propongo es una sesión de trabajo, sin costo y sin compromiso de implementación: revisamos cómo está hoy la IA en su organización, qué herramientas, skills y permisos hay instalados, y qué parte de esta plataforma se puede adoptar sin fricción. Si de esa sesión sale que no conviene avanzar, eso también es una respuesta válida y la plataforma sigue siendo open source. Lo que quiero dejar dicho antes de que entren las preguntas es esto: lo que se propone no es una herramienta más, es una capa de control que se queda en la empresa.

**Transición:** Con esto termina la exposición; paso a las preguntas.

**Preguntas esperadas:**
- **P:** ¿Qué pasa con nuestros datos si hacemos el diagnóstico?
  **R:** La revisión es sobre herramientas, skills y permisos ya instalados; los criterios de manejo de información los define su política y, si hace falta, se ajusta el alcance antes de empezar.
- **P:** ¿Quién mantiene el stack después?
  **R:** La adopción es interna: la configuración, los roles y la evidencia viven en el repositorio y en la base de la empresa, con documentación y migraciones versionadas. Es una decisión que se toma con nombre y apellido, no una caja negra.

**No decir:**
- No cerrar con un compromiso de implementación, precio o plazo: el paso propuesto es diagnóstico.
- No decir que el diagnóstico garantiza una adopción sin fricción: su propósito es decir con honestidad qué tan viable es.
- No cerrar sin decir en voz alta cuál es la salida de la sala: una capa de orquestación gobernada que se queda en la empresa.
