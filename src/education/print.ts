import { validateEducationPackage, type EducationPackage } from './service.js';

/** Print source for text-only teaching packages. Visual resources need their own layout workflow. */
export function educationPrintHtml(p: EducationPackage, audience: 'teacher' | 'student'): string {
  const errors = validateEducationPackage(p, false);
  if (errors.length) throw new Error(errors.join('\n'));
  const esc = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
  const para = (s: string) => `<p>${esc(s).replace(/\n/g, '<br>')}</p>`;
  const heading = (s: string) => `<h2>${esc(s)}</h2>`;
  const draft = validateEducationPackage(p, true).length > 0;
  const pieces = [
    `<h1>${esc(p.title)}</h1>`,
    para(audience === 'teacher' ? 'Guía docente' : 'Material del estudiante'),
    para(draft ? 'BORRADOR INTERNO Pendiente de revisión pedagógica y curricular' : 'Revisión registrada en el expediente'),
    para(`Nivel: ${p.level}`),
  ];
  if (audience === 'teacher') {
    pieces.push(para(p.context), heading('Fuentes y alcance'), ...p.curriculum.map(c => para(`${c.id}: ${c.reference}`)),
      heading('Objetivos'), ...p.objectives.map(o => para(`${o.id}: ${o.text} — fuente ${o.sourceId}`)));
    for (const lesson of p.lessons) {
      pieces.push(heading(`${lesson.id} ${lesson.title}`), para(`${lesson.area} · ${lesson.duration} minutos`));
      for (const m of lesson.moments) pieces.push(heading(`${m.name} ${m.minutes} minutos`),
        para(`Intervención docente: ${m.teacher}`), para(`Actividad del estudiante: ${m.student}`));
      pieces.push(para(`Recursos: ${lesson.resourceIds.join(', ')}`));
    }
  }
  for (const [index, r] of p.resources.entries()) pieces.push(`<section${audience === 'student' && index === 0 ? '' : ' class="resource"'}>${heading(r.title)}${para(r.content)}${audience === 'teacher' ? para(`Procedencia: ${r.provenance}`) : ''}</section>`);
  for (const [index, a] of p.assessments.entries()) pieces.push(`<section class="assessment">${index === 0 ? heading(audience === 'teacher' ? 'Evaluaciones y solucionario reservado' : 'Evaluaciones') : ''}${heading(a.id)}${para(a.instructions)}${audience === 'teacher' ? para(`Respuesta u orientación: ${a.answerKey}`) + para(`Criterios: ${a.criteria}`) : ''}</section>`);
  if (audience === 'teacher') pieces.push(heading('Registro de revisión'), para(draft ? 'Sin aprobación pedagógica documentada. No entregar como versión final.' : `${p.review.reviewer} · ${p.review.reviewedOn} · ${p.review.evidence}`));
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(p.title)}</title><style>
    @page { size: A4; margin: 18mm; }
    body { color: #000; font: 11pt Arial, sans-serif; line-height: 1.45; }
    h1 { font-size: 20pt; margin: 0 0 8mm; } h2 { font-size: 14pt; margin: 7mm 0 3mm; break-after: avoid; }
    p { margin: 0 0 4mm; overflow-wrap: anywhere; orphans: 3; widows: 3; }
    .resource, .assessment { break-before: page; }
  </style></head><body>${pieces.join('\n')}</body></html>`;
}
