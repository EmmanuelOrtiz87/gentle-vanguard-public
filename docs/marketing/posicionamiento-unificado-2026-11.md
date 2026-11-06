# Posicionamiento Unificado — Narrativa única, perfiles y rutas

> **Fecha:** 2026-11-06 · **Fuente:** validación de feedback externo de marca (asesoría
> fundador) + reconciliación con `docs/marketing/rumbo-comercial-redes-leads-2026-10.md` y
> `docs/analysis/POSITIONING-2026-10.md`. Este doc es la superficie operativa de marca vigente;
> los dos anteriores quedan como antecedentes de decisión.

## 1. Validación del feedback (qué adoptamos, qué corregimos)

| Afirmación del feedback | Veredicto | Acción |
| --- | --- | --- |
| "Sitio, academia y GitHub parecen tres empresas distintas" | ✅ Correcto y es el problema #1 | Narrativa única (§2) aplicada en los 3 frentes |
| LinkedIn como canal principal del fundador (60%) | ✅ Adoptar | El perfil personal es el activo de autoridad más barato; ningún doc previo lo trabajaba |
| "Publish: experiencia → aprendizajes → arquitectura → open source" | ✅ Adoptar como los 4 niveles de contenido | §4, calendario piloto |
| IG/TikTok secundarios | ⚠️ Matizar | La cadencia 4 piezas/semana en TikTok/IG ya estaba decidida (POSITIONING §7) y la automatiza `gv-social-studio` — el costo marginal es bajo. El feedback acierta en que **no llevan la carga de autoridad**: llevan prueba de criterio y alcance |
| "Lo que aprendí creando 135 skills" | ❌ Números desactualizados | Usar cifras reales verificadas: 21 agentes, 254 skills, 154 checks, 28 cursos. Nunca publicar cifras sin verificar contra el stack |
| Academia: faltan journeys, sobra catálogo | ✅ Correcto | Rutas mapeadas a cursos reales (§5) |
| "6 meses: LinkedIn, GitHub, casos, academia como embudo, sitio unido" | ✅ Converge con el plan de 90 días existente | Fusionado en §6 |

**Conclusión:** el feedback no contradice el plan vigente — le agrega la pata que faltaba
(autoridad personal del fundador en LinkedIn) y el hilo narrativo entre los tres frentes.

## 2. La única historia (narrativa madre)

> **Emmanuel Ortiz y GentleVanguard no solo desarrollan software e IA: construyen un sistema de
> trabajo para la próxima generación de equipos de ingeniería asistidos por IA.**
>
> Consultoría (apps y sistemas a medida) es la **prueba**. El stack GentleVanguard
> (orquestación, memoria, gobernanza, 154 checks) es la **fábrica** con la que esa prueba se
> construye segura y medible. Academy es el **canal** que enseña a operar así y baja objeciones.

Una frase por superficie, misma historia:

- **Sitio:** "Desarrollamos software inteligente — y construimos nuestras propias plataformas de
  AI Engineering para hacerlo de forma más segura, más gobernada y más escalable."
- **GitHub:** "The local-first governance, memory and verification layer for AI-assisted
  engineering teams." (ya aplicado en README-PUBLIC, 2026-11-06)
- **LinkedIn (fundador):** la narrativa en primera persona (§3).

## 3. LinkedIn — perfil del fundador

**Headline (ES):**

> Software Architect · AI Engineering · Fundador de GentleVanguard — sistemas de IA que operan en
> el trabajo real: orquestación, memoria persistente y gobernanza. 15+ años de arquitectura e
> integración.

**Headline (EN, alternativa):**

> Software Architect | AI Engineering | Founder @ GentleVanguard — building AI engineering
> systems: orchestration, persistent memory, governance. 15+ years in architecture & integration.

**Sección Acerca de (borrador v1, primera persona):**

> Después de 15+ años diseñando arquitectura e integraciones, vi el mismo patrón en todos los
> equipos: el código escala más rápido que la gobernanza. Los asistentes de IA escriben features
> en horas que antes tomaban semanas — y las decisiones de diseño, el contexto y la calidad se
> les escapan igual de rápido.
>
> Por eso construí GentleVanguard: un stack local-first de orquestación, memoria persistente y
> verificación para desarrollo asistido por IA. 21 agentes especializados, 254 skills bajo
> demanda, 154 health checks automatizados. No reemplaza Cursor ni Copilot — se monta encima.
>
> Con ese stack operamos tres cosas:
> 1. **Software a medida** para pymes y empresas: apps, sistemas, bots, dashboards — con
>    gobernanza incluida, no como afterthought.
> 2. **GentleVanguard Academy**: 28 cursos que enseñan a operar IA en el trabajo real — el canal
>    por el que equipos y personas llegan al método.
> 3. **Open source**: el núcleo del stack es público y auditable.
>
> Lo que publico acá: casos reales con números, arquitectura, y lo que sale mal (también). Sin
> humo: si no lo corremos en producción, no lo posteo.

**Niveles de contenido (del feedback, adoptados):** 1) experiencia/problema, 2) aprendizajes
(salió mal también), 3) arquitectura (cómo funciona el sistema de memoria, por qué fallan los
agentes), 4) open source (qué se sumó, límites incluidos). Cadencia: 2-3 posts/semana.

## 4. Instagram y TikTok — bios reescritas (canal de prueba, no de autoridad)

**Instagram `@gentlevanguard.sj` (150 chars aprox. por línea):**

> Convertimos procesos desordenados en apps, sistemas y automatizaciones a medida.
> IA aplicada al trabajo real · Stack propio · Casos verificables
> Empezá acá 👇 [link al lead magnet / curso de entrada]

**TikTok `@gentlevanguard.sj`:**

> IA aplicada a empresas, no a la demo. Apps, sistemas y gobernanza.
> Casos reales con números ↓ [link]

**Regla de CTA (heredada de POSITIONING §4, no negociable):** el link de bio va al **lead
magnet / workshop**, nunca al catálogo de cursos. Linkear al catálogo es linkear a una lista.

## 5. Academy — rutas (journeys, no catálogo)

Mapeadas a carpetas reales de `apps/academy-web/data/courses/`:

| Ruta | Para quién | Recorrido |
| --- | --- | --- |
| **Ruta Fundamentos** (emprendedor / equipo no técnico) | PyMEs, equipos comerciales | `ia-fundamentos` → `alfabetizacion-digital` → `automatizacion-ia` → `gemini` |
| **Ruta Profesional** (AI Engineering) | devs, perfiles técnicos | `python-inicial` → `python-intermedio` → `web-inicial` → `web-intermedio` → `ai-engineering` → `agentes-ia` → `patrones-diseno` |
| **Ruta Empresa** (gobernanza) | CTOs, responsables IT, compliance | `gobernanza-ia` → `ia-ciberseguridad` → `ciberseguridad` → `gentle-vanguard` |

Presentar como "empezá por el paso 1", no como lista de 28. La ruta es el embudo; el catálogo es
el inventario.

## 6. Plan fusionado (próximos 6 meses, orden por ROI)

1. **Semana 1:** aplicar bios + headline + About (manual en cada red — este doc tiene el copy);
   unificar el link de bio a la landing con lead magnet.
2. **Semana 1-2:** landing única con la narrativa madre (§2) conectando consultoría + stack +
   academia (hoy: `corporate-web` + `gentlevanguard-pages`); CTA único.
3. **Semana 1-4:** piloto de contenido — 2-3 posts LinkedIn del fundador/semana (niveles §3) +
   4 piezas TikTok/IG/semana vía `gv-social-studio` (mix 40% caso real / 30% tutorial 60s /
   20% anatomía stack / 10% catálogo). **Casos con números primero.**
4. **Semana 3-4:** demo grabada de 90s (misma en todas las redes).
5. **Continuo:** GitHub como prueba de ingeniería — demos, evidencia, compatibilidad honesta
   (README ya muestra el estándar).
6. **Medición (90 días):** guardados+compartidos ×3, ≥30 clicks/mes al lead magnet, ≥6
   conversaciones calificadas/mes, ≤5 h/semana de trabajo social manual.

## 7. Qué se hace con agentes y qué es manual

| Tarea | Quién |
| --- | --- |
| Posts LinkedIn (copy), piezas TikTok/IG, calendario, variaciones | `gv-social-studio` + `mkt-agent` (draft; publicación requiere OAuth ya configurado en content-cms) |
| Rutas de academia en la web | Slice en `apps/academy-web` (próxima sesión) |
| Landing unificada | Slice en `corporate-web`/pages (próxima sesión) |
| Aplicar bios/headline en LinkedIn/IG/TikTok | **Manual** (las apps no exponen edición de perfil por API estable) |
| Demo 90s | Grabación de sesión real del stack + `gv-shorts` para social cut |
