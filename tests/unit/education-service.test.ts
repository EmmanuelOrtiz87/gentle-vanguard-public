import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateQuote, validateEducationPackage } from '../../src/education/service.js';
import { educationPrintHtml } from '../../src/education/print.js';

test('quote includes human review, fees and margin and rounds upward', () => {
  const result = calculateQuote({ hours: { research: 1, writing: 2, review: 1, layout: 1, revisions: 1 }, hourlyCost: 10, externalCost: 5, overhead: 5, contingencyRate: .1, feesRate: .1, marginRate: .3 });
  assert.equal(result.cost, 77);
  assert.equal(result.minimumPrice, 128.34);
  assert.ok(result.minimumPrice * (1 - .1 - .3) >= result.cost);
});
test('quote rejects missing costs, negative hours and impossible margin', () => {
  const base = { hours: { research: 1, writing: 1, review: 1, layout: 1, revisions: 1 }, hourlyCost: 10, externalCost: 0, overhead: 0, contingencyRate: 0, feesRate: .1, marginRate: .3 };
  for (const bad of [{ ...base, hourlyCost: 0 }, { ...base, feesRate: .8 }, { ...base, hours: { ...base.hours, review: -1 } }, { ...base, externalCost: NaN }]) assert.throws(() => calculateQuote(bad));
});
test('an incomplete sequence cannot pass delivery validation', () => {
  const errors = validateEducationPackage({ title: 'Plan', lessons: [] }, true);
  assert.ok(errors.length > 0);
  assert.ok(errors.some(e => /revisión/i.test(e)));
});
test('validator catches missing resources, excess duration and untaught evaluation objectives', () => {
  const plan = { title:'Unidad', level:'Primaria', context:'Grupo ficticio', curriculum:[{id:'c1',reference:'Documento aportado, p. 2'}], objectives:[{id:'o1',text:'Resolver repartos',sourceId:'c1'}], resources:[], lessons:[{id:'l1',title:'Repartos',area:'Matemática',duration:40,objectiveIds:['o1'],resourceIds:['missing'],moments:[{name:'Práctica',minutes:50,teacher:'Orientar',student:'Resolver'}]}], assessments:[{id:'a1',objectiveIds:['other'],instructions:'Resolver',answerKey:'4',criteria:'Reparte en partes iguales'}], review:{status:'pending'}};
  const errors = validateEducationPackage(plan, false);
  assert.ok(errors.some(e=>/recurso/i.test(e)));
  assert.ok(errors.some(e=>/tiempo/i.test(e)));
  assert.ok(errors.some(e=>/objetivo/i.test(e)));
});

test('draft validation rejects non-finite lesson times and missing review state', () => {
  const load = () => JSON.parse(readFileSync('skills/education-service/examples/paquete-primaria.json', 'utf8'));
  const infinite = load();
  infinite.lessons[0].duration = Infinity;
  infinite.lessons[0].moments[0].minutes = Infinity;
  assert.ok(validateEducationPackage(infinite, false).some(e => /tiempo|momentos/i.test(e)));
  const missingReview = load();
  delete missingReview.review;
  assert.ok(validateEducationPackage(missingReview, false).some(e => /revisión/i.test(e)));
});

test('print versions preserve student tasks and reserve solutions and review evidence for teachers', () => {
  const plan = JSON.parse(readFileSync('skills/education-service/examples/paquete-primaria.json', 'utf8'));
  plan.assessments[0].answerKey = 'SOLUCION_RESERVADA_6_POR_RECIPIENTE';
  plan.resources[0].content += '\n<script>material de referencia</script>';
  const student = educationPrintHtml(plan, 'student');
  const teacher = educationPrintHtml(plan, 'teacher');
  assert.ok(student.includes('24 semillas'));
  assert.ok(!student.includes('SOLUCION_RESERVADA'));
  assert.ok(teacher.includes('SOLUCION_RESERVADA'));
  assert.ok(student.includes('&lt;script&gt;'));
  assert.ok(!student.includes('<script>'));
  assert.ok(student.includes('BORRADOR'));
});
