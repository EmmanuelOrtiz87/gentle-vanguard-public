/** Internal production controls. They do not certify pedagogical correctness. */
export interface CostEstimate {
  hours: { research: number; writing: number; review: number; layout: number; revisions: number };
  hourlyCost: number; externalCost: number; overhead: number;
  contingencyRate: number; feesRate: number; marginRate: number;
}
export function calculateQuote(input: CostEstimate) {
  const numbers = [...Object.values(input.hours), input.hourlyCost, input.externalCost, input.overhead, input.contingencyRate, input.feesRate, input.marginRate];
  if (numbers.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0) || input.hourlyCost <= 0) throw new Error('Se requieren costos reales no negativos y costo horario positivo.');
  if (!['research', 'writing', 'review', 'layout', 'revisions'].every(k => k in input.hours)) throw new Error('Incluir preparación, escritura, revisión, maquetación y cambios.');
  if (input.feesRate + input.marginRate >= 1 || input.contingencyRate >= 1) throw new Error('Comisiones y margen deben dejar una proporción positiva para cubrir costos.');
  const hours = Object.values(input.hours).reduce((a,b) => a+b,0);
  if (hours <= 0 || input.hours.review <= 0) throw new Error('Presupuestar tiempo de producción y revisión humana.');
  const cost = (hours * input.hourlyCost + input.externalCost + input.overhead) * (1 + input.contingencyRate);
  return { hours, cost: Math.round(cost * 100) / 100, minimumPrice: Math.ceil(cost / (1-input.feesRate-input.marginRate) * 100 - 1e-8) / 100, notice: 'Piso estimado en la moneda de los costos. No garantiza rentabilidad si faltan costos, impuestos, revisiones o cambia el alcance.' };
}

export interface EducationPackage {
  title: string; level: string; context: string;
  curriculum: { id: string; reference: string }[];
  objectives: { id: string; text: string; sourceId: string }[];
  resources: { id: string; title: string; content: string; provenance: string }[];
  lessons: { id: string; title: string; area: string; duration: number; objectiveIds: string[]; resourceIds: string[]; moments: {name: string; minutes: number; teacher: string; student: string}[] }[];
  assessments: {id: string; objectiveIds: string[]; instructions: string; answerKey: string; criteria: string}[];
  review: {status: 'pending'|'approved'; reviewer?: string; reviewedOn?: string; evidence?: string};
}
export function validateEducationPackage(value: unknown, delivery = true): string[] {
  const p = value as EducationPackage;
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return ['Se requiere un paquete educativo.'];
  const text = (s: unknown) => typeof s === 'string' && s.trim().length > 0;
  const minutes = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
  if (!p.review || !['pending', 'approved'].includes(p.review.status)) errors.push('Falta el estado de revisión del paquete.');
  for (const k of ['title','level','context'] as const) if (!text(p[k])) errors.push(`Falta ${k}.`);
  for (const k of ['curriculum','objectives','resources','lessons','assessments'] as const) {
    if (!Array.isArray(p[k])) errors.push(`Falta la lista ${k}.`);
    else if (p[k].some(item => !item || typeof item !== 'object')) errors.push(`Elementos inválidos en ${k}.`);
    else if (new Set(p[k].map(item=>item.id)).size !== p[k].length || p[k].some(item=>!text(item.id))) errors.push(`Identificadores ausentes o repetidos en ${k}.`);
  }
  if (errors.length) { if(delivery) errors.push('Se requiere revisión pedagógica documentada.'); return errors; }
  if (!p.curriculum.length || !p.objectives.length || !p.lessons.length || !p.assessments.length) errors.push('Faltan fuentes, objetivos, clases o evaluación.');
  const sources = new Set(p.curriculum.map(c=>c.id));
  for (const c of p.curriculum) if (!text(c.reference)) errors.push(`Fuente ${c.id}: falta referencia verificable.`);
  const objectives = new Set(p.objectives.map(o=>o.id));
  for (const o of p.objectives) if (!text(o.text) || !sources.has(o.sourceId)) errors.push(`Objetivo ${o.id}: texto o fuente ausente.`);
  const resources = new Set(p.resources.map(r=>r.id));
  for (const r of p.resources) if (!text(r.content) || !text(r.provenance) || !text(r.title)) errors.push(`Recurso ${r.id}: faltan contenido completo o procedencia.`);
  const taught = new Set<string>();
  for (const l of p.lessons) {
    if (!text(l.title) || !text(l.area)) errors.push(`Clase ${l.id}: falta título o área.`);
    if (!Array.isArray(l.objectiveIds) || !l.objectiveIds.length || l.objectiveIds.some(id=>!objectives.has(id))) errors.push(`Clase ${l.id}: objetivo inválido.`);
    else l.objectiveIds.forEach(id=>taught.add(id));
    if (!Array.isArray(l.resourceIds) || l.resourceIds.some(id=>!resources.has(id))) errors.push(`Clase ${l.id}: recurso inexistente.`);
    if (!Array.isArray(l.moments) || !l.moments.length || l.moments.some(m=>!m || !text(m.name) || !text(m.teacher) || !text(m.student) || !minutes(m.minutes))) errors.push(`Clase ${l.id}: momentos incompletos o tiempos inválidos.`);
    else if (!minutes(l.duration) || l.moments.reduce((n,m)=>n+m.minutes,0) !== l.duration) errors.push(`Clase ${l.id}: tiempo de actividades distinto del módulo.`);
  }
  const evaluated = new Set<string>();
  for (const a of p.assessments) {
    if (!Array.isArray(a.objectiveIds) || !a.objectiveIds.length || a.objectiveIds.some(id=>!taught.has(id))) errors.push(`Evaluación ${a.id}: objetivo no enseñado.`);
    else a.objectiveIds.forEach(id=>evaluated.add(id));
    if (!text(a.instructions) || !text(a.answerKey) || !text(a.criteria)) errors.push(`Evaluación ${a.id}: faltan consignas, solucionario o criterios.`);
  }
  for (const id of objectives) if (!taught.has(id) || !evaluated.has(id)) errors.push(`Objetivo ${id} sin actividad o evidencia de evaluación.`);
  if (delivery && (p.review?.status !== 'approved' || !text(p.review.reviewer) || !text(p.review.evidence) || !/^\d{4}-\d{2}-\d{2}$/.test(p.review.reviewedOn||''))) errors.push('Se requiere revisión pedagógica documentada antes de entregar.');
  return errors;
}
