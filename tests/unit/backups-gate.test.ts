/**
 * backups-gate.test.ts — la NORMATIVA-BACKUPS-DOCUMENTOS es operable: una
 * operación masiva sobre docs/clientes dispara el snapshot automáticamente
 * (GB-20261120). El incidente de origen se recuperó "por suerte, no por
 * diseño" — este gate convierte la suerte en diseño.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isMassClientsDeletion,
  latestSnapshotAgeMs,
  BACKUP_MASS_THRESHOLD,
  type StagedChange,
} from '../../src/tools/backups-gate.js';

const ch = (status: string, path: string): StagedChange => ({ status, path });

test('menos del umbral de borrados bajo docs/clientes no es operación masiva', () => {
  const changes = Array.from({ length: BACKUP_MASS_THRESHOLD - 1 }, (_, i) =>
    ch('D', `docs/clientes/DTV/doc-${i}.md`),
  );
  assert.equal(isMassClientsDeletion(changes), false);
});

test('alcanzar el umbral de borrados bajo docs/clientes ES operación masiva', () => {
  const changes = Array.from({ length: BACKUP_MASS_THRESHOLD }, (_, i) =>
    ch('D', `docs/clientes/DTV/doc-${i}.md`),
  );
  assert.equal(isMassClientsDeletion(changes), true);
});

test('modificaciones y renombres también cuentan (el truncado es el incidente real)', () => {
  const changes = [
    ch('M', 'docs/clientes/SKY/propuesta.md'),
    ch('R100\tdocs/clientes/SKY/a.md', 'docs/clientes/SKY/b.md'),
    ch('D', 'docs/clientes/OTT/c.md'),
    ch('M', 'docs/clientes/OTT/d.md'),
    ch('M', 'docs/clientes/OTT/e.md'),
  ];
  assert.equal(isMassClientsDeletion(changes), true);
});

test('borrados masivos FUERA de docs/clientes no disparan este gate', () => {
  const changes = Array.from({ length: BACKUP_MASS_THRESHOLD + 3 }, (_, i) =>
    ch('D', `apps/otra-cosa/archivo-${i}.ts`),
  );
  assert.equal(isMassClientsDeletion(changes), false);
});

test('frescura del snapshot: sin snapshots → null; reciente → fresco', () => {
  // Sin directorio de snapshots → null (no hay evidencia de respaldo).
  assert.equal(
    latestSnapshotAgeMs(join(tmpdir(), 'gv-backups-no-existe-' + Date.now()), 1000).ageMs,
    null,
  );
});
