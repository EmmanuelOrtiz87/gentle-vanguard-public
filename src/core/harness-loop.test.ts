/**
 * harness-loop.test.ts — Mecanica del bucle PPC, verificada sin llamadas de modelo.
 *
 * El bucle se separa del substrate justamente para poder testear la
 * MECANICA (ledger, pool, seleccion ciega, adopcion, contrato de la
 * biblioteca) sin gastar tokens. Estos tests son la red que sostiene la
 * afirmacion de que el bucle "cierra".
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  runHarnessLoop,
  createScriptedSubstrate,
  buildVariantPrompt,
  parseOpencodeOutput,
  proposalFromEdits,
  composeTrees,
  createRunId,
  type HarnessTree,
} from './harness-loop.js';
import { HarnessLedger, LedgerIdentityError } from '../eval/harness-ledger.js';
import {
  assignAnonymizedIds,
  assertSelectionClean,
  buildSelectionPool,
  parseSelection,
  partitionCandidates,
  selectionSeed,
  type SelectionCandidate,
} from '../eval/blind-selection.js';
import { loadVerdictExemptions } from './harness-allowlist.js';
import { judgeCompliance, summarizeJudge } from '../eval/harness-judge.js';
import { parseSemanticVerdict, semanticJudgePrompt } from '../eval/harness-semantic-judge.js';
import { saveHarnessSnapshot } from '../knowledge/experience-library.js';
import {
  parseToolCallFromText,
  safeToolPath,
} from '../eval/ollama-agent-substrate.js';
import { finalAgentMessage } from '../eval/cli-agent-substrate.js';
import { auditRuleFile, auditRules } from '../eval/rules-audit.js';
import {
  isAllowedProposal,
  parseProposal,
  proposerPrompt,
  taskIntent,
} from '../eval/harness-proposer.js';
import {
  addExperience,
  assertCompleteEntry,
  ensureExperiencesTable,
  IncompleteExperienceError,
  listExperiences,
} from '../knowledge/experience-library.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'gv-harness-loop-'));
}

const BASE_TREE: HarnessTree = {
  'AGENTS.md': '# Base\n\nRegla base del harness.\n',
  'rules/DEMO.md': '# Demo\n\nNorma de ejemplo.\n',
};

describe('ledger — identidad del presupuesto', () => {
  it('acepta exactamente 4k rollouts y 3k sesiones', () => {
    const ledger = HarnessLedger.create({ taskId: 't1', k: 1, mode: 'agg' });
    // La base y la candidata invariante comparten la sesion de propuesta:
    // 4 rollouts, 3 sesiones.
    ledger.record({ label: 'base-1', stage: 'base', sessionId: 's1', runId: 'r0' });
    ledger.record({ label: 'inv-1', stage: 'candidate', sessionId: 's1', runId: 'r1' });
    ledger.record({ label: 'dom-1', stage: 'candidate', sessionId: 's2', runId: 'r2' });
    ledger.record({ label: 'agg-1', stage: 'composition', sessionId: 's3', runId: 'r3' });

    const summary = ledger.summary();
    assert.equal(summary.rollouts, 4);
    assert.equal(summary.sessions, 3);
    assert.equal(summary.expectedRollouts, 4);
    assert.equal(summary.expectedSessions, 3);
    assert.equal(summary.identityHolds, true);
    assert.equal(summary.stageCountsHolds, true);
    assert.doesNotThrow(() => ledger.assertIdentity());
  });

  it('rechaza un runId duplicado: la misma corrida no se cuenta dos veces', () => {
    const ledger = HarnessLedger.create({ taskId: 't4', k: 1, mode: 'agg' });
    ledger.record({ label: 'base-1', stage: 'base', sessionId: 's1', runId: 'r0' });
    assert.throws(
      () => ledger.record({ label: 'inv-1', stage: 'candidate', sessionId: 's1', runId: 'r0' }),
      LedgerIdentityError
    );
  });

  it('rechaza un label duplicado en vez de avisar', () => {
    const ledger = HarnessLedger.create({ taskId: 't2', k: 1, mode: 'agg' });
    ledger.record({ label: 'inv-1', stage: 'candidate', sessionId: 's1', runId: 'r1' });
    assert.throws(
      () => ledger.record({ label: 'inv-1', stage: 'candidate', sessionId: 's2', runId: 'r2' }),
      LedgerIdentityError
    );
  });

  it('falla la identidad si el presupuesto no cuadra', () => {
    const ledger = HarnessLedger.create({ taskId: 't3', k: 1, mode: 'agg' });
    ledger.record({ label: 'inv-1', stage: 'candidate', sessionId: 's1', runId: 'r1' });
    assert.throws(() => ledger.assertIdentity(), LedgerIdentityError);
  });
});

describe('seleccion ciega — anonimizacion estable y sin score', () => {
  it('la semilla depende de task_id, k y modo', () => {
    assert.equal(selectionSeed('t', 1, 'agg'), selectionSeed('t', 1, 'agg'));
    assert.notEqual(selectionSeed('t', 1, 'agg'), selectionSeed('t', 2, 'agg'));
    assert.notEqual(selectionSeed('t', 1, 'agg'), selectionSeed('t', 1, 'seq'));
    assert.notEqual(selectionSeed('t', 1, 'agg'), selectionSeed('u', 1, 'agg'));
  });

  it('la permutacion es reproducible y no depende del orden de llegada', () => {
    const seed = selectionSeed('t', 1, 'agg');
    const a = assignAnonymizedIds(['x', 'y', 'z'], seed);
    const b = assignAnonymizedIds(['z', 'x', 'y'], seed);
    assert.deepEqual([...a.entries()].sort(), [...b.entries()].sort());
  });

  it('descarta las no-respuestas registrando la causa', () => {
    const candidates: SelectionCandidate[] = [
      { label: 'ok', ok: true, delivered: true, render: 'texto', rollout: 'r' },
      { label: 'fallo', ok: false, delivered: true, render: 'texto', rollout: 'r' },
      { label: 'sin-entrega', ok: true, delivered: false, render: 'texto', rollout: 'r' },
      { label: 'vacio', ok: true, delivered: true, render: '   ', rollout: 'r' },
    ];
    const { kept, dropped } = partitionCandidates(candidates);
    assert.equal(kept.length, 1);
    assert.deepEqual(
      dropped.map((d) => `${d.label}:${d.cause}`).sort(),
      ['fallo:not-ok', 'sin-entrega:not-delivered', 'vacio:empty-render']
    );
  });

  it('el pool escribe un archivo por candidata, sin recortar', () => {
    const dir = tempDir();
    try {
      const pool = buildSelectionPool(
        [
          {
            label: 'inv-1',
            ok: true,
            delivered: true,
            render: 'ENTREGADO',
            rollout: 'TRAYECTORIA COMPLETA',
          },
        ],
        { taskId: 't', k: 1, mode: 'agg', outDir: dir }
      );
      assert.equal(pool.candidates.length, 1);
      const content = pool.candidates[0]?.content ?? '';
      assert.ok(content.includes('NADA RECORTADO'));
      assert.ok(content.includes('ENTREGADO'));
      assert.ok(content.includes('TRAYECTORIA COMPLETA'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parsea la decision del selector y rechaza una invalida', () => {
    const parsed = parseSelection('```choice\nB\n```\n<why>porque si</why>');
    assert.equal(parsed?.choice, 'B');
    assert.equal(parsed?.why, 'porque si');
    assert.equal(parseSelection('no es una decision'), null);
  });
});

describe('tripwire de arboles — un solo oraculo con el doctor', () => {
  const CONTAMINATED: HarnessTree = {
    'skills/skill-creator-skill/agents/grader.md': 'El campo de salida es "pass_rate": 0.9\n',
  };

  it('falla sin exenciones: el tripwire es fail closed', () => {
    assert.throws(() => assertSelectionClean({ base: CONTAMINATED }), /Fuga de veredicto/);
  });

  it('respeta la MISMA allowlist que el doctor, por archivo y marcador', () => {
    const exemptions = loadVerdictExemptions(process.cwd());
    const result = assertSelectionClean({ base: CONTAMINATED }, exemptions);
    assert.equal(result.exempted.length, 1);
    assert.ok(result.exempted[0]?.includes('grader.md'));
  });

  it('un marcador distinto en el mismo archivo NO queda exento', () => {
    const exemptions = loadVerdictExemptions(process.cwd());
    const otro: HarnessTree = {
      'skills/skill-creator-skill/agents/grader.md': 'otro marcador: "passed_count": 3\n',
    };
    assert.throws(() => assertSelectionClean({ base: otro }, exemptions), /Fuga de veredicto/);
  });
});

describe('tripwire de artefactos — lo que el selector realmente lee', () => {  it('descarta una candidata cuyo artefacto lleva un veredicto de evaluador', () => {
    const dir = tempDir();
    try {
      const pool = buildSelectionPool(
        [
          {
            label: 'inv-1',
            ok: true,
            delivered: true,
            render: 'Resultado del trabajo\n\npass_rate: 0.97',
            rollout: 'trayectoria limpia',
          },
          {
            label: 'dom-1',
            ok: true,
            delivered: true,
            render: 'Trabajo entregado sin metricas',
            rollout: 'trayectoria limpia',
          },
        ],
        { taskId: 't', k: 1, mode: 'agg', outDir: dir }
      );
      assert.equal(pool.candidates.length, 1);
      assert.equal(pool.candidates[0]?.label, 'dom-1');
      assert.deepEqual(
        pool.dropped.map((d) => `${d.label}:${d.cause}`),
        ['inv-1:verdict-marker']
      );
      assert.equal(pool.violations.length, 1);
      assert.ok(pool.violations[0]?.includes('pass_rate'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('redacta secretos y rutas de usuario en lo que escribe', () => {
    const dir = tempDir();
    try {
      const pool = buildSelectionPool(
        [
          {
            label: 'inv-1',
            ok: true,
            delivered: true,
            render: 'token sk-abcdefghijklmnop123456 y home C:\\Users\\emman\\repo',
            rollout: 'trayectoria',
          },
        ],
        { taskId: 't', k: 1, mode: 'agg', outDir: dir }
      );
      const content = pool.candidates[0]?.content ?? '';
      assert.ok(!content.includes('sk-abcdefghijklmnop123456'));
      assert.ok(content.includes('<REDACTED>'));
      assert.ok(!content.includes('emman'));
      assert.ok(content.includes('<HOME>'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('biblioteca de experiencia — contrato cue/lesson/evidence', () => {
  it('rechaza una entrada incompleta y no deja fila', () => {
    const db = new Database(':memory:');
    ensureExperiencesTable(db);
    assert.throws(
      () =>
        addExperience(db, {
          topicKey: 'learning/demo',
          domain: 'demo',
          cue: 'cuando something',
          lesson: '',
          evidence: 'porque',
          confidence: 'medium',
        }),
      IncompleteExperienceError
    );
    assert.equal(listExperiences(db).length, 0);
    db.close();
  });

  it('acepta una entrada completa y la lista por dominio', () => {
    const db = new Database(':memory:');
    ensureExperiencesTable(db);
    addExperience(db, {
      topicKey: 'learning/demo',
      domain: 'demo',
      cue: 'cuando el indice de skills queda viejo y el router devuelve una ruta muerta',
      lesson: 'regenerar el indice de embeddings antes de medir cualquier comportamiento del harness',
      evidence: 'la corrida de comparacion ciega encontro que el router pedia una skill que ya no existia en disco',
      confidence: 'high',
    });
    addExperience(db, {
      topicKey: 'learning/otro',
      domain: 'otro',
      cue: 'cuando una candidata escribe metricas de evaluador dentro de su propio artefacto entregado',
      lesson: 'descartar la candidata contaminada antes de la comparacion y registrar la fuga en el reporte',
      evidence: 'la candidata tres trae pass_rate 0.97 y el selector habria estado comparando scores, no comportamientos',
      confidence: 'low',
    });
    assert.equal(listExperiences(db).length, 2);
    assert.equal(listExperiences(db, { domain: 'demo' }).length, 1);
    db.close();
  });

  it('rechaza una entrada de relleno aunque los tres campos tengan texto', () => {
    const db = new Database(':memory:');
    ensureExperiencesTable(db);
    assert.throws(
      () =>
        addExperience(db, {
          topicKey: 'learning/demo',
          domain: 'demo',
          cue: 'cuando se propone editar el harness',
          lesson: 'la edicion se adopto porque fue elegida',
          evidence: 'porque',
          confidence: 'medium',
        }),
      IncompleteExperienceError
    );
    assert.equal(listExperiences(db).length, 0);
    db.close();
  });

  it('actualiza la leccion cuando se reejecuta la misma tarea', () => {
    const db = new Database(':memory:');
    ensureExperiencesTable(db);
    const base = {
      topicKey: 'learning/demo',
      domain: 'demo',
      cue: 'cuando el indice de skills queda viejo y el router devuelve una ruta muerta',
      lesson: 'regenerar el indice de embeddings antes de medir cualquier comportamiento del harness',
      evidence: 'la corrida de comparacion ciega encontro que el router pedia una skill que ya no existia',
      confidence: 'high' as const,
      taskId: 'demo-1',
    };
    addExperience(db, base, '2026-10-23T00:00:00.000Z');
    const record = addExperience(
      db,
      { ...base, lesson: `${base.lesson} (revisado en la segunda corrida)` },
      '2026-10-24T00:00:00.000Z'
    );
    assert.equal(listExperiences(db).length, 1);
    assert.equal(listExperiences(db)[0]?.lesson.includes('revisado'), true);
    assert.equal(record.adoptedAt, '2026-10-24T00:00:00.000Z');
    db.close();
  });

  it('rechaza una clave tematica fuera de la convencion del repo', () => {    assert.throws(() =>
      assertCompleteEntry({
        topicKey: 'Learning/Demo',
        domain: 'demo',
        cue: 'a',
        lesson: 'b',
        evidence: 'c',
        confidence: 'low',
      })
    );
    assert.throws(() =>
      assertCompleteEntry({
        topicKey: 'inventada/demo',
        domain: 'demo',
        cue: 'a',
        lesson: 'b',
        evidence: 'c',
        confidence: 'low',
      })
    );
  });
});

describe('substrate opencode — forma real de los eventos', () => {
  // Eventos tal como los emite `opencode run --format json` (v1.19.4).
  const REAL_OUTPUT = [
    '{"type":"text","timestamp":1792815667160,"sessionID":"ses_x","part":{"id":"prt_1","messageID":"msg_1","sessionID":"ses_x","type":"text","text":"OK","time":{"start":1,"end":2}}}',
    '{"type":"step_finish","timestamp":1792815668112,"sessionID":"ses_x","part":{"id":"prt_2","messageID":"msg_1","sessionID":"ses_x","reason":"stop","tokens":{"total":25616,"input":25458,"output":4,"reasoning":41,"cache":{"write":0,"read":113}},"cost":0}}',
  ].join('\n');

  it('extrae la entrega del evento de texto y cierra la corrida', () => {
    const result = parseOpencodeOutput(REAL_OUTPUT, '', true, 'inv-1');
    assert.equal(result.render, 'OK');
    assert.equal(result.delivered, true);
    assert.equal(result.completed, true);
    assert.equal(result.ok, true);
    assert.equal(result.error, undefined);
    assert.equal(result.inputTokens, 25458);
    assert.equal(result.outputTokens, 4);
  });

  it('el runId depende de la variante: dos corridas no comparten identidad', () => {
    const a = parseOpencodeOutput(REAL_OUTPUT, '', true, 'inv-1');
    const b = parseOpencodeOutput(REAL_OUTPUT, '', true, 'dom-1');
    assert.notEqual(a.runId, b.runId);
    assert.equal(a.runId, parseOpencodeOutput(REAL_OUTPUT, '', true, 'inv-1').runId);
  });

  it('reconoce el rechazo del free tier como motivo de fallo', () => {
    const stdout = JSON.stringify({
      type: 'error',
      error: { name: 'FreeTierError', data: { message: 'free tier can only be used from within OpenCode' } },
    });
    const result = parseOpencodeOutput(stdout, '', false, 'base-1');
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes('free tier'));
  });

  it('reporta el fallo cuando no hay salida alguna', () => {
    const result = parseOpencodeOutput('', '', false, 'base-1');
    assert.equal(result.ok, false);
    assert.ok(result.error?.includes('ninguna salida'));
  });

  it('quita el envoltorio de tarea de la entrega', () => {
    const stdout = JSON.stringify({
      type: 'tool_use',
      part: {
        tool: 'task',
        state: {
          status: 'completed',
          output: '<task id="ses_x" state="completed">\n<task_result>\nINFORME\n</task_result>\n</task>',
        },
      },
    });
    const result = parseOpencodeOutput(stdout, '', true, 'base-1');
    assert.equal(result.render, 'INFORME');
  });
});

describe('juez post-seleccion — medicion objetiva del efecto de la edicion', () => {
  it('distingue la variante que cumple la regla de la que no', () => {
    const verdicts = judgeCompliance(
      [
        { label: 'inv-1', render: 'Informe con el comando npx tsx src/tools/harness-doctor.ts' },
        { label: 'dom-1', render: 'Informe sin datos' },
        { label: 'base-1', render: 'Informe base' },
      ],
      {
        invariante: { mustContain: ['npx tsx'] },
        dominio: { mustContain: ['harness-doctor'] },
      }
    );
    const byLabel = Object.fromEntries(verdicts.map((v) => [v.label, v]));
    assert.equal(byLabel['inv-1']?.ok, true);
    assert.equal(byLabel['dom-1']?.ok, false);
    assert.ok(byLabel['dom-1']?.failed.join(' ').includes('harness-doctor'));
    assert.equal(byLabel['base-1']?.ok, true, 'la base no tiene reglas que cumplir');
  });

  it('la composicion hereda los checks de invariante y dominio', () => {
    const verdicts = judgeCompliance(
      [
        { label: 'agg-1', render: 'npx tsx harness-doctor' },
        { label: 'agg-2', render: 'npx tsx' },
      ],
      {
        invariante: { mustContain: ['npx tsx'] },
        dominio: { mustContain: ['harness-doctor'] },
      }
    );
    assert.equal(verdicts[0]?.ok, true);
    assert.equal(verdicts[1]?.ok, false, 'faltaria la regla de dominio');
  });

  it('un mustNotContain de la base que la tarea YA menciona es dato, no fuga', () => {
    // Medido en §4.18 (codex/gpt-6-luna): con datos embebidos, la base declara
    // R=4k/P=3k porque la TAREA los trae. Fallar ese check confunde fidelidad
    // a los datos con fuga de regla.
    const spec = { base: { mustNotContain: ['R=4k', 'P=3k'] } };
    const conDato = judgeCompliance(
      [{ label: 'base-1', render: 'presupuesto: R=4k rollouts, P=3k sesiones' }],
      spec,
      'Identidad del presupuesto de la corrida de hoy: R=4k rollouts, P=3k sesiones.'
    );
    assert.equal(conDato[0]?.ok, true, 'dato de la tarea: la base lo informa con fidelidad');

    const sinDatoEnTarea = judgeCompliance(
      [{ label: 'base-1', render: 'presupuesto: R=4k rollouts' }],
      spec,
      'Redacta el informe de estado diario.'
    );
    assert.equal(
      sinDatoEnTarea[0]?.ok,
      false,
      'token que NO viene de la tarea: si es fuga de regla, se reporta'
    );
  });

  it('mustMatchAny exige UNO cualquiera, no todos', () => {
    const verdicts = judgeCompliance(
      [
        { label: 'inv-1', render: 'trae npm run harness:doctor:strict' },
        { label: 'inv-2', render: 'no trae ninguno' },
      ],
      {
        invariante: {
          mustMatchAny: ['npm run harness:doctor:strict', 'node --import tsx --test x.test.ts'],
        },
      }
    );
    assert.equal(verdicts[0]?.ok, true, 'con que matchee uno de los dos alcanza');
    assert.equal(verdicts[1]?.ok, false);
  });

  it('el resumen cuenta el cumplimiento por tipo', () => {    const verdicts = judgeCompliance(
      [
        { label: 'inv-1', render: 'npx tsx' },
        { label: 'dom-1', render: 'nada' },
        { label: 'dom-2', render: 'nada' },
      ],
      { invariante: { mustContain: ['npx tsx'] }, dominio: { mustContain: ['x'] } }
    );
    const resumen = summarizeJudge(verdicts);
    assert.equal(resumen.total, 3);
    assert.equal(resumen.ok, 1);
    assert.equal(resumen.porTipo['dominio']?.ok, 0);
    assert.equal(resumen.porTipo['dominio']?.total, 2);
  });
});

describe('modo seq — las composiciones acumulan', () => {
  it('en seq la base de la ronda 2 es la composicion de la ronda 1', async () => {
    const work = tempDir();
    const out = tempDir();
    try {
      const substrate = createScriptedSubstrate({
        'base-1': { render: 'BASE1' },
        'inv-1': { render: 'INV1' },
        'dom-1': { render: 'DOM1' },
        'agg-1': { render: 'AGG1' },
        'base-2': { render: 'BASE2' },
        'inv-2': { render: 'INV2' },
        'dom-2': { render: 'DOM2' },
        'agg-2': { render: 'AGG2' },
      });
      const proposals = [
        proposalFromEdits('inv', 'invariant', 'Mejora transversal', {
          'AGENTS.md': '# Base editada\n',
        }),
        proposalFromEdits('dom', 'domain', 'Mejora del dominio', {
          'rules/DEMO.md': '# Demo editado\n',
        }),
      ];

      const seq = await runHarnessLoop({
        taskId: 'tarea-seq',
        domain: 'demo',
        task: 'Describe el stack',
        baseTree: BASE_TREE,
        basePrompt: 'Prompt base.',
        proposals,
        substrate,
        k: 2,
        mode: 'seq',
        workDir: join(work, 'wd'),
        outDir: out,
        repoRoot: work,
        now: '2026-10-23T00:00:00.000Z',
        selector: () => '```choice\nA\n```\n<why>x</why>',
      });

      // La base de la ronda 2 ya trae la composicion de la ronda 1.
      const base2 = seq.baseRuns.find((r) => r.label === 'base-2');
      assert.ok(base2);
      assert.equal(base2.tree['AGENTS.md'], '# Base editada\n');
      assert.equal(base2.tree['rules/DEMO.md'], '# Demo editado\n');

      const agg = await runHarnessLoop({
        taskId: 'tarea-agg',
        domain: 'demo',
        task: 'Describe el stack',
        baseTree: BASE_TREE,
        basePrompt: 'Prompt base.',
        proposals,
        substrate,
        k: 2,
        mode: 'agg',
        workDir: join(work, 'wd2'),
        outDir: join(out, 'agg'),
        repoRoot: work,
        now: '2026-10-23T00:00:00.000Z',
        selector: () => '```choice\nA\n```\n<why>x</why>',
      });
      const base2agg = agg.baseRuns.find((r) => r.label === 'base-2');
      assert.equal(base2agg?.tree['AGENTS.md'], BASE_TREE['AGENTS.md'], 'en agg cada ronda arranca de la base original');
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe('inyeccion del cambio — el diff, no el archivo entero', () => {
  it('inyecta solo las lineas que cambian', () => {
    const base: HarnessTree = { 'rules/DEMO.md': 'linea 1\nlinea 2\nlinea 3\n' };
    const edited: HarnessTree = { 'rules/DEMO.md': 'linea 1\nlinea 2 editada\nlinea 3\n' };
    const prompt = buildVariantPrompt(
      'PROMPT BASE',
      proposalFromEdits('x', 'invariant', 'Edicion', edited),
      edited,
      base
    );
    assert.ok(prompt.includes('+ linea 2 editada'));
    assert.ok(prompt.includes('- linea 2'));
    assert.ok(!prompt.includes('linea 1'), 'no debe inyectar el archivo entero');
    assert.ok(prompt.startsWith('PROMPT BASE'));
  });

  it('un archivo NUEVO se inyecta completo', () => {
    const base: HarnessTree = {};
    const edited: HarnessTree = { 'rules/NUEVO.md': 'regla nueva\n' };
    const prompt = buildVariantPrompt(
      'PROMPT BASE',
      proposalFromEdits('x', 'domain', 'Edicion', edited),
      edited,
      base
    );
    assert.ok(prompt.includes('regla nueva'));
    assert.ok(prompt.includes('### rules/NUEVO.md'));
  });
});

describe('proposer automatico — el bucle propone solo', () => {
  it('parsea una propuesta en JSON y rechaza lo que no es propuesta', () => {
    const ok = parseProposal(
      '```json\n{"path":"rules/HARNESS-EVOLUTION.md","rationale":"porque si","content":"# Regla\\n\\nlinea\\n"}\n```'
    );
    assert.equal(ok?.path, 'rules/HARNESS-EVOLUTION.md');
    assert.ok(ok?.content.includes('linea'));
    assert.ok(ok?.edits['rules/HARNESS-EVOLUTION.md']);

    assert.equal(parseProposal('no soy un json'), null);
    assert.equal(parseProposal('{"path":"","content":"x"}'), null);
  });

  it('solo acepta propuestas dentro de la superficie editable', () => {
    const proposta = {
      path: 'src/otro.ts',
      content: 'x',
      rationale: '',
      edits: { 'src/otro.ts': 'x' },
    };
    assert.equal(isAllowedProposal(proposta, ['rules/', 'skills/', 'AGENTS.md']), false);
    assert.equal(
      isAllowedProposal({ ...proposta, path: 'rules/X.md' }, ['rules/', 'skills/']),
      true
    );
  });

  it('al proposer se le da la intencion de la tarea, no sus datos', () => {
    const task = [
      'Redacta el informe de estado del stack.',
      '',
      'DATOS:',
      '- Verificaciones: harness-doctor 0 errores',
      '- Precio: 12345',
    ].join('\n');
    const intent = taskIntent(task);
    assert.ok(intent.includes('Redacta el informe'));
    assert.ok(!intent.includes('12345'), 'los datos no le llegan al proposer');
    assert.ok(!intent.includes('harness-doctor 0 errores'));
  });

  it('el prompt del proposer no nombra metricas de evaluacion', () => {
    const prompt = proposerPrompt({
      domain: 'demo',
      kind: 'invariant',
      task: 'redacta el informe',
      context: { 'rules/X.md': 'contenido' },
    });
    const lower = prompt.toLowerCase();
    for (const prohibido of ['benchmark', 'grader', 'rubric', 'judge', 'scoring']) {
      assert.ok(!lower.includes(prohibido), `el prompt no debe mencionar ${prohibido}`);
    }
    assert.ok(prompt.includes('Operativa'));
  });
  it('el bucle aplica la edicion que propone el proposer automatico', async () => {
    const work = tempDir();
    const out = tempDir();
    try {
      const substrate = createScriptedSubstrate({
        'proposer-invariant-demo': {
          render:
            '{"path":"rules/AUTO-INV.md","rationale":"r","content":"# AUTO\\nregla transversal\\n"}',
        },
        'proposer-domain-demo': {
          render:
            '{"path":"rules/AUTO-DOM.md","rationale":"r","content":"# AUTO\\nregla de dominio\\n"}',
        },
        'base-1': { render: 'BASE' },
        'inv-1': { render: 'INV' },
        'dom-1': { render: 'DOM' },
        'agg-1': { render: 'AGG' },
      });
      const result = await runHarnessLoop({
        taskId: 'tarea-auto',
        domain: 'demo',
        task: 'Describe el stack',
        baseTree: BASE_TREE,
        basePrompt: 'Prompt base.',
        proposals: [
          proposalFromEdits('inv', 'invariant', 'inv', {}),
          proposalFromEdits('dom', 'domain', 'dom', {}),
        ],
        substrate,
        proposer: { substrate, domain: 'demo' },
        workDir: join(work, 'wd'),
        outDir: out,
        repoRoot: work,
        now: '2026-10-23T00:00:00.000Z',
        selector: () => '```choice\nA\n```\n<why>x</why>',
      });

      const inv = result.candidateRuns.find((r) => r.label === 'inv-1');
      const dom = result.candidateRuns.find((r) => r.label === 'dom-1');
      assert.ok(inv?.tree['rules/AUTO-INV.md']?.includes('regla transversal'));
      assert.ok(dom?.tree['rules/AUTO-DOM.md']?.includes('regla de dominio'));
      // La base no recibe ninguna propuesta.
      assert.equal(result.baseRuns[0]?.tree['rules/AUTO-INV.md'], undefined);
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe('juez semantico — el cumplimiento que un token literal no ve', () => {
  it('parsea el veredicto en sus variantes', () => {
    assert.equal(parseSemanticVerdict('```veredicto\nCUMPLE\n```\n<why>si</why>').complies, true);
    assert.equal(parseSemanticVerdict('```veredicto\nNO CUMPLE\n```\n<why>no</why>').complies, false);
    assert.equal(parseSemanticVerdict('CUMPLE\n<why>menciona la herramienta</why>').complies, true);
    assert.equal(parseSemanticVerdict('NO CUMPLE\n<why>le faltaba el dato</why>').complies, false);
  });

  it('el prompt del juez no nombra metricas de evaluacion', () => {
    const prompt = semanticJudgePrompt({
      label: 'inv-1',
      kind: 'candidate',
      rule: '# Regla\n- Escribi la linea `npm run harness:doctor:strict`.',
      artifact: '1. Verificado: harness-doctor sin errores',
    });
    const lower = prompt.toLowerCase();
    for (const prohibido of ['benchmark', 'grader', 'rubric', 'judge', 'scoring']) {
      assert.ok(!lower.includes(prohibido), `el prompt no debe mencionar ${prohibido}`);
    }
    assert.ok(prompt.includes('CUMPLE'));
  });
});

describe('substrate con herramientas de lectura', () => {
  it('lee una llamada de herramienta escrita como texto, con o sin valla', () => {
    const suelta = parseToolCallFromText(
      '{"name":"read_file","arguments":{"path":"rules/X.md"}}'
    );
    assert.equal(suelta?.function?.name, 'read_file');
    assert.ok(suelta?.function?.arguments?.includes('rules/X.md'));

    const conValla = parseToolCallFromText(
      '```json\n{\n  "name": "search_files",\n  "arguments": {"pattern": "informe"}\n}\n```'
    );
    assert.equal(conValla?.function?.name, 'search_files');

    // Con argumentos como objeto sueltos (algunos modelos los mandan asi).
    const conPath = parseToolCallFromText('{"name":"read_file","path":"AGENTS.md"}');
    assert.ok(conPath?.function?.arguments?.includes('AGENTS.md'));

    // Llamada DUPLICADA (dos objetos concatenados): se toma la primera.
    // Medido con qwen2.5-coder:14b: emitio la misma llamada dos veces y el
    // parser de primer-{"}-a-ultimo-"}" producía JSON invalido (null).
    const duplicada = parseToolCallFromText(
      '{"name": "list_dir", "arguments": {"path": "rules/"}}\n{"name": "list_dir", "arguments": {"path": "rules/"}}'
    );
    assert.equal(duplicada?.function?.name, 'list_dir');

    assert.equal(parseToolCallFromText('texto normal'), null);
    assert.equal(parseToolCallFromText('{"otra":"cosa"}'), null);
  });

  it('las rutas quedan confinadas a la raiz permitida', () => {
    const root = process.cwd();
    assert.ok(safeToolPath(root, 'rules/X.md'));
    assert.equal(safeToolPath(root, '../../etc/passwd'), null);
    assert.equal(safeToolPath(root, 'C:/Windows/System32/config'), null);
  });
});

describe('substrate CLI headless (codex)', () => {
  it('la entrega final es el ULTIMO agent_message del stream JSONL', () => {
    const stream = [
      '{"type":"thread.started","thread_id":"t1"}',
      'ruido de hook que no es JSON',
      '{"type":"item.completed","item":{"type":"agent_message","text":"voy a verificar"}}',
      '{"type":"item.completed","item":{"type":"command_execution","text":""}}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"ENTREGA FINAL"}}',
      '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":5}}',
      '',
    ].join('\n');
    assert.equal(finalAgentMessage(stream), 'ENTREGA FINAL');
    assert.equal(finalAgentMessage('sin eventos json'), '');
  });
});

describe('auditoria de reglas — que parte del stack es medible', () => {
  it('una regla es medible si la obligacion esta atada a un token literal', () => {
    const operativa = auditRuleFile(
      'rules/X.md',
      '- Todo informe incluye la linea `npm run harness:doctor:strict`.\n'
    );
    assert.equal(operativa.operative, true);
    assert.deepEqual(operativa.tokens, ['npm run harness:doctor:strict']);

    // Mismo token, pero sin obligacion atada: no dice que escribir.
    const suelta = auditRuleFile('rules/Y.md', '- Mirar `npm run harness:doctor:strict`.\n');
    assert.equal(suelta.operative, false);

    // Obligacion sin token: letra muerta para el bucle.
    const muerta = auditRuleFile('rules/Z.md', '- Nunca borres el lockfile.\n');
    assert.equal(muerta.operative, false);
    assert.equal(muerta.obligations, 1);
  });

  it('el inventario cuenta medibles y no medibles', () => {
    const audit = auditRules({
      'rules/A.md': '- Todo informe incluye `npm run harness:doctor:strict`.\n',
      'rules/B.md': '- Nunca borres el lockfile.\n',
      'rules/C.md': 'Sin obligaciones.\n',
      'docs/otra.md': '- Debe incluir `npm run x`.\n',
    });
    assert.equal(audit.total, 3, 'solo los .md de rules/ se auditan');
    assert.equal(audit.measurable, 1);
    assert.equal(audit.withObligations, 2);
    assert.equal(audit.unmeasurable.length, 1);
    assert.equal(audit.unmeasurable[0]?.path, 'rules/B.md');
  });

  it('un bullet envuelto no rompe la deteccion (bloques logicos)', () => {
    // La obligacion y el token estan en lineas fisicas distintas, pero en el
    // MISMO bullet: la regla SI es operativa.
    const entrada = auditRuleFile(
      'rules/X.md',
      '- Todo bloque de codigo generado debe pasar por `codegraph_node` para\n  verificar que las llamadas existen.\n'
    );
    assert.equal(entrada.operative, true);
  });

  it('una regla declarada no medible sale del backlog', () => {
    const conDeclaracion = auditRuleFile(
      'rules/Y.md',
      '<!-- harness: not-measurable -->\n<!-- harness: razon: es una prohibicion -->\n\n- Nunca deshabilites el reviewer sin razon.\n'
    );
    assert.equal(conDeclaracion.declaredNotMeasurable, true);
    assert.equal(conDeclaracion.reason, 'es una prohibicion');

    const audit = auditRules({
      'rules/Y.md':
        '<!-- harness: not-measurable -->\n<!-- harness: razon: es una prohibicion -->\n\n- Nunca deshabilites el reviewer sin razon.\n',
    });
    assert.equal(audit.declared, 1);
    assert.equal(audit.unmeasurable.length, 0, 'una regla declarada no es deuda');
  });

  it('un valor literal de una palabra cuenta como token (blocking, status)', () => {
    const entrada = auditRuleFile(
      'rules/Z.md',
      '- Skills criticos: el gate debe declarar `behavior: blocking`.\n'
    );
    assert.equal(entrada.operative, true);
    assert.ok(entrada.tokens.includes('behavior: blocking'));
  });

  it('el snapshot de una corrida se borra antes de escribirse', () => {
    const dir = tempDir();
    try {
      saveHarnessSnapshot('demo', 'tarea-1', { 'rules/NUEVA.md': 'nueva\n' }, dir);
      saveHarnessSnapshot('demo', 'tarea-1', { 'rules/OTRA.md': 'otra\n' }, dir);
      const base = join(
        dir,
        '.runtime',
        'harness-experience',
        'demo',
        'harnesses',
        'tarea-1',
        'harness'
      );
      const files = readdirSync(join(base, 'rules'));
      assert.deepEqual(files, ['OTRA.md'], 'no debe quedar residuo de la corrida anterior');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('composicion de arboles', () => {
  it('toma las ediciones del primero y completa con las del segundo', () => {
    const base: HarnessTree = { a: '1', b: '2' };
    const first: HarnessTree = { a: '1-edit', b: '2' };
    const second: HarnessTree = { a: '1-other', c: '3' };
    const { tree, conflicts } = composeTrees(base, first, second);
    assert.equal(tree.a, '1-edit');
    assert.equal(tree.b, '2');
    assert.equal(tree.c, '3');
    assert.deepEqual(conflicts, ['a']);
  });

  it('una edicion del segundo sobre un path que el primero NO toco se conserva', () => {
    // Regresion: comparar contra el arbol (en vez de contra la base) hacia
    // que el segundo perdia toda edicion sobre paths existentes.
    const base: HarnessTree = { a: '1', b: '2' };
    const first: HarnessTree = { a: '1-edit', b: '2' };
    const second: HarnessTree = { a: '1', b: '2-edit' };
    const { tree, conflicts } = composeTrees(base, first, second);
    assert.equal(tree.a, '1-edit', 'el primero gana');
    assert.equal(tree.b, '2-edit', 'la edicion del segundo sobre b se conserva');
    assert.deepEqual(conflicts, []);
  });

  it('registra el conflicto cuando ambos editan el mismo path', () => {
    const base: HarnessTree = { a: '1' };
    const first: HarnessTree = { a: '1-inv' };
    const second: HarnessTree = { a: '1-dom' };
    const { tree, conflicts } = composeTrees(base, first, second);
    assert.equal(tree.a, '1-inv');
    assert.deepEqual(conflicts, ['a']);
  });
});

describe('bucle PPC — cierre completo con substrate guionizado', () => {
  it('produce 4 rollouts, 3 sesiones y un pool de 3 finales', async () => {
    const work = tempDir();
    const out = tempDir();
    const db = new Database(':memory:');
    try {
      const substrate = createScriptedSubstrate({
        'base-1': { render: 'BASE' },
        'inv-1': { render: 'INV' },
        'dom-1': { render: 'DOM' },
        'agg-1': { render: 'AGG' },
      });

      const result = await runHarnessLoop({
        taskId: 'tarea-demo',
        domain: 'demo',
        task: 'Describe el stack',
        baseTree: BASE_TREE,
        basePrompt: 'Prompt base.',
        proposals: [
          proposalFromEdits('inv', 'invariant', 'Mejora transversal', {
            'AGENTS.md': '# Base editada\n\nRegla base del harness.\n',
          }),
          proposalFromEdits('dom', 'domain', 'Mejora del dominio', {
            'rules/DEMO.md': '# Demo\n\nNorma de ejemplo editada.\n',
          }),
        ],
        substrate,
        workDir: join(work, 'wd'),
        outDir: out,
        // repoRoot aislado: el loop escribe la proyeccion de experiencia y el
        // snapshot del harness. Sin esto, el test ensucia el repo real.
        repoRoot: work,
        db,
        now: '2026-10-23T00:00:00.000Z',
        selector: () => '```choice\nA\n```\n<why>La primera candidata es mas completa.</why>',
      });

      assert.equal(result.ledger.rollouts, 4);
      assert.equal(result.ledger.sessions, 3);
      assert.equal(result.ledger.identityHolds, true);
      assert.equal(result.pool.candidates.length, 3);
      assert.equal(result.pool.dropped.length, 0);
      assert.equal(result.selection.via, 'selector');
      assert.ok(result.selection.selectedLabel);
      assert.ok(result.experience, 'una adopcion debe producir una experiencia');
      // La experiencia tiene que transferir: nombra QUE se toco y QUE se
      // aprendio, no una frase generica.
      assert.ok(
        result.experience.cue.includes('AGENTS.md') || result.experience.cue.includes('rules/DEMO.md'),
        `el cue debe nombrar el archivo tocado: ${result.experience.cue}`
      );
      assert.ok(result.experience.lesson.includes(result.selection.selectedLabel as string));
      assert.ok(result.experience.evidence.includes(result.runId));
      assert.ok(
        !result.experience.harnessSnapshot?.includes(':'),
        'el snapshot debe ser una ruta relativa al repo, no una ruta de maquina'
      );
      assert.equal(listExperiences(db, { domain: 'demo' }).length, 1);
      // La proyeccion y el snapshot se escriben en el root AISLADO.
      assert.ok(
        existsSync(join(work, 'docs', 'harness-experience', 'demo', 'INDEX.md')),
        'la proyeccion de experiencia debe quedar en el repoRoot aislado'
      );
      db.close();
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('cae al fallback cuando el selector no produce una eleccion valida', async () => {
    const work = tempDir();
    const out = tempDir();
    try {
      const substrate = createScriptedSubstrate({
        'base-1': { render: 'BASE' },
        'inv-1': { render: 'INV' },
        'dom-1': { render: 'DOM' },
        'agg-1': { render: 'AGG' },
      });
      const result = await runHarnessLoop({
        taskId: 'tarea-fallback',
        domain: 'demo',
        task: 'Describe el stack',
        baseTree: BASE_TREE,
        basePrompt: 'Prompt base.',
        proposals: [
          proposalFromEdits('inv', 'invariant', 'a', { 'AGENTS.md': 'x' }),
          proposalFromEdits('dom', 'domain', 'b', { 'rules/DEMO.md': 'y' }),
        ],
        substrate,
        workDir: join(work, 'wd'),
        outDir: out,
        repoRoot: work,
        now: '2026-10-23T00:00:00.000Z',
        selector: () => 'esto no es una decision',
      });
      assert.equal(result.selection.via, 'fallback-first');
      assert.ok(result.selection.selectedLabel);
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('exige una propuesta invariante y una de dominio', async () => {
    const work = tempDir();
    const out = tempDir();
    try {
      await assert.rejects(
        runHarnessLoop({
          taskId: 'tarea-invalida',
          domain: 'demo',
          task: 'x',
          baseTree: BASE_TREE,
          basePrompt: 'p',
          proposals: [proposalFromEdits('solo', 'invariant', 'd', { 'AGENTS.md': 'x' })],
          substrate: createScriptedSubstrate({}),
          workDir: join(work, 'wd'),
          outDir: out,
        }),
        /invariante/
      );
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe('identidad de corrida', () => {
  it('incluye dominio, tarea, modo y k', () => {
    const id = createRunId({
      domain: 'demo',
      taskId: 't',
      mode: 'agg',
      k: 1,
      timestamp: '2026-10-23T00:00:00.000Z',
    });
    assert.ok(id.startsWith('harness-demo-t-agg-k1-'));
  });
});