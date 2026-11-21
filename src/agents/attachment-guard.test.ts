import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assessAttachments,
  assertAttachmentsResolvable,
  extractAttachmentRefs,
  missingAttachments,
  pendingAttachmentNotice,
  planAttachmentCopy,
  stripAttachmentMarkup,
} from './attachment-guard.js';

const IMAGE = '<ac:image><ri:attachment ri:filename="referencia-att4749492226.png"/></ac:image>';
const OTHER_IMAGE =
  '<ac:image><ri:attachment ri:filename="referencia-att3489333249.png"/></ac:image>';

test('extrae los adjuntos referenciados por el markup de imagen', () => {
  assert.deepEqual(extractAttachmentRefs(IMAGE), ['referencia-att4749492226.png']);
  assert.deepEqual(extractAttachmentRefs(`${IMAGE}\n${OTHER_IMAGE}`), [
    'referencia-att4749492226.png',
    'referencia-att3489333249.png',
  ]);
  // Sin duplicados y en el orden en que aparecen.
  assert.deepEqual(extractAttachmentRefs(`${IMAGE}${IMAGE}`), ['referencia-att4749492226.png']);
  // Comillas simples también.
  assert.deepEqual(
    extractAttachmentRefs("<ac:image><ri:attachment ri:filename='imagen.png'/></ac:image>"),
    ['imagen.png'],
  );
  // Markup plano: `<img src="...">` cuenta solo si parece un archivo de imagen.
  assert.deepEqual(extractAttachmentRefs('<p><img src="descargas/grafico.png"/></p>'), [
    'grafico.png',
  ]);
  assert.deepEqual(extractAttachmentRefs('<a href="ficha.html">ficha</a>'), []);
  assert.deepEqual(extractAttachmentRefs(''), []);
});

test('distingue lo que falta en la página destino', () => {
  assert.deepEqual(missingAttachments(`${IMAGE}${OTHER_IMAGE}`, ['referencia-att4749492226.png']), [
    'referencia-att3489333249.png',
  ]);
  // El nombre se compara sin distinguir mayúsculas.
  assert.deepEqual(missingAttachments(IMAGE, ['REFERENCIA-ATT4749492226.PNG']), []);
});

test('planifica la copia desde el origen y deja el resto pendiente', () => {
  const body = `${IMAGE}${OTHER_IMAGE}`;
  const plan = planAttachmentCopy(body, ['referencia-att4749492226.png']);
  assert.deepEqual(plan.copy, ['referencia-att4749492226.png']);
  assert.deepEqual(plan.missing, ['referencia-att3489333249.png']);
  assert.deepEqual(planAttachmentCopy(body, []), {
    copy: [],
    missing: ['referencia-att4749492226.png', 'referencia-att3489333249.png'],
  });
});

test('el veredicto bloquea en modo estricto y declara el pendiente en modo laxo', () => {
  const plan = planAttachmentCopy(IMAGE, []);
  const strict = assertAttachmentsResolvable(plan, { strict: true });
  assert.equal(strict.status, 'blocked');
  assert.deepEqual(strict.missing, ['referencia-att4749492226.png']);
  assert.ok(strict.notice?.includes('referencia-att4749492226.png'));

  const lax = assertAttachmentsResolvable(plan, { strict: false });
  assert.equal(lax.status, 'partial');

  const ok = assertAttachmentsResolvable(
    { referenced: ['a.png'], copy: ['a.png'], missing: [] },
    {
      strict: true,
    },
  );
  assert.equal(ok.status, 'ok');
  assert.equal(ok.notice, undefined);
});

test('el texto del pendiente nombra el archivo faltante', () => {
  const one = pendingAttachmentNotice(['referencia-att4749492226.png']);
  assert.ok(one.includes('«referencia-att4749492226.png»'));
  assert.ok(one.includes('no se publica'));
  const many = pendingAttachmentNotice(['a.png', 'b.png']);
  assert.ok(many.includes('«a.png»') && many.includes('«b.png»'));
  assert.ok(many.includes('no se publican'));
});

test('saca del cuerpo el markup de imagen sin adjunto', () => {
  const body = `<p>Antes</p>${IMAGE}${OTHER_IMAGE}<p>Después</p>`;
  const stripped = stripAttachmentMarkup(body, ['referencia-att4749492226.png']);
  assert.ok(!stripped.includes('referencia-att4749492226.png'));
  assert.ok(stripped.includes('referencia-att3489333249.png'));
  assert.ok(stripped.includes('<p>Después</p>'));
  // Sin pendientes no se toca el cuerpo.
  assert.equal(stripAttachmentMarkup(body, []), body);
});

test('el atajo sobre el cuerpo y los adjuntos disponibles da el mismo veredicto', () => {
  const body = `${IMAGE}${OTHER_IMAGE}`;
  assert.equal(assessAttachments(body, [], { strict: false }).status, 'partial');
  assert.equal(assessAttachments(body, [], { strict: true }).status, 'blocked');
  assert.equal(
    assessAttachments(body, ['referencia-att4749492226.png', 'referencia-att3489333249.png'], {
      strict: true,
    }).status,
    'ok',
  );
  assert.equal(assessAttachments('<p>sin imágenes</p>', [], { strict: true }).status, 'ok');
});
