/**
 * harness-experience-promote.ts — Sube al repo una leccion adoptada.
 *
 * El bucle propone y adopta en la biblioteca, pero la promocion de una regla
 * al harness del repo es una decision de GOBIERNO (🟡 AMARILLO en
 * `rules/NORMATIVAS-AUTONOMOUS-EVOLUTION.md`). Este comando no decide: deja
 * la decision preparada y auditada para que el owner la ejecute.
 *
 * Que hace:
 *  1. Lee el arbol adoptado (el snapshot de la corrida) de la biblioteca.
 *  2. Lo contrasta con la superficie ACTUAL del repo: lo que cambia son las
 *     files que la leccion propone.
 *  3. Con `--dry-run` imprime el diff y no escribe nada.
 *  4. Con `--apply` escribe esos archivos y corre el doctor como gate: si la
 *     superficie queda con errores, se RESTAURAN los archivos previos y el
 *     comando falla. Una promocion que rompe el harness no se queda.
 *
 * Uso:
 *   npx tsx src/tools/harness-experience-promote.ts --domain harness-self --dry-run
 *   npx tsx src/tools/harness-experience-promote.ts --domain harness-self --apply
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { spawnSync } from 'node:child_process';

import Database from 'better-sqlite3';

import { GV_SURFACE, readSurfaceTree, type HarnessTree } from '../core/harness-surface.js';
import { obligationTokens } from '../eval/rules-audit.js';
import {
  artifactsRoot,
  ensureExperiencesTable,
  listExperiences,
  nexusDbPath,
} from '../knowledge/experience-library.js';

const ROOT = resolve(import.meta.dirname ?? '.', '..', '..');

interface Options {
  domain: string;
  taskId?: string;
  apply: boolean;
}

function arg(name: string): string | undefined {
  const args = process.argv.slice(2);
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

function flag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

/** Arbol adoptado de una corrida, tal como quedo en la biblioteca. */
function adoptedTree(domain: string, taskId: string): HarnessTree {
  const base = join(
    artifactsRoot(ROOT),
    domain,
    'harnesses',
    taskId,
    'harness'
  );
  if (!existsSync(base)) return {};
  const tree: HarnessTree = {};
  const walk = (dir: string, prefix = ''): void => {
    for (const entry of readDirSafe(dir)) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs, rel);
      else if (entry.isFile()) tree[rel] = readFileSync(abs, 'utf-8');
    }
  };
  walk(base);
  return tree;
}

function readDirSafe(dir: string): Array<{ name: string; isDirectory(): boolean; isFile(): boolean }> {
  return readdirSync(dir, { withFileTypes: true });
}

function main(): number {
  const domain = arg('domain');
  if (!domain) {
    process.stderr.write('Falta --domain.\n');
    return 2;
  }
  const options: Options = {
    domain,
    taskId: arg('task-id'),
    apply: flag('apply'),
  };

  const dbPath = nexusDbPath(ROOT);
  if (!existsSync(dbPath)) {
    process.stderr.write(`No hay base de experiencia en ${dbPath}.\n`);
    return 2;
  }
  const db = new Database(dbPath);
  ensureExperiencesTable(db);
  const records = listExperiences(db, { domain: options.domain });
  db.close();
  if (records.length === 0) {
    process.stderr.write(`No hay experiencias adoptadas para el dominio "${options.domain}".\n`);
    return 2;
  }

  // `listExperiences` viene ordenado por fecha descendente: la PRIMERA es la
  // mas reciente. (Tomar la ultima promovia la leccion mas vieja.)
  const record = options.taskId
    ? records.find((r) => r.taskId === options.taskId)
    : records[0];
  if (!record) {
    process.stderr.write(`No hay experiencia para la corrida "${options.taskId}".\n`);
    return 2;
  }

  const adopted = adoptedTree(options.domain, record.taskId ?? '');
  if (Object.keys(adopted).length === 0) {
    process.stderr.write(`No hay snapshot de la corrida "${record.taskId}".\n`);
    return 2;
  }


  // Se promoven SOLO los archivos que la leccion registro como editados Y
  // cuya regla quedo VERIFICADA por el juez. El snapshot contiene la
  // superficie COMPLETA del momento de la corrida, asi que el diff contra la
  // superficie actual tambien trae archivos que cambiaron por otra via (otra
  // sesion, otro trabajo). Promover el diff pisaria trabajo ajeno: la
  // promocion es de la leccion, no del snapshot.
  //
  // Y si el juez NO verifico ninguna edicion, no se promueve nada: una regla
  // que se midio y no se cumplio no puede entrar al repo como norma.
  const lessonFiles = (record.edits ?? []).filter((rel) => rel in adopted);
  const verified = (record.verifiedEdits ?? []).filter((rel) => rel in adopted);
  const hasVerification = Array.isArray(record.verifiedEdits);

  // Guard mecanico: si el archivo ya existe con el MISMO contenido, no se
  // toca (no hay nada que promover). Si existe con contenido DISTINTO, se
  // reporta como conflicto: la promocion no pisa una regla viva sin que el
  // owner lo vea.
  const toWrite: string[] = [];
  const alreadyThere: string[] = [];
  const conflicts: string[] = [];
  const duplicates: string[] = [];
  const currentRules = readSurfaceTree(GV_SURFACE, ROOT);
  for (const rel of hasVerification ? verified : []) {
    const content = adopted[rel];
    if (content === undefined) continue;
    const target = join(ROOT, rel);
    if (!existsSync(target)) {
      // Duplicado semantico: otra regla del repo YA exige los mismos
      // tokens. Promoverla seria crear la misma regla dos veces con
      // nombres distintos.
      const demanded = obligationTokens(content);
      const twin = Object.entries(currentRules).find(
        ([other, otherContent]) =>
          other !== rel &&
          other.startsWith(`${GV_SURFACE.ruleDir}/`) &&
          demanded.some((token) => obligationTokens(otherContent).includes(token))
      );
      if (twin) {
        duplicates.push(`${rel} (ya exigida en ${twin[0]})`);
        continue;
      }
      toWrite.push(rel);
    } else if (readFileSync(target, 'utf-8') === content) {
      alreadyThere.push(rel);
    } else {
      conflicts.push(rel);
    }
  }
  const changed = toWrite;

  process.stdout.write(
    [
      `# Promocion — ${record.topicKey}`,
      `- Corrida: ${record.taskId}`,
      `- Confianza: ${record.confidence}`,
      `- Archivos que edito la leccion: ${lessonFiles.length}`,
      `- Archivos con regla VERIFICADA por el juez: ${verified.length}`,
      `- Archivos a escribir: ${toWrite.length}`,
      ...toWrite.map((rel) => `  + ${rel}`),
      ...alreadyThere.map((rel) => `  = ${rel} (ya esta, identico)`),
      ...duplicates.map((rel) => `  ~ ${rel} (la misma regla ya existe en el repo)`),
      ...conflicts.map((rel) => `  ! ${rel} (CONFLICTO: ya existe con otro contenido)`),
      duplicates.length > 0
        ? '  Los duplicados NO se escriben: el stack ya exige esa regla.'
        : '',
      conflicts.length > 0
        ? '  Los conflictos NO se escriben: la promocion no pisa una regla viva sin el owner.'
        : '',
      changed.length === 0 ? '(nada que escribir)' : '',
      hasVerification && verified.length === 0
        ? '(la leccion no tiene ninguna regla verificada: NO se promueve nada)'
        : '',
      !hasVerification
        ? `(aviso: esta leccion se registro sin verificacion del juez; no se promueve. Ediciones sin verificar: ${lessonFiles.join(', ')})`
        : '',
      '',
    ].join('\n')
  );

  if (changed.length === 0) return 0;
  if (!options.apply) {
    process.stdout.write('dry-run: no se escribio nada. Usa --apply para promover.\n');
    return 0;
  }

  // Backup para poder restaurar si el gate falla.
  const backup = new Map<string, string | null>();
  for (const rel of changed) {
    const abs = join(ROOT, rel);
    backup.set(rel, existsSync(abs) ? readFileSync(abs, 'utf-8') : null);
  }

  for (const rel of changed) {
    const content = adopted[rel];
    if (content === undefined) continue;
    const abs = join(ROOT, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf-8');
  }

  process.stdout.write(`\nGate: se corre el harness-doctor sobre la superficie promovida.\n`);
  const gate = spawnSync(
    process.execPath,
    ['--import', 'tsx', 'src/tools/harness-doctor.ts', '--strict'],
    { cwd: ROOT, encoding: 'utf-8' }
  );
  const gateOutput = `${gate.stdout ?? ''}${gate.stderr ?? ''}`;
  process.stdout.write(gateOutput);
  if (gate.status !== 0) {
    for (const [rel, previous] of backup) {
      const abs = join(ROOT, rel);
      if (previous === null) {
        if (existsSync(abs)) writeFileSync(abs, '', 'utf-8');
      } else {
        writeFileSync(abs, previous, 'utf-8');
      }
    }
    process.stderr.write(
      '\nLa promocion ROMPIO la superficie: se restauraron los archivos previos. No se promovio nada.\n'
    );
    return 1;
  }

  process.stdout.write(`\nPromovido: ${changed.length} archivo(s). El harness-doctor quedo limpio.\n`);
  return 0;
}

process.exit(main());
