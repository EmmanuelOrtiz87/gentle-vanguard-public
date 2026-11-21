import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyMigrationAnswer,
  migrationConfig,
  migrationDestination,
  migrationIntent,
  nextMigrationQuestion,
} from './migration-intent.js';

test('el destino es un dato versionado: el config declara áreas, clientes y las 3 preguntas', () => {
  const config = migrationConfig();
  assert.ok(config, 'config/confluence-destination.json debe cargarse');
  assert.ok(config.version);
  assert.equal(config.areas.digital.space, 'OTT');
  assert.equal(config.areas.it.space, 'DGOBACKEND');
  assert.equal(config.clients.OTT.prefix, 'OTT');
  assert.equal(config.clients.SKY.prefix, 'SKY');
  assert.equal(config.clients.DTV.prefix, 'DTV');
  assert.equal(config.prefixTemplate, '[{prefix}] - ');
  assert.equal(config.defaultStandard, 'A');
  for (const key of ['area', 'client', 'system'] as const) {
    const question = config.questions[key];
    assert.ok(question.es && question.en && question.pt, `falta el prompt ${key}`);
  }
});

test('activa la migración documental en es, en y pt', () => {
  const es = migrationIntent('Migrá la documentación de Buyflow a Confluence');
  assert.equal(es?.operation, 'migrate');
  assert.equal(es?.language, 'es');

  const en = migrationIntent('Migrate the documentation of Buyflow to Confluence');
  assert.equal(en?.operation, 'migrate');
  assert.equal(en?.language, 'en');

  const pt = migrationIntent('Migrar a documentação de Buyflow no Confluence');
  assert.equal(pt?.operation, 'migrate');
  assert.equal(pt?.language, 'pt');
});

test('no activa migración documental sin objetivo documental', () => {
  // neither the code migration nor the format conversion is a documentary migration
  assert.equal(migrationIntent('Migra el código de JavaScript a TypeScript'), undefined);
  assert.equal(migrationIntent('convierte markdown a docx'), undefined);
  assert.equal(migrationIntent('Migra la documentación a docx'), undefined);
  assert.equal(migrationIntent('Migra el repositorio'), undefined);
});

test('reconoce la activación de documentación y de ficha', () => {
  assert.equal(migrationIntent('Documentá la documentación de Buyflow')?.operation, 'document');
  assert.equal(migrationIntent('Armá la ficha de Buyflow')?.operation, 'document');
  assert.equal(migrationIntent('Crea la ficha de Buyflow en Confluence')?.operation, 'document');
});

test('detecta el cliente por alias (DGO/Go → OTT, Directv → DTV, Sky → SKY)', () => {
  assert.equal(migrationIntent('Migrá la documentación de DGO a Confluence')?.client, 'OTT');
  assert.equal(migrationIntent('Migrá la documentación de Go a Confluence')?.client, 'OTT');
  assert.equal(migrationIntent('Migrá la documentación de Directv a Confluence')?.client, 'DTV');
  assert.equal(migrationIntent('Migrá la documentación de Sky a Confluence')?.client, 'SKY');
  assert.equal(migrationIntent('Migrá la documentación de SKY+ a Confluence')?.client, 'SKY');
  assert.equal(migrationIntent('Migrá la documentación de OTT a Confluence')?.client, 'OTT');
});

test('detecta el área y deduce el espacio explícito', () => {
  assert.equal(migrationIntent('Migrá la documentación digital de Buyflow')?.area, 'digital');
  assert.equal(
    migrationIntent('Migrá la documentación de Buyflow al área de tecnología')?.area,
    'it',
  );
  assert.equal(
    migrationIntent('Migrá la documentación de Buyflow al espacio DGOBACKEND')?.area,
    'it',
  );
});

test('las preguntas van en orden fijo: área → cliente → sistema', () => {
  const intent = migrationIntent('Migrá la documentación a Confluence');
  assert.ok(intent);
  assert.deepEqual(intent.missing, ['area', 'client', 'system']);

  assert.equal(intent.nextQuestion?.key, 'area');
  assert.deepEqual(intent.nextQuestion?.options, ['Digital', 'IT']);

  const afterArea = applyMigrationAnswer(intent, 'Digital');
  assert.equal(afterArea.area, 'digital');
  assert.equal(afterArea.nextQuestion?.key, 'client');
  assert.deepEqual(afterArea.nextQuestion?.options, ['OTT', 'SKY', 'DTV']);

  const afterClient = applyMigrationAnswer(afterArea, 'OTT');
  assert.equal(afterClient.client, 'OTT');
  assert.equal(afterClient.nextQuestion?.key, 'system');

  const afterSystem = applyMigrationAnswer(afterClient, 'Buyflow');
  assert.equal(afterSystem.system, 'Buyflow');
  assert.deepEqual(afterSystem.missing, []);
  assert.equal(afterSystem.nextQuestion, undefined);
});

test('el prompt sale en el idioma detectado', () => {
  const es = migrationIntent('Migrá la documentación de Buyflow a Confluence');
  assert.ok(es?.nextQuestion?.prompt.includes('área'));
  const en = migrationIntent('Migrate the documentation of Buyflow to Confluence');
  assert.ok(en?.nextQuestion?.prompt.includes('area'));
  const pt = migrationIntent('Migrar a documentação de Buyflow no Confluence');
  assert.ok(pt?.nextQuestion?.prompt.includes('área') || pt?.nextQuestion?.prompt.includes('area'));
});

test('no pregunta lo que el pedido ya dice', () => {
  const intent = migrationIntent(
    'Migrá la documentación de Buyflow del área Digital para el cliente OTT a Confluence',
  );
  assert.ok(intent);
  assert.equal(intent.area, 'digital');
  assert.equal(intent.client, 'OTT');
  assert.equal(intent.system, 'Buyflow');
  assert.deepEqual(intent.missing, []);
  assert.equal(nextMigrationQuestion(intent), undefined);
  assert.equal(intent.nextQuestion, undefined);
});

test('el sistema se detecta entre comillas, tras "de" y en mayúsculas', () => {
  assert.equal(
    migrationIntent('Migrá la documentación de "Buyflow Core" a Confluence')?.system,
    'Buyflow Core',
  );
  assert.equal(
    migrationIntent('Migrá la documentación de Buyflow a Confluence')?.system,
    'Buyflow',
  );
  assert.equal(
    migrationIntent('Migrá la documentación de BUYFLOW a Confluence')?.system,
    'BUYFLOW',
  );
});

test('el destino resuelto lleva espacio, prefijo de raíz y nombre del sistema', () => {
  const intent = migrationIntent(
    'Migrá la documentación de Buyflow del área Digital para el cliente OTT a Confluence',
  );
  assert.ok(intent);
  const destination = migrationDestination(intent);
  assert.ok(destination);
  assert.equal(destination.space, 'OTT');
  assert.equal(destination.prefix, '[OTT] - ');
  assert.equal(destination.rootTitle, '[OTT] - Buyflow');
  assert.equal(destination.standard, 'A');
  assert.equal(destination.site, 'dtvott.atlassian.net');
});

test('sin destino completo no hay destino (faltan piezas)', () => {
  const intent = migrationIntent('Migrá la documentación de Buyflow a Confluence');
  assert.ok(intent);
  assert.equal(migrationDestination(intent), undefined);
});

test('la respuesta en minúscula llena el slot que se estaba preguntando', () => {
  const intent = migrationIntent('Migrá la documentación a Confluence');
  assert.ok(intent);
  // "it" en minúscula responde a la pregunta de área (no es el pronombre inglés)
  const afterArea = applyMigrationAnswer(intent, 'it');
  assert.equal(afterArea.area, 'it');
  assert.equal(afterArea.nextQuestion?.key, 'client');
  const afterClient = applyMigrationAnswer(afterArea, 'sky');
  assert.equal(afterClient.client, 'SKY');
  assert.equal(afterClient.nextQuestion?.key, 'system');
});

test('una respuesta que no aporta dato no llena ningún slot', () => {
  const intent = migrationIntent('Migrá la documentación a Confluence');
  assert.ok(intent);
  const unchanged = applyMigrationAnswer(intent, 'no sé');
  assert.equal(unchanged.area, undefined);
  assert.deepEqual(unchanged.missing, ['area', 'client', 'system']);
  assert.equal(unchanged.nextQuestion?.key, 'area');
});
