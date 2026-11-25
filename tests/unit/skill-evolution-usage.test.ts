#!/usr/bin/env node
/**
 * El motor de evolución debe leer la MISMA evidencia que escribe el recorder
 * canónico (Nexus `skill_usage`). Sin este merge reportaba 278/278 skills
 * "unobserved" con la tabla poblada (medido 2026-11-25).
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { loadNexusUsage } from '../../src/skills/skill-evolution-engine.ts';

test('loadNexusUsage: agrega filas por skill y normaliza last_used a ISO', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gv-evo-'));
  try {
    const db = new Database(join(dir, 'gentle-vanguard.db'));
    db.exec(
      'CREATE TABLE skill_usage (skill_id TEXT, session_id TEXT, count INTEGER, last_used TEXT)',
    );
    db.prepare('INSERT INTO skill_usage VALUES (?,?,?,?)').run(
      'safety',
      's1',
      3,
      '2026-07-24 00:10:33',
    );
    db.prepare('INSERT INTO skill_usage VALUES (?,?,?,?)').run(
      'safety',
      's2',
      4,
      '2026-07-25 10:00:00',
    );
    db.close();

    const usage = loadNexusUsage(dir, 'gentle-vanguard.db');
    assert.strictEqual(usage.get('safety')?.count, 7, 'suma ambos sessions del mismo skill');
    assert.strictEqual(
      usage.get('safety')?.lastUsed,
      new Date('2026-07-25T10:00:00Z').toISOString(),
      'last_used se interpreta como UTC y vuelve en ISO',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('loadNexusUsage: DB ausente devuelve mapa vacío (best-effort)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gv-evo-'));
  try {
    const usage = loadNexusUsage(dir, 'no-existe.db');
    assert.strictEqual(usage.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
