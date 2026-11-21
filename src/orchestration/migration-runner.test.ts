/**
 * migration-runner.test.ts — el runner invoca a Censor sin tocar Confluence.
 *
 * El runner se prueba con un `run` inyectado: lo que se verifica es el
 * contrato (argumentos, dry-run por defecto, errores), no la red.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildMigrateArgs, runMigration, MIGRATE_CLI } from './migration-runner.js';
import type { MigrationDestination } from './migration-intent.js';

const destination: MigrationDestination = {
  site: 'https://dtvott.atlassian.net/wiki',
  space: 'OTT',
  prefix: '[OTT] - ',
  rootTitle: '[OTT] - Buyflow',
  standard: 'A',
  client: 'OTT',
  area: 'digital',
  system: 'Buyflow',
};

test('buildMigrateArgs apunta al CLI de Censor con raíz, cliente y estándar', () => {
  const args = buildMigrateArgs(destination);
  assert.equal(args[0], MIGRATE_CLI);
  assert.ok(args.includes('--root'));
  assert.ok(args.includes('--destination') === false);
  assert.ok(args.includes('--apply') === false, 'sin apply explícito no se publica');
  const root = args[args.indexOf('--root') + 1];
  assert.equal(root, 'Buyflow');
  const scope = args[args.indexOf('--scope') + 1];
  assert.equal(scope, 'OTT');
  const standard = args[args.indexOf('--standard') + 1];
  assert.equal(standard, 'A');
});

test('buildMigrateArgs: la narrativa va activada por defecto', () => {
  const args = buildMigrateArgs(destination);
  assert.ok(args.includes('--narrative'));
  assert.ok(args.includes('--no-narrative') === false);
});

test('buildMigrateArgs: narrative false pasa --no-narrative', () => {
  const args = buildMigrateArgs(destination, { narrative: false });
  assert.ok(args.includes('--no-narrative'));
  assert.ok(args.includes('--narrative') === false);
});

test('buildMigrateArgs: pasa el área (espacio y padre) y el padre explícito', () => {
  const args = buildMigrateArgs(destination);
  assert.equal(args[args.indexOf('--area') + 1], 'digital');
  assert.ok(args.includes('--parent-id') === false, 'sin padre explícito no se inventa');

  const withParent = buildMigrateArgs(destination, { parentId: '6130171922' });
  assert.equal(withParent[withParent.indexOf('--parent-id') + 1], '6130171922');
});

test('buildMigrateArgs con apply y destino explícito los incluye', () => {
  const args = buildMigrateArgs(destination, { apply: true, destination: '6137577475' });
  assert.ok(args.includes('--apply'));
  assert.equal(args[args.indexOf('--destination') + 1], '6137577475');
});

test('runMigration es dry-run por defecto y devuelve el resultado de Censor', async () => {
  let captured: { args: string[]; cwd: string } | undefined;
  const result = await runMigration(destination, {
    run: ({ args, cwd }) => {
      captured = { args, cwd };
      return {
        code: 0,
        stdout: JSON.stringify({
          ok: true,
          standard: 'A',
          source: { id: '6130401292', title: '[OTT] - Buyflow', space: 'OTT' },
          destination: { id: '6137577475', title: 'Buyflow v2' },
          title: '[OTT] - Buyflow',
          sections: 8,
          planPath: '.runtime/censor/publish/plan-x.json',
        }),
        stderr: '',
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.sections, 8);
  assert.equal(result.source?.id, '6130401292');
  assert.ok(captured?.args.includes('--apply') === false);
});

test('runMigration devuelve el veredicto de la narrativa y los ejes', async () => {
  const result = await runMigration(destination, {
    run: () => ({
      code: 0,
      stdout: JSON.stringify({
        ok: true,
        standard: 'A',
        destination: { id: null, title: '[OTT] - Buyflow', create: true, parentId: '6130171922' },
        title: '[OTT] - Buyflow',
        sections: 8,
        narrative: { applied: false, reason: 'La narrativa cambió los encabezados.' },
        verification: 'pending',
        claimState: 'claim-evidence-failed',
        semanticState: 'semantic-review-no-findings',
        consolidated: { verdict: 'blocked', blockedBy: ['claims'], unavailable: [], warnings: [] },
      }),
      stderr: '',
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.narrative?.applied, false);
  assert.match(result.narrative?.reason || '', /encabezados/i);
  assert.equal(result.claimState, 'claim-evidence-failed');
  assert.equal(result.semanticState, 'semantic-review-no-findings');
  assert.equal(result.destination?.create, true);
  assert.equal(result.destination?.parentId, '6130171922');
});

test('runMigration traduce el error de Censor sin lanzar', async () => {
  const result = await runMigration(destination, {
    run: () => ({
      code: 4,
      stdout: JSON.stringify({
        ok: false,
        error: { code: 'destination_not_found', message: 'No se encontró la página destino.' },
      }),
      stderr: '',
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, 'destination_not_found');
  assert.equal(result.error?.message, 'No se encontró la página destino.');
});

test('runMigration sin destino con sistema devuelve error explícito', async () => {
  const result = await runMigration({ ...destination, system: undefined, rootTitle: '' });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, 'destination_incomplete');
});

test('runMarkdown sin salida interpretable no rompe', async () => {
  const result = await runMigration(destination, {
    run: () => ({ code: 1, stdout: 'no json', stderr: 'falló' }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error?.code, 'unparsable_output');
});
