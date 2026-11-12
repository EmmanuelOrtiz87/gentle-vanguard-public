# FAQ de presentacion — GentleVanguard

El soporte para las preguntas que van a llegar en un evento. Cada respuesta es
**corta a propósito**: lo que se dice en voz alta, no un documento.

La regla de este documento: **si no está medido, no se afirma**. Cuando la
respuesta honesta es "no lo tenemos medido", esa es la respuesta.

Complementos:
- Guiones por deck: `decks/speech/` (qué decir, slide por slide)
- Nomenclatura: `NOMENCLATURA.md` (qué significa cada término)
- Hechos del stack: `docs/generated/STACK-FACTS.md` (cifras regeneradas)

---

## 1. Sobre el producto

### ¿Qué es GentleVanguard?

Una plataforma de agentes de IA para equipos de producto: un stack local-first
que incluye 29 apps, 257 skills indexadas, los agentes, la base
operacional y los gates de calidad. Todo corre en la máquina del equipo; la
promoción a servicios externos es opcional.

### ¿Es un framework o un producto?

Un **stack**. La diferencia importa: un framework se usa desde tu código; un
stack viene con su runtime, sus agentes, sus gates y su operación. Acá se
instala, se arranca y ya tiene proceso de calidad incorporado.

### ¿En qué lenguaje / con qué corre?

TypeScript sobre Node 24, pnpm 11 como gestor. ESM en todo el repo. El
frontend es React (Vite). La base es SQLite (operacional) y Nexus (persistencia
de conocimiento).

### ¿Cuánta gente hace falta para operarlo?

Una persona técnica lo opera. Los agentes hacen el trabajo pesado y los gates
verifican; la persona decide qué se libera. Es un stack de un equipo chico, no
de un area.

### ¿Cuánto cuesta?

No hay tarifa oficial publicada, así que no hay precio que citar. El modelo de
trabajo es el que se puede describir: licencia del stack, costo de la
infraestructura donde corran los modelos y costo de operación del equipo. Lo
que **no** hay es un precio cerrado que prometer.

---

## 2. Sobre la IA y los agentes

### ¿Qué modelos usa?

Un router: el stack no ata a un proveedor. Según la tarea elige el modelo
disponible (local u online). Hoy el modelo activo del workspace es
`opencode-go/gpt-5.6-luna`.

### ¿Los agentes hacen lo que dicen?

Cada entrega pasa por gates ejecutables, no por confianza: lint, typecheck,
tests, gates de calidad y auditoría de apps. Un agente que entrega roto **no
pasa el pre-push**. Ese es el mecanismo, no una promesa.

### ¿Cómo se evita que un agente invente?

Con gates que verifican contra el repositorio, no contra la prosa. Ejemplo
real: el guard anti-`.gitignore` comprueba que el código referenciado por los
scripts realmente viaje en el clon; el gate de cobertura de typecheck comprueba
que ninguna app verifique solo una parte de su código. Si un dato no es
verificable, no entra.

### ¿Cómo se maneja la información sensible?

El stack es local-first: el modelo, los prompts y los datos viven en la
máquina. La base de conocimiento tiene control de acceso por principal
(`principals`), y la promoción externa de skills es un paso explícito y
auditable, no el default.

### ¿Hay riesgo de que el agente rompa algo?

El de siempre de cualquier automatización, y el stack lo acota: trabajo en
ramas, gates bloqueantes antes del push, y el stack es auditable (historial,
procesos con PID, logs). Lo que **no** se afirma es que no pueda pasar nada:
se afirma que hay capas para detectarlo.

---

## 3. Sobre el negocio

### ¿Quién es el cliente típico?

El perfil es un equipo que ya usa IA en su operación y quiere **sistema**: no
solo un chat que responde, sino un stack con procesos, gates y trazabilidad.
Equipos de producto, marketing y operaciones técnicas.

### ¿Cuánto cuesta mantenerlo?

Menos de mantener un ensamblaje equivalente de herramientas sueltas, y eso es
una dirección, no un número: el costo de mantenimiento de un stack con gates
es el de mantener los gates, no el de mantener N integraciones que nadie
audita.

### ¿Qué ROI tiene?

**No hay ROI medido y no se va a inventar.** Lo que sí se puede decir: el
trabajo repetitivo que hoy se reparte entre personas y herramientas sueltas
converge en un proceso con verificación. Cualquier cifra de ahorro antes de
tener un cliente real sería inventada.

### ¿Tienen clientes / casos de éxito?

Las ~29 apps del stack son **desarrollos internos propios**. No hay una cartera
de clientes que citar, y no se va a fabricar una. Cuando exista, se publica.

### ¿Pueden integrar con nuestro sistema?

Sí, es lo que hacen las skills y los conectores: el stack expone interfaces
(MCP, APIs, la base de conocimiento) para que lo externo entre por un punto
definido y auditable, no por un sidecar suelto.

---

## 4. Sobre la operación

### ¿Qué pasa si algo se cae?

Hay supervisores por proceso: cada daemon tiene watchdog, y el watchdog tiene
presupuesto de reinicio y modo degradado (si agota el presupuesto sigue
vigilando con menos presión, en vez de abandonar el servicio). La política de
"puerto abierto no es vida real" está implementada: la liveness se decide por
la API HTTP, no por el socket.

### ¿Cómo sé si el stack está sano?

```bash
npm run health:check          # panorama completo
npm run health:check:quiet    # solo el veredicto
```

El dashboard (WS API en 8080, UI en 5173) muestra las métricas en vivo. Si el
health check da ALL PASS, el stack está operable.

### ¿Cómo se agrega una app?

Con su `package.json`, su `tsconfig.json` y su script `typecheck`. El gate de
cobertura de typecheck exige que el typecheck de la app cubra **todo** su
código (`src/`, `tests/`, `scripts/`): un typecheck verde que solo mira
`src/` es peor que uno roto, porque da una confianza que no está.

### ¿Cómo se cambia algo con confianza?

El ciclo es: rama → agente o humano → gates → revisión → merge. El
pre-push corre 20 verificaciones (lint, typecheck, tests, gates, auditoría de
apps). Si algo no pasa, no pasa.

---

## 5. Preguntas incómodas (las que hay que saber responder)

### "¿Y si el stack se cae el día de la demo?"

Plan B documentado: el deck de negocio y el de enterprise son editables
PowerPoint (texto editable, no imágenes aplanadas). Si el demo en vivo falla,
se sigue con el deck: el material está para eso.

### "¿Ustedes depuran esto o solo lo vendieron?"

El stack es propio y se opera a diario. El ciclo de trabajo del repo (gates,
sesiones, memoria) es la misma evidencia de que se usa.

### "¿Qué pasa con los datos de mi empresa?"

Quedan en la máquina, salvo promoción explícita. La base de conocimiento tiene
control de acceso por principal y la promoción externa de skills es un paso
consciente.

### "¿Por qué 29 apps y no un monolito?"

Cada app es un dominio con su propio ciclo. El monolito se vuelve imposible de
operar; el stack de apps sin fronteras se vuelve imposible de entender. El
tamaño es la consecuencia de haber favorito verificación por app.

---

## 6. Reglas del que presenta

1. **Si no lo sé, digo que no lo sé.** Es la respuesta más fuerte disponible.
2. **Los conteos se citan como del repo**, no como métricas de mercado.
3. **No hay clientes, no hay resultados medidos, no hay certificaciones.**
   Ninguna frase de este documento sirve para inventar ninguna de las tres.
4. **No hay precios.** Si preguntan, se describe el modelo de trabajo.
5. **Si un dato del deck está desactualizado, se corrige en el momento**
   (el deck es editable PowerPoint justamente para eso).
