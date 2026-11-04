/**
 * Tests unitarios de src/core/session-claims.ts (control plane de sesiones).
 * Usa un registry aislado por redirección de cwd a un tmp dir.
 */
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';

// session-claims resuelve el registry desde process.cwd() → correr cada
// escenario en su propio tmp dir garantiza aislamiento total.
const repoRoot = process.cwd();
const tmp = mkdtempSync(join(tmpdir(), 'session-claims-test-'));
process.chdir(tmp);

const mod = await import('../../src/core/session-claims.js');

describe('session-claims', () => {
  after(() => {
    // Windows puede devolver EPERM transitorio al borrar el tmp dir (handles
    // del CLI child aún cerrándose) — la limpieza es cortesía, no contrato.
    try {
      rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      /* tmp dir residual en %TEMP% — inofensivo */
    }
  });

  it('claim en recurso libre → ok', () => {
    const res = mod.claim('apps/alpha', { note: 'trabajo A', ttlMin: 5 });
    assert.equal(res.ok, true);
    assert.equal(res.claim?.resource, 'apps/alpha');
  });

  it('claim de otra sesión sobre recurso con claim activo → conflicto', () => {
    mod.claim('apps/beta', { session: 'sesion-1', ttlMin: 5 });
    const res = mod.claim('apps/beta', { session: 'sesion-2' });
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'active-conflict');
    assert.equal(res.conflict?.session, 'sesion-1');
  });

  it('re-claim de la misma sesión es idempotente (renueva, no conflicta)', () => {
    mod.claim('apps/gamma', { session: 'sesion-1', ttlMin: 5 });
    const res = mod.claim('apps/gamma', { session: 'sesion-1', note: 'actualizada' });
    assert.equal(res.ok, true);
    assert.equal(res.claim?.note, 'actualizada');
  });

  it('claim expirado no bloquea (TTL vencido → libre para otra sesión)', () => {
    // TTL de 0 minutos expira al instante (expiresAt = now + 0 → vencido al verificar)
    mod.claim('apps/delta', { session: 'sesion-1', ttlMin: 0 });
    const res = mod.claim('apps/delta', { session: 'sesion-2', ttlMin: 5 });
    assert.equal(res.ok, true);
  });

  it('claim con PID muerto (identidad pid-) se poda y no bloquea', () => {
    // Identidad implícita pid- → la muerte del PID lo vuelve stale aunque el
    // TTL siga vigente. PID 999_999_999 no existe en ningún OS razonable.
    const dead = {
      resource: 'apps/echo',
      session: 'pid-999999999@ghost',
      pid: 999_999_999,
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    mkdirSync(join(tmp, '.runtime'), { recursive: true });
    writeFileSync(
      join(tmp, '.runtime', 'session-claims.json'),
      JSON.stringify({ version: 1, claims: [dead] }),
    );
    const res = mod.claim('apps/echo', { session: 'sesion-2', ttlMin: 5 });
    assert.equal(res.ok, true);
  });

  it('release del dueño libera; release de otro no', () => {
    mod.claim('apps/foxtrot', { session: 'sesion-1', ttlMin: 5 });
    assert.equal(mod.release('apps/foxtrot', 'sesion-otra'), false);
    assert.equal(mod.release('apps/foxtrot', 'sesion-1'), true);
    assert.equal(mod.listClaims().some((c) => c.resource === 'apps/foxtrot'), false);
  });

  it('renew extiende expiry; renew sin claim → false', () => {
    mod.claim('apps/golf', { session: 'sesion-1', ttlMin: 1 });
    assert.equal(mod.renew('apps/golf', 60, 'sesion-1'), true);
    const c = mod.listClaims().find((x) => x.resource === 'apps/golf');
    assert.ok(c && Date.parse(c.expiresAt) > Date.now() + 30 * 60_000);
    assert.equal(mod.renew('apps/inexistente', 60, 'sesion-1'), false);
  });

  it('recursos con path traversal se rechazan', () => {
    const res = mod.claim('../escape');
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'invalid-resource');
  });

  it('CLI list/claim/release funcionan end-to-end', () => {
    // El CLI corre desde el repo root (para que --import tsx resuelva) y apunta
    // su registro al tmp via GV_CLAIMS_FILE — aislado del registry real.
    const claimsFile = join(tmp, '.runtime', 'session-claims.json');
    const env = { ...process.env, GV_CLAIMS_FILE: claimsFile, GV_SESSION_ID: 'cli-sesion' };
    const scriptPath = join(repoRoot, 'src', 'core', 'session-claims.ts');
    execFileSync(
      process.execPath,
      ['--import', 'tsx', scriptPath, 'claim', 'apps/cli-test', '--ttl', '5'],
      { cwd: repoRoot, env },
    );
    const out = execFileSync(
      process.execPath,
      ['--import', 'tsx', scriptPath, 'list'],
      { cwd: repoRoot, env },
    ).toString();
    assert.match(out, /apps\/cli-test/);
    assert.match(out, /cli-sesion/);
  });
});
