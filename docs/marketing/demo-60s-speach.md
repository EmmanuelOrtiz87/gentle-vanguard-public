# Speech del demo 60s — voice-over del owner

> **Fecha:** 2026-11-06 · **Video:** `.runtime/demo-video/demo-60s-silent.mp4` (60.2s, sin
> audio) · **Merge:** `ffmpeg -i demo-60s-silent.mp4 -i voz.m4a -c:v copy -map 0:v -map 1:a
> demo-60s-final.mp4`
> Ritmo: ~95 palabras, velocidad natural de conversación. Grabar mirando el video con cronómetro.

---

**[0:00–0:10]** *(hero: "Tu negocio crece. Tus sistemas también.")*

> "Tu negocio crece. Tus sistemas también. En GentleVanguard diseñamos software a medida — y
> construimos el sistema con el que lo hacemos bien."

**[0:10–0:22]** *(repo público en GitHub)*

> "Este es nuestro stack de AI Engineering. Open source, auditable, local-first: los datos nunca
> salen de tu máquina. Con él operamos cada proyecto."

**[0:22–0:38]** *(Academy: rutas guiadas → curso)*

> "¿Por dónde se empieza? Con rutas guiadas según tu objetivo: fundamentos si arrancás de cero,
> AI Engineering si sos developer, gobernanza si respondés por una empresa. Paso a paso, con
> cursos que se usan en el trabajo real."

**[0:38–0:50]** *(sección sistema: prueba / fábrica / canal)*

> "Así trabajamos: cada proyecto de cliente es la prueba. Nuestro stack es la fábrica que lo
> construye seguro y medible. Y Academy es el canal donde tu equipo aprende a operar así."

**[0:50–1:00]** *(end-card canon: frase + web + firma)*

> "GentleVanguard. Software inteligente — y el sistema para hacerlo bien.
> gentlevanguard.github.io"

---

## Notas de grabación

- Tonos: directo, cálido, sin tono publicitario. "Lo que sale bien y lo que no" es parte de la
  marca (§10 posicionamiento-unificado).
- Si un tramo queda largo: avisar qué segundo y se re-corta ese segmento (los crudos están en
  `.runtime/demo-video/seg*.mp4`).
- Alternativa TTS: el stack ya tiene motor TTS en `apps/content-cms/server/` — se puede
  generar una narración provisional para validar el corte antes de grabar la voz real.
