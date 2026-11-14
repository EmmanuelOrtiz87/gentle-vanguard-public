# Guion — GentleVanguard - Onboarding técnico del stack (ES)

- **Deck:** `gv-tecnico-es`
- **Archivo de contenido:** `content/gv-tecnico.es.js`
- **Audiencia:** perfiles técnicos que se suman al stack o que van a operarlo: ingenierías en su
  primera semana o equipo que va a tocar el código del stack.
- **Duración objetivo:** 18 minutos (14 slides, con margen para recortar 3 slides si sobra tiempo).
- **Salida de la sala:** que cualquiera pueda clonar, instalar, arrancar una sesión, leer el estado
  de salud del stack y saber en qué archivo vive cada cosa, sin depender de que otra persona le
  conteste.

> Gu`u{00ED}a de memoria, no teleprompter. Los conteos que aparecen citados salen de `docs/generated/STACK-FACTS.md`, `config/quality-gates.json`y`opencode.json`; si tu checkout difiere de la versi`u{00F3}n
> v4.3.0 del deck, el comando es el mismo pero el n`u{00FA}mero se regenera con `npm run
> stack:facts`.

---

## Slide 1 — Cómo se trabaja dentro del stack

**Layout:** cover · **Tiempo:** 0:45

**Qué decir:**

> Esto no es una demo de producto, es el manual de operación del stack: qué se toca, con qué reglas
> y con qué comandos. En veinte minutos vas a tener el mapa completo del repositorio y el ciclo de
> una sesión de punta a punta. Todo lo que voy a mostrar existe en el repositorio y se puede
> verificar en el momento. Si algo no se puede verificar, no lo digo.

**Transicion:** Antes de entrar al contenido, les muestro el orden en que conviene recorrerlo
durante la primera semana.

**Preguntas esperadas:**

- **P:** ¿Esto es un producto que se vende o un desarrollo interno? **R:** Es un stack propio: el
  repositorio que está abierto acá. Las 30 aplicaciones de `apps/` son desarrollos internos
  nuestros, no casos de clientes.
- **P:** ¿Cuál es la diferencia con el tooling que ya uso? **R:** El stack no reemplaza tu editor ni
  tu terminal: los envuelve con memoria entre sesiones, gates que corren solos y trazas. Si solo
  necesitás editar un archivo, no necesitás esto; si necesitás que el trabajo quede registrado y
  validado, sí.

**No decir:**

- Nada de clientes, logos, casos de éxito ni "líder del mercado": no hay ninguno.
- Nada de precios ni de tarifa por usuario: no hay tarifa oficial publicada.
- No prometas que el stack "te ahorra X horas" ni cites tiempos del deck como resultados medidos.

---

## Slide 2 — Lo que vas a recorrer

**Layout:** agenda · **Tiempo:** 0:40

**Qué decir:**

> El recorrido va de lo estático a lo vivo: primero el mapa del repositorio, después qué pasa
> internamente cuando escribís un pedido, luego el catálogo de capacidades y al final las reglas que
> no se tocan. Es el orden de una primera semana: el día uno instalás y arrancás, y en los días
> siguientes vas bajando al detalle. El deck es autocontenido, pero cada afirmación tiene una ruta
> en el repo para que la verifiques cuando quieras.

**Transicion:** Empecemos por el mapa: ocho carpetas y una responsabilidad cada una.

**Preguntas esperadas:**

- **P:** ¿Hay que leer todo esto antes de tocar el código? **R:** No. Lo mínimo para arrancar son el
  setup y el chequeo de salud; el resto se consulta cuando aparece la duda concreta, y para eso está
  la última slide.
- **P:** ¿Esto reemplaza el onboarding con una persona? **R:** Reemplaza las preguntas que se
  responden con "preguntale a alguien" que están versionadas. Las decisiones de diseño siguen
  necesitando a alguien.

**No decir:**

- Nada de fechas de entrega ni de roadmap: esto describe el stack de hoy, v4.3.0.
- No digas "no hay nada que aprender": hay una semana de curva.

---

## Slide 3 — Ocho carpetas, una responsabilidad cada una

**Layout:** layers · **Tiempo:** 1:25

**Qué decir:**

> La separación entre carpetas no es estética: es lo que permite que las validaciones sean
> automáticas, porque cada frontera tiene un dueño y un criterio. `src/` es el stack, `apps/` son
> las 30 aplicaciones propias que operan sobre él y sirven de banco de pruebas de la arquitectura en
> condiciones reales, `tests/` es la red de seguridad y `config/` es la fuente única de todo lo que
> se puede cambiar. Si una carpeta empieza a hacer lo de otra, la validación automática deja de
> poder referenciar una ruta estable.

**Transicion:** Con el mapa ubicado, veamos qué pasa dentro de una sesión desde que escribís el
pedido.

**Preguntas esperadas:**

- **P:** ¿Por qué `apps/` está dentro del repo y no es un producto aparte? **R:** Porque son
  aplicaciones que consumen el stack: si un cambio en el stack rompe una app propia, se entera el
  mismo pipeline de CI, no un cliente.
- **P:** ¿Cómo sé a qué carpeta va un archivo nuevo? **R:** Por responsabilidad, no por
  conveniencia: la lógica del stack va en `src/`, el material de marca en `assets/`, la
  documentación en `docs/` y las plantillas en `docs/templates/gv/`.

**No decir:**

- Nada que presente `apps/` como carteras de clientes: son desarrollos internos.
- No conviertas los conteos de archivos en métricas de mercado: son conteos del repo, con fecha.
- No digas "arquitectura limpia" como si fuera una metodología: es una separación con un criterio
  concreto.

---

## Slide 4 — Qué pasa cuando escribís un pedido

**Layout:** flow · **Tiempo:** 1:30

**Qué decir:**

> Lo importante de este flujo no es la cantidad de etapas, es que ninguna es opaca: cada una deja
> registro. El preproceso inyecta skills, contexto y reglas antes de que el modelo vea tu mensaje,
> el router decide con qué modelo se responde, y todo lo que pase después queda en la traza. Eso es
> lo que después te permite reconstruir por qué una respuesta salió como salió, y es lo que
> convierte un error en algo diagnosticable en lugar de algo que se improvisa.

**Transicion:** Las etapas las ejecutan piezas concretas del stack; la siguiente slide muestra quién
es quién.

**Preguntas esperadas:**

- **P:** ¿Puedo saltarme alguna etapa? **R:** No desde el lado del usuario: el preproceso y el
  registro son parte del contrato del stack. Lo que sí es opt-in es el ciclo SDD, que se activa
  cuando el trabajo necesita varias sesiones.
- **P:** ¿Dónde veo la traza de una sesión? **R:** En Nexus: sessions, traces, events y tokens
  quedan persistidos ahí y se consultan con SQL directo.

**No decir:**

- No digas que el router "elige el mejor modelo" como si adivinara: elige por reglas declaradas en
  `config/model-router.json`.
- No prometas que todo queda en la traza: lo que no se instrumenta, no está; por eso existen los
  gates.

---

## Slide 5 — 20 agentes, cada uno con su perímetro

**Layout:** cards · **Tiempo:** 1:20

**Qué decir:**

> El roster tiene 20 agentes y la idea no es que elijas uno cada vez, sino que cada agente declare
> su perímetro: modelo, permisos, límite de pasos, presupuesto y fallback. Eso permite delegar sin
> perder el control, porque el delegador no puede delegar algo que el subagente no tiene permitido.
> En la práctica la mayoría de las veces el enrutador elige el agente según la forma de la tarea;
> vos invocás uno en concreto cuando necesitás un perímetro específico.

**Transicion:** Los agentes son los ejecutores; las capacidades que pueden usar son las skills.

**Preguntas esperadas:**

- **P:** ¿Cómo elijo el agente correcto? **R:** Con el recomendador:
  `npm run recommend:agent -- --task "..." --topn 3`, o con
  `npx tsx src/orchestration/recommend-agent.ts --task "..." --topn 3`. El roster está en
  `config/agents.json` y `opencode.json`.
- **P:** ¿Los agentes son "empleados de IA" que trabajan solos? **R:** No. Son roles con permisos
  acotados, presupuesto y trazabilidad; el trabajo sigue siendo tuyo y el resultado se revisa.

**No decir:**

- Nada de "agentes autónomos que hacen el trabajo solos" ni de productividad medida.
- No cites la cantidad de agentes como métrica de nada: es un conteo del roster.
- No digas que todos los agentes escriben código: hay roles de operación, de negocio y de
  documentación.

---

## Slide 6 — Skills: la biblioteca que evita reescribir

**Layout:** bullets · **Tiempo:** 1:25

**Qué decir:**

> Una skill es un `SKILL.md` con frontmatter, descripción y contrato. No se invoca por nombre: el
> router puntúa tu tarea contra la descripción de cada capacidad y propone la más cercana, así que
> no dependés de acordarte de cómo se llamaba. Lo que hace que sea confiable es la higiene: cada
> skill pasa por lint de estructura y acentuación y por el escáner de secretos antes de entrar al
> índice, y una parte de los contratos críticos se prueba en ejecución real.

**Transicion:** Con agentes y capacidades claros, veamos cómo se opera: los comandos.

**Preguntas esperadas:**

- **P:** ¿Cuántas skills hay y cómo lo verifico? **R:** El conteo vigente está en
  `docs/generated/STACK-FACTS.md` (253 indexadas, 28 críticas) y se regenera con
  `npm run stack:facts`. Si el número del slide difiere, es drift estructural y lo reporta
  `npm run stack:facts:check`.
- **P:** ¿Qué pasa si una skill falla? **R:** Nexus separa los outcomes de producción, evaluación y
  mantenimiento: podés ver si una capacidad rinde en una tarea real o solo en la evaluación.

**No decir:**

- No cuentes skills de memoria ni cites el número del slide como si fuera el vigente: el archivo
  generado manda.
- No digas que las skills "se entrenan" ni que son plugins que funcionan solos.
- No prometas que todas las skills están probadas en ejecución: solo un subconjunto crítico.

---

## Slide 7 — Los que se usan todos los días

**Layout:** table · **Tiempo:** 1:40

**Qué decir:**

> La propiedad importante de esta tabla no es la lista, es el principio: toda operación del stack es
> un comando auditable y su salida queda registrada. No hay acciones ocultas ni atajos que solo
> funcionan si conocés un secreto interno del repo. La rutina diaria se reduce a tres: levantar la
> sesión, mirar la salud y mirar el presupuesto; el resto se usa cuando el trabajo lo pide.

**Transicion:** Con eso ya podés operar; ahora veamos dónde queda la memoria de todo lo que hizo el
stack.

**Preguntas esperadas:**

- **P:** ¿Hay comandos internos que no están en esta tabla? **R:** Hay más scripts en el repo, sí.
  Lo que esta tabla muestra es el conjunto de uso diario; todo lo demás sigue siendo un comando
  versionado, no una acción manual.
- **P:** ¿Cuál es el comando que más se usa? **R:** `npm run watchtower:health` es el que responde
  "¿está sano el stack?", y `npm run session:autostart:detached` es el que levanta la sesión en
  background de forma idempotente.

**No decir:**

- No inventes comandos: si no está en `package.json`, no existe.
- No digas que esta lista es exhaustiva de todo lo que se puede correr.
- No prometas tiempos de ejecución exactos: la tabla muestra una aproximación en un entorno
  concreto.

---

## Slide 8 — Nexus: la memoria operacional del stack

**Layout:** figureLayers · **Tiempo:** 1:25

**Qué decir:**

> Nexus es la base operacional del stack: SQLite en WAL, con migraciones versionadas y respaldo
> diario. Acá queda lo que el stack aprende de su propio trabajo: sesiones, trazas, eventos, tokens,
> uso de skills y decisiones de ruteo. La decisión de diseño relevante es que se consulta con SQL
> directo, sin una capa de reportes que pueda desincronizarse de la verdad. Y ojo con la honestidad:
> es un archivo local, así que el backup es una disciplina, no un detalle.

**Transicion:** Si todo lo que aprende el stack queda registrado, la pregunta siguiente es quién lo
verifica.

**Preguntas esperadas:**

- **P:** ¿Qué pasa si se cae el stack o se rompe la base? **R:** El trabajo no se pierde: el código
  está en git, el estado del stack en Nexus y los cambios sin commitear se respaldan con
  `npm run guard:snapshot`. Para diagnosticar: `npm run watchtower:health`, `npm run health:check`,
  `npm run stack:doctor` y `npm run db:health`; si la base quedó corrupta,
  `npm run db:restore latest`. Después se levanta la sesión con
  `npm run session:autostart:detached`.
- **P:** ¿Es un servicio en la nube? **R:** No: corre en tu máquina, en `.runtime`, con respaldos
  diarios y 14 copias retenidas. Si la máquina muere, se restaura del último backup o se reclona el
  repo.

**No decir:**

- No digas que Nexus es multi-tenant ni que es un servicio administrado.
- No prometas alta disponibilidad ni redundancia: es un archivo local con backup.
- No afirmes cifrado de punta a punta sin que esté en el repo.

---

## Slide 9 — La calidad no se pide: se ejecuta

**Layout:** metrics · **Tiempo:** 1:15

**Qué decir:**

> La diferencia con un stack sin gates es que la validación no depende de que alguien se acuerde. El
> stack corre sus propios controles en cada commit, en cada push y en cada ciclo de salud, y el
> registro de qué se ejecuta está en `config/quality-gates.json`. Ese archivo distingue los gates
> que lefthook o CI ejecutan de los que están aspiracionales, y `npm run gates:stats` recalcula el
> conteo. Ojo con el detalle: los hooks se instalan con `npm run setup` vía lefthook y los workflows
> viven en CI.

**Transicion:** Con la estructura entendida, pasemos a lo práctico: cómo se instala esto en tu
máquina.

**Preguntas esperadas:**

- **P:** ¿Los gates garantizan que el código no tenga bugs? **R:** No, y no lo voy a vender así. Los
  gates verifican lo que se puede verificar de forma automática; el resto es revisión humana.
- **P:** ¿Qué pasa si un gate me bloquea el commit? **R:** El gate te dice qué regla se rompió y
  dónde. Los bloqueos son intencionales: el guardrail de destrucción exige confirmación explícita y
  el snapshot de untracked corre antes de una operación riesgosa.

**No decir:**

- No digas que los gates garantizan calidad: verifican lo verificable.
- No digas que todos los gates del registro se ejecutan: el archivo marca cuáles sí y cuáles no.
- Nada de certificaciones ni de estándares de terceros que el stack no tenga.

---

## Slide 10 — Del clone a la primera sesión

**Layout:** timeline · **Tiempo:** 1:30

**Qué decir:**

> La instalación es un comando: `npm run setup`, que va al orquestador de setup y deja la máquina
> lista. Antes de eso, `npm run install:doctor` te verifica los prerrequisitos: Node 22.18 o
> superior, pnpm 11 y Git. Después, dependencias con lockfile congelado, la base de Nexus creada en
> `.runtime` con sus migraciones pendientes y lefthook instalado con los hooks de commit y push.
> Cada paso es idempotente: si se corta, lo volvés a correr y no duplica nada.

**Transicion:** Ya tenés el stack andando; falta entender quién decide con qué modelo te responde.

**Preguntas esperadas:**

- **P:** ¿Funciona en Windows, Linux y macOS? **R:** Los prerrequisitos verificados son Node 22.18 o
  superior, pnpm 11 y Git. El repo se trabaja hoy sobre Windows; en otro sistema operativo,
  `npm run install:doctor` te dice qué falta antes de que toques nada.
- **P:** ¿Qué pasa si `pnpm install` se corta? **R:** Se vuelve a correr: el lockfile congelado hace
  que el árbol del workspace resuelva siempre igual.

**No decir:**

- No prometas que el setup funciona en cualquier sistema operativo o con cualquier versión de Node.
- No digas que el setup reemplaza leer `AGENTS.md`: lo instala, no lo internaliza.
- No inventes pasos que no estén en el orquestador.

---

## Slide 11 — El router decide, y deja decidir el código

**Layout:** table · **Tiempo:** 1:30

**Qué decir:**

> El modelo no lo elegís vos en cada mensaje: lo elige la política, y la política está versionada en
> el repo, que es la diferencia con cambiar un parámetro en caliente. Hay perfiles, escalamiento por
> complejidad de la tarea, cadena de failover entre proveedores locales, un circuito que se abre
> después de cinco fallas y una auditoría de 90 días de cada decisión de ruteo. La temperatura está
> bloqueada por defecto justamente para que el comportamiento sea reproducible y comparable.

**Transicion:** Todo eso funciona si las reglas se respetan; estas son las que no se negocian.

**Preguntas esperadas:**

- **P:** ¿Puedo forzar un modelo premium para una tarea difícil? **R:** El escalamiento ya lo hace
  por complejidad de la tarea, y el perfil por dominio está declarado. Cambiar eso es un cambio de
  configuración en el repo, revisado como cualquier otro, no algo que se tweak en runtime.
- **P:** ¿Qué pasa si se cae el proveedor de modelos? **R:** El failover encadena opencode, ollama y
  lm-studio2, con caché de cinco minutos y un modelo de respaldo. Si los tres fallan, el circuito se
  abre y el stack deja de intentar; ahí la salida es el modelo local, con menor calidad.

**No decir:**

- No digas que se puede cambiar el modelo o la temperatura en caliente: la política lo bloquea.
- No prometas que el failover es instantáneo ni que un modelo local equivale en calidad al remoto.
- Nada de precios por token ni de costo por usuario.

---

## Slide 12 — Lo que no se negocia en este repositorio

**Layout:** bullets · **Tiempo:** 1:40

**Qué decir:**

> Estas seis reglas existen porque algo se rompió antes: procesos de PowerShell que abrían ventanas
> en la sesión de otra persona, borrados masivos sin confirmación, y documentación que decía "TBD" y
> no decía nada. La regla de fondo es que el stack tiene que ser invisible para quien lo usa y
> explícito para quien lo mantiene. Y sobre la pregunta que siempre aparece: ¿por qué no uso X y
> listo? Porque X no te da trazabilidad, gates ni memoria entre sesiones; si tu trabajo no necesita
> eso, usá X y quedate con algo simple.

**Transicion:** Con las reglas claras, la última slide de referencia dice dónde está cada respuesta.

**Preguntas esperadas:**

- **P:** ¿Puedo saltarme las reglas si es más rápido? **R:** Son las reglas que hacen que el
  resultado sea confiable para el siguiente. Saltarlas se puede; el costo es que el próximo tiene
  que reconstruir por qué.
- **P:** ¿Qué pasa si el stack se cae a mitad de una tarea? **R:** Queda el trabajo a medias y
  protegido: `npm run guard:snapshot` respalda untracked y parches sin commit antes de una operación
  riesgosa, y los commits por slice dejan historial usable. Después se diagnostica con
  `npm run watchtower:health` y `npm run health:check`, y se retoma desde la sesión.

**No decir:**

- No presentes las reglas como burocracia: decí qué falla sin ellas.
- No digas que el stack nunca toca producción ni que trabaja sobre datos de clientes: no es el caso.
- No prometas tiempos de build o de setup exactos: dependen de la máquina.

---

## Slide 13 — Dónde buscar cada tipo de respuesta

**Layout:** table · **Tiempo:** 1:05

**Qué decir:**

> El conocimiento del stack está versionado, y esa es la diferencia con un equipo que todo lo tiene
> en la cabeza de una persona. Para la regla vigente, `AGENTS.md` en la raíz; para el detalle de un
> módulo, el manual por módulos; para las cifras, el archivo generado de hechos, que se regenera con
> `npm run stack:facts` y se contrasta con `npm run stack:facts:check`. Si una respuesta no está
> ahí, es que todavía no está escrita, y eso también es información útil.

**Transicion:** Con el mapa del conocimiento completo, cerramos con lo que hace falta para arrancar.

**Preguntas esperadas:**

- **P:** ¿Por qué hay dos manuales? **R:** Uno es modular y se consulta por área; el otro es la
  arquitectura completa, para cuando necesitás el contexto entero de una vez.
- **P:** ¿Y si no encuentro lo que busco? **R:** Es una señal: el tema no está documentado. Se
  escribe el faltante en el repo en vez de dejarlo en un chat.

**No decir:**

- No mandes paths que no existan: verificá la ruta antes de decirla.
- No digas "preguntá en el chat del equipo" como respuesta: el conocimiento va al repo.
- No prometas que la documentación está completa: es un repo vivo.

---

## Slide 14 — Tu primer día

**Layout:** closing · **Tiempo:** 0:50

**Qué decir:**

> Concreto para el día uno: instalá, arrancá una sesión y pedí el estado de salud del stack; después
> elegí un issue chico y dejá que el flujo inline haga el resto, explorando, implementando y
> verificando en proporción al riesgo. Lo que quiero que quede en la sala es esto: el stack es el
> repositorio, sus comandos son su interfaz, y su documentación es la fuente de verdad. Si una regla
> te parece arbitraria, discutí como un pull request.

**Transicion:** Cierre. La pregunta que dejo abierta es qué parte del flujo todavía les falta.

**Preguntas esperadas:**

- **P:** ¿Hay soporte durante la primera semana? **R:** El soporte real es el repo: `AGENTS.md`, el
  manual de stack y los ejemplos de uso. Para decisiones de diseño, el equipo; para el resto, la
  documentación.
- **P:** ¿Por dónde empiezo si ya tengo el repo clonado? **R:** Por `npm run watchtower:health`: te
  dice si tu máquina está sana antes de que escribas la primera línea.

**No decir:**

- No prometas tiempos de respuesta, SLA ni acompañamiento con horario.
- No cierres sin decir cuál es la salida de la sala: si termina sin eso, la presentación no terminó.
- No prometas que el primer día va a ser trivial: la curva existe y es la semana completa.

---

## Plan B (si sobra tiempo)

- Recortables, en este orden: Slide 2 (0:40), Slide 9 (1:15) y Slide 13 (1:05). Las demás tienen
  contenido que no se puede quitar sin perder la salida de la sala.
- Si sobra tiempo de verdad, profundizá en las "Preguntas esperadas" de Slide 8, Slide 11 y Slide
  12: es donde aparecen las preguntas duras.
- No agregues slides nuevas por más tiempo que te sobre.
