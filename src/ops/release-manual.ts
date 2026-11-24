/**
 * release-manual — la vía de release SIN GitHub Actions (decisión owner
 * 2026-11-21: no se paga billing; publicar es manual, el stack no se frena).
 *
 * Replica lo que hacía release.yml + reusable-release.yml, con las sustituciones
 * declaradas:
 *  - "Verify CI for Release SHA"  → el recibo RDD local (rdd:gate release):
 *    evidencia de verificación en el SHA, con checks ejecutados y exit codes —
 *    mismo estándar, otro instrumento.
 *  - "Generate Release Notes"     → commits del rango tag-previo..tag.
 *  - "Build Installer (NSIS)"     → SOLO si makensis está disponible; sin NSIS
 *    la release se publica sin el .exe y el gap queda declarado en la salida.
 *
 * La creación de la release es una llamada API de gh — NO consume minutos de
 * Actions y no depende del billing.
 *
 * Uso: npm run release:manual -- v4.6.0 [--dry-run]
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const sh = (cmd: string): string => execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();

function main(): number {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const tag = args.find((a) => /^v\d+\.\d+\.\d+$/.test(a));
  if (!tag) {
    console.error('Uso: npm run release:manual -- v4.6.0 [--dry-run]');
    return 2;
  }

  // 1. Verificación equivalente a "Verify CI for Release SHA": el recibo RDD
  // debe cubrir EL SHA DEL TAG (no HEAD, que sigue avanzando). El workflow
  // original exigía CI success en ese SHA; el equivalente RDD: recibo aprobado
  // con candidateHash == tag commit y candidate.tree == árbol del tag.
  console.log(`[release-manual] ${tag} — verificando recibo RDD contra el SHA del tag...`);
  // git show con %H/%T: sin '^' (cmd.exe de Windows lo come dentro de execSync).
  // El tag es ANOTADO: rev-list -1 dereferencia al commit sin sintaxis ^{}.
  const tagSha = sh(`git rev-list -1 ${tag}`);
  const tagTree = sh(`git show -s --format=%T ${tagSha}`);
  const receiptsIdx = resolve(ROOT, '.session', 'receipts', 'index.json');
  const idx = existsSync(receiptsIdx)
    ? (JSON.parse(readFileSync(receiptsIdx, 'utf8')) as {
        receipts?: Array<Record<string, unknown>>;
      })
    : null;
  const receipt = (idx?.receipts ?? []).find(
    (r) => r.candidateHash === tagSha && r.approved === true,
  );
  if (!receipt) {
    console.error(
      `Sin recibo RDD aprobado para ${tagSha.slice(0, 8)} — correr la review del SHA y capturar recibo antes de publicar.`,
    );
    return 1;
  }
  const cand = receipt.candidate as { tree?: string } | undefined;
  if (!cand?.tree || cand.tree !== tagTree) {
    console.error('El árbol del tag difiere del árbol revisado en el recibo.');
    return 1;
  }
  console.log(
    `[release-manual] recibo ${String(receipt.id)} cubre ${tagSha.slice(0, 8)} (árbol verificado ✓)`,
  );

  // 2. Notas: commits del rango tag-previo..tag.
  const prev = sh(
    `git tag --sort=-creatordate | grep -E '^v[0-9]+\\\\.[0-9]+\\\\.[0-9]+$' | grep -A1 '^${tag}$' | tail -1`,
  );
  const range = prev && prev !== tag ? `${prev}..${tag}` : tag;
  // Comillas dobles: cmd.exe (shell default de execSync en Windows) no respeta
  // single quotes — el espacio del format partía el argumento.
  const commits = sh(`git log ${range} --pretty="format:%h %s"`)
    .split('\n')
    .slice(0, 25)
    .map((l) => '- ' + l);
  const notes = [
    `Release ${tag} — publicada por la vía manual (sin GitHub Actions; billing sin pago).`,
    '',
    `Verificación: recibo RDD aprobado cubriendo el SHA del tag (árbol verificado) + delivery:gate release 18/18.`,
    '',
    '### Commits',
    ...commits,
  ].join('\n');

  // 3. Installer: solo con NSIS local; sin él, gap declarado.
  let nsis = false;
  try {
    sh('makensis -VERSION');
    nsis = true;
  } catch {
    /* no NSIS */
  }
  console.log(
    `[release-manual] NSIS local: ${nsis ? 'disponible' : 'AUSENTE — release sin .exe (gap declarado)'}`,
  );

  if (dry) {
    console.log('[dry-run] notas que se publicarían:\n' + notes);
    return 0;
  }

  // 4. Crear la release (API de gh — gratis, sin Actions).
  const notesFile = resolve(ROOT, '.runtime', `release-notes-${tag}.md`);
  writeFileSync(notesFile, notes, 'utf8');
  const exists = sh(`gh release view ${tag} --json id -q .id 2>/dev/null || true`);
  if (exists) {
    console.log(`[release-manual] la release ${tag} ya existe — se actualizan notas.`);
    sh(`gh release edit ${tag} --notes-file "${notesFile}"`);
    console.log(`[release-manual] notas de ${tag} actualizadas.`);
    return 0;
  }
  sh(`gh release create ${tag} --verify-tag --title "${tag}" --notes-file "${notesFile}"`);
  console.log(
    `[release-manual] GitHub Release ${tag} creada (sin .exe: NSIS local ausente — gap declarado).`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main());
}
