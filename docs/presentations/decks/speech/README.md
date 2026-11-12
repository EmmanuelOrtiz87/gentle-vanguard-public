# Guiones de presentacion — contrato y guia de uso

Cada deck del toolkit tiene un **guion**: el texto que se dice en voz alta,
slide por slide. El deck dice *qué* muestra la slide; el guion dice *cómo se
explica*, *cuánto se tarda*, *qué se pregunta al final* y *qué no hay que
decir*.

Sin guion, una presentacion se improvisa. Y lo que se improvisa se inventa:
numeros que el repo no respalda, clientes que no existen, resultados que no
estan medidos. El guion es el piso de seguridad editorial.

## 1. Ubicacion

```
docs/presentations/decks/speech/
  gv-negocio-leads-es.md      <- guion deck negocio/leads, en español
  gv-negocio-leads-en.md      <- same deck, in English
  gv-enterprise-es.md
  gv-enterprise-en.md
  gv-tecnico-es.md
  gv-tecnico-en.md
  gv-theme-candidates.md
  README.md                   <- este documento (el contrato)
```

El nombre del archivo es el **`id` del deck** (el campo `id:` de
`content/<deck>.js`). El gate `decks:guion` exige exactamente esa cobertura.

## 2. Formato (obligatorio)

El gate verifica la estructura. Un guion que no la cumple **falla el gate**:

```markdown
# Guion — <titulo del deck> (<ES|EN>)

- **Deck:** `gv-tecnico-es`
- **Archivo de contenido:** `content/gv-tecnico.es.js`
- **Audiencia:** <quien esta en la sala>
- **Duracion objetivo:** <minutos>
- **Salida de la sala:** <que tiene que quedar dicho>

---

## Slide 1 — <titulo de la slide>

**Layout:** cover · **Tiempo:** 0:45

**Qué decir:**
> <texto hablable, 2-5 frases. Es lo que DECIS, no lo que la slide ya muestra.>

**Transicion:** <una frase que conecte con la slide siguiente>

**Preguntas esperadas:**
- **P:** <pregunta que seguro va a hacer alguien>
  **R:** <respuesta corta, 1-3 frases>

**No decir:**
- <afirmacion prohibida en ESTA slide, o "nada en particular">
```

### Las claves obligatorias

| Clave | Para que sirve |
| --- | --- |
| `**Tiempo:**` | Permite ajustar el ritmo. Si el tiempo total se pasa, se recortan las slides marcadas como `0:30` (opcionales). |
| `**Qué decir:**` | El texto hablable. Es lo unico que se lee de memoria. |
| `**Transicion:**` | La frase que conecta con la slide siguiente. Sin ella, el guion son slides aisladas. |
| `**Preguntas esperadas:**` | Las preguntas que seguro llegan en ESA slide, con respuesta corta. |
| `**No decir:**` | Las trampas de esa slide. Vacio no vale: se escribe "nada en particular". |

El gate acepta la variante en ingles de cada clave (`**Time:**`, `**What to say:**`,
`**Transition:**`, `**Expected questions:**`, `**Do not say:**`): lo que importa es que la
informacion este, no como se rotule.

## 3. Reglas editoriales (red lines)

Estas reglas no son preferencias. Son la linea que separa una presentacion
sostenible de una que no se puede sostener:

1. **No se inventan clientes, casos, testimonios ni resultados.** Los 29 apps
   del stack son desarrollos internos propios. Si no hay un dato medido, no se
   da el dato.
2. **No hay certificaciones ni estandares de terceros** que el stack no tenga.
3. **No hay precios** si no hay una tarifa oficial publicada. Se habla de
   modelo de trabajo, no de numeros inventados.
4. **Los conteos del repo son reales y se citan como tales** ("257 skills
   indexadas", "33 gates"), nunca como metricas de mercado.
5. **El "que decir" no repite la slide.** La slide ya esta leida; el guion
   aporta el marco, la relacion con lo anterior y lo que se viene.
6. **Toda afirmacion tecnica se puede verificar en el repo.** Si el oyente
   puede pedir la ruta, tiene que existir.

## 4. Como usar el guion en el evento

- **Ensayo cronometrado**: el tiempo por slide es el presupuesto, no un adorno.
  Si sobra tiempo, se profundiza en las "preguntas esperadas", no se agrega
  slides nuevas.
- **Plan B**: las slides marcadas con `**Tiempo:** 0:30` son las cortables.
- **Cierre**: la ultima slide debe decir cual es la salida de la sala. Si
  termina sin eso, la presentacion no termino.
- **No leer**: el guion es una guia de memoria, no un teleprompter. Si suena a
  lectura, esta mal usado.

## 5. Verificacion

```bash
npm run decks:guion         # cobertura de guiones (gate, bloqueante)
npm run decks:lint          # lint de slides (texto, cifras, layout)
npm run decks:qa:contrast   # contraste AA de los decks renderizados
```

El gate de guion es **bloqueante**: un deck sin guion completo no pasa el
pre-push. Es intencional: agregar un deck sin su guion es crear una
presentacion que se presenta a ciegas.
