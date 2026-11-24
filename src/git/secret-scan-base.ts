/**
 * secret-scan-base.ts — el RANGO que el escaneo de secretos tiene que cubrir.
 *
 * POR QUÉ ESTE MÓDULO EXISTE (meta-auditoría 2026-11-20, backlog #3)
 * ---------------------------------------------------------------------
 * El escaneo de secretos del pre-push comparaba `HEAD~1..HEAD`: miraba UN
 * commit. En el PRIMER push de una rama nueva, un secreto introducido en el
 * commit 2 de una hotfix de 5 commits se empujaba COMPLETO con verde: el
 * commit 1 ya estaba "gastado" como base.
 *
 * La regla correcta es "todo lo que el remoto todavía no tiene de esta rama":
 *   - rama ya publicada  -> base = origin/<rama> (solo lo nuevo, exacto)
 *   - rama NUEVA         -> base = merge-base(origin/main, HEAD) (el rango
 *                           COMPLETO de la rama, no un commit)
 *   - sin remoto        -> base = HEAD~1 (lo único que se puede saber)
 *
 * POR QUÉ ES UN MÓDULO PROPIO Y NO UNA FUNCIÓN DENTRO DE prepush-gate.ts:
 * la función original estaba embebida en el composite y no era testeable —
 * el fix existía pero nadie podía PROBAR que cubría el rango completo
 * (la misma clase de bug que el stack arrastra: regla escrita, no verificada).
 * Acá la decisión es una función pura con el git inyectado: el test puede
 * simular rama nueva / rama publicada / repo sin remoto sin tocar el repo real.
 */

/** Ejecuta un comando git y devuelve su stdout, o null si el comando falló. */
export type GitProbe = (args: string[]) => string | null;

export interface SecretScanRange {
  /** Ref desde el que se escanea (inclusive) hasta HEAD. */
  base: string;
  /** Por qué se eligió esa base — se imprime en la salida del gate. */
  reason: string;
  /** Cuántos commits cubre el rango (evidencia, no promesa). */
  commits: number;
}

/** Cuenta los commits de `base..HEAD` (0 si no se puede determinar). */
function countCommits(probe: GitProbe, base: string): number {
  const out = probe(['rev-list', '--count', `${base}..HEAD`]);
  const count = Number.parseInt((out ?? '').trim(), 10);
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

/**
 * Resuelve el rango del escaneo de secretos.
 *
 * `probe` devuelve null cuando el comando git falla (ref inexistente).
 */
export function resolveSecretScanRange(probe: GitProbe): SecretScanRange {
  const branch = (probe(['rev-parse', '--abbrev-ref', 'HEAD']) ?? '').trim();

  // 1. La rama ya existe en el remoto: base exacta = lo que el remoto no tiene.
  if (branch && !branch.startsWith('HEAD')) {
    const remoteBranch = `origin/${branch}`;
    if (probe(['rev-parse', '--verify', '--quiet', remoteBranch]) !== null) {
      return {
        base: remoteBranch,
        reason: `rama ${branch} ya publicada: se escanea solo lo que el remoto no tiene`,
        commits: countCommits(probe, remoteBranch),
      };
    }
  }

  // 2. Rama NUEVA: el fork-point con origin/main cubre TODOS los commits de
  //    la rama (no uno). Sin esto, un secreto en el commit 2 de 5 se empuja
  //    con verde.
  if (probe(['rev-parse', '--verify', '--quiet', 'origin/main']) !== null) {
    const forkPoint = (probe(['merge-base', 'origin/main', 'HEAD']) ?? '').trim();
    if (forkPoint) {
      return {
        base: forkPoint,
        reason:
          'rama nueva: se escanea el rango COMPLETO de la rama (fork-point con origin/main), no solo el último commit',
        commits: countCommits(probe, forkPoint),
      };
    }
  }

  // 3. Sin remoto (o sin origin/main): HEAD~1 es lo único que se puede saber.
  return {
    base: 'HEAD~1',
    reason:
      'sin remoto utilizable: solo se escanea el último commit (no hay forma de saber el rango completo)',
    commits: countCommits(probe, 'HEAD~1'),
  };
}
